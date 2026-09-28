/**
 * Browse screen: categories on the left, channels + a details panel on the
 * right.
 *
 * Both columns read from the same generic /api/proxy/xtream/:sourceId/*
 * endpoints regardless of whether the source is actually "xtream" or
 * "m3u" - those routes just read the shared SQLite tables server-side,
 * so category_id/live_streams work the same either way. Only building
 * the final playback URL differs by source type (see app.js).
 */
(function () {

    var FAVORITES_ID = '__favorites__';

    var el = {};
    var categoriesList, channelsList;
    var activeColumn = 'categories'; // 'categories' | 'channels'
    var visible = false;

    var sources = [];
    var sourceIndex = 0;
    var categories = [];

    // stream_id -> channel object, and the same data as a flat array, for
    // the whole current source. Populated in the background so Favorites/
    // Recent (which only have ids, not names/icons) and Search (which needs
    // every channel to filter over) can all work without extra requests.
    var allChannelsById = {};
    var allChannelsList = [];
    var allChannelsPromise = null;

    var loadToken = 0; // guards against a slow request landing after a newer one started
    var categoryLoadTimer = null;

    function currentSource() {
        return sources[sourceIndex];
    }

    function setBusy(show) {
        document.getElementById('buffering-spinner').classList.toggle('hidden', !show);
    }

    function showEmpty(msg) {
        el.empty.textContent = msg;
        el.empty.classList.remove('hidden');
    }

    function hideEmpty() {
        el.empty.classList.add('hidden');
    }

    // ---- Rendering ----

    function renderCategoryRow(item, rowEl) {
        rowEl.textContent = item.category_name;
    }

    // Shared with search.js, so search results look the same as browse rows.
    function renderChannelRow(item, rowEl, index) {
        rowEl.innerHTML = '';

        var top = document.createElement('div');
        top.className = 'row-top';

        var num = document.createElement('div');
        num.className = 'row-num';
        num.textContent = index + 1;

        var img = document.createElement('img');
        img.className = 'row-logo';
        if (item.stream_icon) {
            img.src = API.proxy.imageUrl(item.stream_icon);
            img.onerror = function () { img.style.visibility = 'hidden'; };
        } else {
            img.style.visibility = 'hidden';
        }

        var name = document.createElement('div');
        name.className = 'row-name';
        name.textContent = item.name;

        var fav = document.createElement('div');
        fav.className = 'row-fav';
        fav.textContent = window.App.Favorites.has(item.stream_id) ? '★' : '';

        top.appendChild(num);
        top.appendChild(img);
        top.appendChild(name);
        top.appendChild(fav);

        var sub = document.createElement('div');
        sub.className = 'row-sub';
        var info = window.Epg.nowNext(item);
        sub.textContent = (info && info.now) ? (window.Epg.formatTime(info.now.start) + '  ' + info.now.title) : '';

        rowEl.appendChild(top);
        rowEl.appendChild(sub);
    }

    // ---- Details panel ----

    function updateDetails(channel) {
        if (!channel) {
            el.details.classList.add('hidden');
            return;
        }
        el.details.classList.remove('hidden');

        el.detailsLogo.src = channel.stream_icon ? API.proxy.imageUrl(channel.stream_icon) : '';
        el.detailsLogo.style.visibility = channel.stream_icon ? 'visible' : 'hidden';
        el.detailsName.textContent = channel.name;

        var info = window.Epg.nowNext(channel);
        if (!info || !info.now) {
            el.detailsNow.textContent = 'No guide data';
            el.detailsProgress.style.width = '0%';
            el.detailsDesc.textContent = '';
            el.detailsNext.textContent = '';
            return;
        }

        el.detailsNow.textContent = info.now.title + '  (' + window.Epg.formatTime(info.now.start) + ' - ' + window.Epg.formatTime(info.now.stop) + ')';
        el.detailsProgress.style.width = (window.Epg.progress(info.now) * 100) + '%';
        el.detailsDesc.textContent = info.now.desc || '';
        el.detailsNext.textContent = info.next ? ('Next: ' + window.Epg.formatTime(info.next.start) + '  ' + info.next.title) : '';
    }

    function refreshDetailsIfShown() {
        updateDetails(channelsList.getFocused());
    }

    // ---- Data loading ----

    function loadSourcesAndStart() {
        setBusy(true);
        return API.sources.getAll().then(function (all) {
            sources = all.filter(function (s) {
                return s.enabled && (s.type === 'xtream' || s.type === 'm3u');
            });
            setBusy(false);
            if (sources.length === 0) {
                showEmpty('No live sources configured on the server yet. Add one from the nodecast-tv web UI.');
                return;
            }
            hideEmpty();
            var lastId = Config.get('lastSourceId');
            var idx = sources.findIndex(function (s) { return s.id === lastId; });
            sourceIndex = idx >= 0 ? idx : 0;
            selectSource(sourceIndex);
        }).catch(function (err) {
            setBusy(false);
            showEmpty('Could not reach the server: ' + err.message);
        });
    }

    function selectSource(idx) {
        sourceIndex = idx;
        var source = currentSource();
        Config.set('lastSourceId', source.id);
        el.sourceName.textContent = source.name;
        allChannelsById = {};
        allChannelsList = [];
        categories = [];
        channelsList.setItems([]);
        updateDetails(null);

        loadCategories();
        window.App.Favorites.load(source.id).then(refreshFavoritesViewIfFocused);
        loadAllChannelsInBackground();
    }

    // Categories, favorites and the full channel map all load in parallel
    // and in any order. The Favorites category (which needs both the
    // favorite ids AND the full channel map to render anything) is often
    // focused by default on first load, so whichever of these two finishes
    // last needs to (re)render it - neither alone is enough.
    function refreshFavoritesViewIfFocused() {
        channelsList.refresh();
        var focused = categoriesList.getFocused();
        if (focused && focused.kind === 'favorites') loadChannelsForFocusedCategory();
    }

    function loadCategories() {
        var source = currentSource();
        var myToken = ++loadToken;
        setBusy(true);
        API.proxy.xtream.liveCategories(source.id).then(function (cats) {
            if (myToken !== loadToken) return;
            setBusy(false);
            categories = cats;

            var rows = [{ kind: 'search', category_id: '__search__', category_name: 'Search' }];
            if (sources.length > 1) {
                rows.push({ kind: 'source', category_id: '__source__', category_name: 'Source: ' + source.name + ' ▸' });
            }
            rows.push({ kind: 'recent', category_id: '__recent__', category_name: 'Recent' });
            rows.push({ kind: 'favorites', category_id: FAVORITES_ID, category_name: '★ Favorites' });
            for (var i = 0; i < cats.length; i++) {
                rows.push({ kind: 'category', category_id: cats[i].category_id, category_name: cats[i].category_name });
            }
            categoriesList.setItems(rows);

            var favIdx = 0;
            for (var r = 0; r < rows.length; r++) {
                if (rows[r].kind === 'favorites') { favIdx = r; break; }
            }
            categoriesList.setFocusIndex(favIdx);
            categoriesList.setActive(activeColumn === 'categories');
            loadChannelsForFocusedCategory();
        }).catch(function (err) {
            if (myToken !== loadToken) return;
            setBusy(false);
            window.Toast.show('Could not load categories: ' + err.message);
        });
    }

    function loadAllChannelsInBackground() {
        var source = currentSource();
        allChannelsPromise = API.proxy.xtream.liveStreams(source.id).then(function (streams) {
            if (source !== currentSource()) return { source: source, channels: [] }; // source changed while this was in flight
            var map = {};
            for (var i = 0; i < streams.length; i++) map[streams[i].stream_id] = streams[i];
            allChannelsById = map;
            allChannelsList = streams;
            refreshFavoritesViewIfFocused();
            return { source: source, channels: streams };
        }).catch(function () {
            // Non-fatal: Favorites/Recent/Search just won't have data until this succeeds.
            return { source: source, channels: [] };
        });
    }

    function loadChannelsForFocusedCategory() {
        var focused = categoriesList.getFocused();
        if (!focused) return;

        if (focused.kind === 'source' || focused.kind === 'search') {
            channelsList.setItems([]);
            updateDetails(null);
            return;
        }

        if (focused.kind === 'recent') {
            channelsList.setItems(window.App.Recent.list(currentSource().id));
            refreshDetailsIfShown();
            return;
        }

        if (focused.kind === 'favorites') {
            var favIds = window.App.Favorites.ids();
            var favChannels = [];
            for (var i = 0; i < favIds.length; i++) {
                if (allChannelsById[favIds[i]]) favChannels.push(allChannelsById[favIds[i]]);
            }
            channelsList.setItems(favChannels);
            refreshDetailsIfShown();
            return;
        }

        var source = currentSource();
        var myToken = ++loadToken;
        setBusy(true);
        API.proxy.xtream.liveStreams(source.id, focused.category_id).then(function (streams) {
            if (myToken !== loadToken) return;
            setBusy(false);
            channelsList.setItems(streams);
            refreshDetailsIfShown();
        }).catch(function (err) {
            if (myToken !== loadToken) return;
            setBusy(false);
            window.Toast.show('Could not load channels: ' + err.message);
        });
    }

    function scheduleChannelLoad() {
        clearTimeout(categoryLoadTimer);
        categoryLoadTimer = setTimeout(loadChannelsForFocusedCategory, 150);
    }

    function toggleFavorite(item) {
        var source = currentSource();
        window.App.Favorites.toggle(source.id, item.stream_id).catch(function (err) {
            channelsList.refresh();
            window.Toast.show('Could not update favorite: ' + err.message);
        });
        channelsList.refresh(); // reflect the optimistic update immediately

        // If we're currently looking at the Favorites list itself, reflect
        // the change immediately instead of waiting for a re-visit.
        var focusedCategory = categoriesList.getFocused();
        if (focusedCategory && focusedCategory.kind === 'favorites') {
            loadChannelsForFocusedCategory();
        }
    }

    // ---- Column focus ----

    function setColumn(name) {
        if (name === activeColumn) return;
        if (name === 'channels' && channelsList.items.length === 0) return;
        activeColumn = name;
        categoriesList.setActive(activeColumn === 'categories');
        channelsList.setActive(activeColumn === 'channels');
    }

    // ---- Public screen API ----

    var BrowseScreen = {
        init: function () {
            el.screen = document.getElementById('screen-browse');
            el.sourceName = document.getElementById('browse-source-name');
            el.empty = document.getElementById('browse-empty');
            el.details = document.getElementById('browse-details');
            el.detailsLogo = document.getElementById('browse-details-logo');
            el.detailsName = document.getElementById('browse-details-name');
            el.detailsNow = document.getElementById('browse-details-now');
            el.detailsProgress = document.getElementById('browse-details-progress-fill');
            el.detailsDesc = document.getElementById('browse-details-desc');
            el.detailsNext = document.getElementById('browse-details-next');

            categoriesList = new List(document.getElementById('list-categories'), {
                itemHeight: 56,
                visibleCount: 15,
                renderRow: renderCategoryRow
            });
            channelsList = new List(document.getElementById('list-channels'), {
                itemHeight: 72,
                visibleCount: 12,
                renderRow: renderChannelRow
            });

            window.Epg.onChange(function () {
                if (!visible) return;
                channelsList.refresh();
                refreshDetailsIfShown();
            });
        },

        show: function () {
            visible = true;
            el.screen.classList.remove('hidden');
            categoriesList.setActive(activeColumn === 'categories');
            channelsList.setActive(activeColumn === 'channels');
            if (sources.length === 0) {
                loadSourcesAndStart();
            } else {
                refreshDetailsIfShown();
            }
        },

        hide: function () {
            visible = false;
            el.screen.classList.add('hidden');
        },

        // So playing.js can hand the browse screen an already-known list to
        // keep zapping context consistent (see app.js playChannel()).
        getCurrentChannelList: function () {
            return channelsList.items;
        },

        // So search.js can filter over every channel of the current source
        // without re-fetching it. Resolves once the background load (kicked
        // off by selectSource()) finishes.
        whenChannelsLoaded: function () {
            return allChannelsPromise || Promise.resolve({ source: currentSource(), channels: allChannelsList });
        },

        renderChannelRow: renderChannelRow,

        onKey: function (name) {
            if (name === 'BACK') {
                if (window.App.isPlaying()) {
                    window.App.showPlaying();
                } else {
                    window.App.exit();
                }
                return;
            }

            if (name === 'BLUE') {
                window.App.showSearch();
                return;
            }

            if (name === 'LEFT') {
                setColumn('categories');
                return;
            }
            if (name === 'RIGHT') {
                setColumn('channels');
                return;
            }

            if (activeColumn === 'categories') {
                if (name === 'UP' || name === 'DOWN') {
                    var moved = name === 'UP' ? categoriesList.moveUp() : categoriesList.moveDown();
                    if (moved) scheduleChannelLoad();
                } else if (name === 'ENTER') {
                    var focused = categoriesList.getFocused();
                    if (focused && focused.kind === 'source') {
                        selectSource((sourceIndex + 1) % sources.length);
                    } else if (focused && focused.kind === 'search') {
                        window.App.showSearch();
                    } else {
                        setColumn('channels');
                    }
                }
            } else { // channels column
                if (name === 'UP') {
                    if (channelsList.moveUp()) refreshDetailsIfShown();
                } else if (name === 'DOWN') {
                    if (channelsList.moveDown()) refreshDetailsIfShown();
                } else if (name === 'ENTER') {
                    var item = channelsList.getFocused();
                    if (item) {
                        window.App.playChannel(currentSource(), channelsList.items, channelsList.getFocusedIndex(), 'browse');
                    }
                } else if (name === 'YELLOW') {
                    var focusedChannel = channelsList.getFocused();
                    if (focusedChannel) toggleFavorite(focusedChannel);
                }
            }
        }
    };

    window.BrowseScreen = BrowseScreen;
})();
