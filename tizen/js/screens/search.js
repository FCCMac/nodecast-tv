/**
 * Search screen: an on-screen A-Z/0-9 grid (no IME - see tizen/README.md's
 * "known quirks" for why a text <input> isn't used here) plus a live
 * results list.
 *
 * Matches on the channel name first, falling back to the title of whatever
 * is airing right now (via Epg.nowNext) so e.g. typing a team or show name
 * finds the channel currently carrying it.
 */
(function () {

    var GRID_COLS = 6;
    var FILTER_DEBOUNCE_MS = 120;

    // Row-major layout: 6 rows of A-Z/0-9 (exactly 36, so this fills 6x6
    // with no gaps) followed by a final row of the 3 editing keys.
    var KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('').map(function (c) {
        return { label: c, action: 'char', value: c };
    }).concat([
        { label: 'Space', action: 'space' },
        { label: 'Del', action: 'del' },
        { label: 'Clear', action: 'clear' }
    ]);

    var el = {};
    var cellEls = [];
    var resultsList;

    var visible = false;
    var area = 'grid'; // 'grid' | 'results'
    var gridIndex = 0;
    var query = '';

    var source = null;
    var channels = [];
    var indexed = []; // [{ channel, nameNorm }], rebuilt whenever `channels` changes
    var dataReady = false;

    var filterTimer = null;

    // ---- Text normalization ----

    function normalize(s) {
        if (!s) return '';
        s = String(s).toLowerCase();
        if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
        return s.replace(/[^a-z0-9]+/g, ' ').replace(/^ +| +$/g, '');
    }

    function tokensOf(q) {
        var n = normalize(q);
        return n.length ? n.split(' ') : [];
    }

    // ---- Grid geometry ----

    function rowCountAt(row) {
        var rowStart = row * GRID_COLS;
        return Math.max(0, Math.min(GRID_COLS, KEYS.length - rowStart));
    }

    function maxRow() {
        return Math.floor((KEYS.length - 1) / GRID_COLS);
    }

    function clampToGrid(row, col) {
        if (row < 0) row = 0;
        if (row > maxRow()) row = maxRow();
        var rc = rowCountAt(row);
        if (rc <= 0) return gridIndex;
        if (col < 0) col = 0;
        if (col > rc - 1) col = rc - 1;
        return row * GRID_COLS + col;
    }

    function moveGrid(dr, dc) {
        var row = Math.floor(gridIndex / GRID_COLS);
        var col = gridIndex % GRID_COLS;
        var next = clampToGrid(row + dr, col + dc);
        if (next !== gridIndex) {
            gridIndex = next;
            renderGrid();
        }
    }

    // RIGHT moves to the results column once there's nowhere further right
    // to go in the current row (that's every row's column 5, except the
    // shorter final row of edit keys).
    function moveRightOrToResults() {
        var row = Math.floor(gridIndex / GRID_COLS);
        var col = gridIndex % GRID_COLS;
        var rc = rowCountAt(row);
        if (col + 1 < rc) {
            moveGrid(0, 1);
        } else if (resultsList.items.length > 0) {
            setArea('results');
        }
    }

    // ---- Rendering ----

    function renderGrid() {
        for (var i = 0; i < cellEls.length; i++) {
            var focused = area === 'grid' && i === gridIndex;
            cellEls[i].className = 'key-cell' + (focused ? ' focused' : '');
        }
    }

    function renderQuery() {
        el.query.textContent = 'Search: ' + query + (area === 'grid' ? '_' : '');
    }

    function setArea(a) {
        area = a;
        resultsList.setActive(area === 'results');
        renderGrid();
        renderQuery();
    }

    // ---- Typing ----

    function activateFocusedKey() {
        var key = KEYS[gridIndex];
        if (key.action === 'char') query += key.value;
        else if (key.action === 'space') query += ' ';
        else if (key.action === 'del') query = query.slice(0, -1);
        else if (key.action === 'clear') query = '';
        renderQuery();
        scheduleFilter();
    }

    function scheduleFilter() {
        clearTimeout(filterTimer);
        filterTimer = setTimeout(filterAndRender, FILTER_DEBOUNCE_MS);
    }

    // ---- Matching ----

    function buildIndexed() {
        indexed = channels.map(function (ch) {
            return { channel: ch, nameNorm: normalize(ch.name) };
        });
    }

    function allTokensIn(tokens, haystack) {
        for (var i = 0; i < tokens.length; i++) {
            if (haystack.indexOf(tokens[i]) === -1) return false;
        }
        return true;
    }

    function anyTokenAtWordStart(tokens, haystack) {
        for (var i = 0; i < tokens.length; i++) {
            if (new RegExp('\\b' + tokens[i]).test(haystack)) return true;
        }
        return false;
    }

    // Lower rank = better match. -1 = no match.
    function rankOf(entry, tokens, joinedQuery) {
        var nameNorm = entry.nameNorm;
        if (allTokensIn(tokens, nameNorm)) {
            if (nameNorm.indexOf(joinedQuery) === 0) return 0;
            if (anyTokenAtWordStart(tokens, nameNorm)) return 1;
            return 2;
        }
        var info = window.Epg.nowNext(entry.channel);
        if (info && info.now && info.now.title) {
            var titleNorm = normalize(info.now.title);
            if (allTokensIn(tokens, titleNorm)) return 3;
        }
        return -1;
    }

    function filterAndRender() {
        if (!visible) return;
        var tokens = tokensOf(query);

        if (tokens.length === 0) {
            resultsList.setItems([]);
            showHint(dataReady ? 'Type to search' : 'Loading channels…');
            return;
        }
        if (!dataReady) {
            showHint('Loading channels…');
            return;
        }

        var joined = tokens.join(' ');
        var matches = [];
        for (var i = 0; i < indexed.length; i++) {
            var rank = rankOf(indexed[i], tokens, joined);
            if (rank !== -1) matches.push({ channel: indexed[i].channel, rank: rank, name: indexed[i].nameNorm });
        }
        matches.sort(function (a, b) {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
        });

        var results = matches.map(function (m) { return m.channel; });
        resultsList.setItems(results);
        if (results.length === 0) showHint('No matches');
        else hideHint();
    }

    function showHint(msg) {
        el.hint.textContent = msg;
        el.hint.classList.remove('hidden');
    }

    function hideHint() {
        el.hint.classList.add('hidden');
    }

    // ---- Favorites (mirrors browse.js's toggleFavorite) ----

    function toggleFavorite(channel) {
        if (!source) return;
        window.App.Favorites.toggle(source.id, channel.stream_id).catch(function (err) {
            resultsList.refresh();
            window.Toast.show('Could not update favorite: ' + err.message);
        });
        resultsList.refresh();
    }

    // ---- Public screen API ----

    var SearchScreen = {
        init: function () {
            el.screen = document.getElementById('screen-search');
            el.query = document.getElementById('search-query');
            el.grid = document.getElementById('search-grid');
            el.hint = document.getElementById('search-hint');

            KEYS.forEach(function (k) {
                var cell = document.createElement('div');
                cell.className = 'key-cell';
                cell.textContent = k.label;
                el.grid.appendChild(cell);
                cellEls.push(cell);
            });

            resultsList = new List(document.getElementById('list-search-results'), {
                itemHeight: 72,
                visibleCount: 12,
                renderRow: window.BrowseScreen.renderChannelRow
            });
        },

        show: function () {
            visible = true;
            el.screen.classList.remove('hidden');
            renderGrid();
            renderQuery();
            if (!dataReady) showHint('Loading channels…');

            window.BrowseScreen.whenChannelsLoaded().then(function (result) {
                if (!visible) return;
                source = result.source;
                channels = result.channels || [];
                buildIndexed();
                dataReady = true;
                filterAndRender();
            });
        },

        hide: function () {
            visible = false;
            el.screen.classList.add('hidden');
        },

        onKey: function (name) {
            if (name === 'BACK') {
                window.App.showReturnScreen();
                return;
            }

            if (area === 'grid') {
                if (name === 'UP') moveGrid(-1, 0);
                else if (name === 'DOWN') moveGrid(1, 0);
                else if (name === 'LEFT') moveGrid(0, -1);
                else if (name === 'RIGHT') moveRightOrToResults();
                else if (name === 'ENTER') activateFocusedKey();
            } else { // results
                if (name === 'LEFT') setArea('grid');
                else if (name === 'UP') resultsList.moveUp();
                else if (name === 'DOWN') resultsList.moveDown();
                else if (name === 'ENTER') {
                    var item = resultsList.getFocused();
                    if (item) window.App.playChannel(source, resultsList.items, resultsList.getFocusedIndex(), 'search');
                } else if (name === 'YELLOW') {
                    var focused = resultsList.getFocused();
                    if (focused) toggleFavorite(focused);
                }
            }
        }
    };

    window.SearchScreen = SearchScreen;
})();
