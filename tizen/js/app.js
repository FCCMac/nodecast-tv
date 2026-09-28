/**
 * App bootstrap: screen routing, shared Favorites cache, Toast/Spinner
 * helpers, and channel playback orchestration (the one piece both the
 * browse and playing screens need to call into).
 */
(function () {

    var state = {
        screen: 'setup', // 'setup' | 'browse' | 'search' | 'playing'
        returnScreen: 'browse', // where BACK from playing should go: 'browse' | 'search'
        searchReturnScreen: 'browse', // where BACK from search should go: 'browse' | 'playing'
        currentSource: null,
        currentList: [],
        currentIndex: -1,
        previous: null // { source, list, index } of the last channel played before the current one
    };

    // ---- Toast ----------------------------------------------------------------

    var toastTimer = null;
    var Toast = {
        show: function (msg, ms) {
            var el = document.getElementById('global-toast');
            el.textContent = msg;
            el.classList.remove('hidden');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(function () { el.classList.add('hidden'); }, ms || 3500);
        }
    };
    window.Toast = Toast;

    var Spinner = {
        show: function () { document.getElementById('buffering-spinner').classList.remove('hidden'); },
        hide: function () { document.getElementById('buffering-spinner').classList.add('hidden'); }
    };
    window.Spinner = Spinner;

    // ---- Favorites (shared between the browse and playing screens) ------------

    var favIds = {}; // stream_id -> true, for the currently selected source
    var favSourceId = null;

    var Favorites = {
        load: function (sourceId) {
            favSourceId = sourceId;
            return API.favorites.getAll(sourceId, 'channel').then(function (favs) {
                if (favSourceId !== sourceId) return; // a newer load() has since started
                var map = {};
                for (var i = 0; i < favs.length; i++) map[favs[i].item_id] = true;
                favIds = map;
            }).catch(function () {
                favIds = {};
            });
        },
        has: function (id) {
            return !!favIds[id];
        },
        ids: function () {
            return Object.keys(favIds);
        },
        toggle: function (sourceId, id) {
            var was = !!favIds[id];
            if (was) delete favIds[id]; else favIds[id] = true;
            var call = was ? API.favorites.remove : API.favorites.add;
            return call(sourceId, id, 'channel').catch(function (err) {
                if (was) favIds[id] = true; else delete favIds[id];
                throw err;
            });
        }
    };

    // ---- Recent channels (per source, kept locally on the TV) -----------------

    var RECENT_LIMIT = 20;

    var Recent = {
        list: function (sourceId) {
            var all = Config.get('recentChannels') || {};
            return all[sourceId] || [];
        },
        add: function (sourceId, channel) {
            var all = Config.get('recentChannels') || {};
            var list = all[sourceId] || [];
            list = list.filter(function (c) { return c.stream_id !== channel.stream_id; });
            list.unshift(channel);
            if (list.length > RECENT_LIMIT) list.length = RECENT_LIMIT;
            all[sourceId] = list;
            Config.set('recentChannels', all);
        }
    };

    // ---- Screen routing ---------------------------------------------------

    function screenFor(name) {
        return name === 'setup' ? window.SetupScreen
             : name === 'browse' ? window.BrowseScreen
             : name === 'search' ? window.SearchScreen
             : window.PlayingScreen;
    }

    function dispatchKey(name) {
        var screen = screenFor(state.screen);
        if (screen && screen.onKey) screen.onKey(name);
    }

    function showBrowse() {
        state.screen = 'browse';
        window.PlayingScreen.hide();
        window.SearchScreen.hide();
        window.BrowseScreen.show();
    }

    // Just displays the search screen, without touching searchReturnScreen -
    // used by showReturnScreen() to restore an in-progress search, so
    // returning from THAT doesn't clobber where search was originally
    // opened from (see showSearch() below).
    function showSearchScreen() {
        state.screen = 'search';
        window.PlayingScreen.hide();
        window.BrowseScreen.hide();
        window.SearchScreen.show();
    }

    // Remembers whatever screen we're leaving as search's own BACK target -
    // search can be opened from browse (the Search row, or BLUE) or from
    // playing (BLUE), and BACK should undo whichever of those happened.
    // Only for a fresh, user-initiated open - see showSearchScreen() above.
    function showSearch() {
        state.searchReturnScreen = state.screen === 'playing' ? 'playing' : 'browse';
        showSearchScreen();
    }

    function showPlaying() {
        state.screen = 'playing';
        window.BrowseScreen.hide();
        window.SearchScreen.hide();
        window.PlayingScreen.show();
    }

    // BACK from playing goes to wherever playChannel() was called from
    // (browse or search, see state.returnScreen below); BACK from search
    // goes to wherever showSearch() was opened from.
    function showReturnScreen() {
        if (state.screen === 'playing') {
            if (state.returnScreen === 'search') showSearchScreen(); else showBrowse();
        } else if (state.screen === 'search') {
            if (state.searchReturnScreen === 'playing') showPlaying(); else showBrowse();
        } else {
            showBrowse();
        }
    }

    function isPlaying() {
        return state.currentIndex !== -1;
    }

    // ---- Playback orchestration ---------------------------------------------

    function resolveStreamUrl(source, channel, container) {
        if (source.type === 'xtream') {
            return API.proxy.xtream.getStreamUrl(source.id, channel.stream_id, container).then(function (r) { return r.url; });
        }
        return Promise.resolve(channel.stream_url);
    }

    function attemptPlay(source, channel, container, isRetry) {
        resolveStreamUrl(source, channel, container).then(function (url) {
            Player.play(url, {
                onPlaying: function () {
                    Spinner.hide();
                    window.PlayingScreen.setError(null);
                },
                onBuffering: function (isBuffering) {
                    if (isBuffering) Spinner.show(); else Spinner.hide();
                },
                onError: function (msg) {
                    // The provider URL for the "live" type has a container
                    // extension (ts/m3u8); a codec/format the TV doesn't
                    // like on one often works fine as the other. Try once.
                    if (source.type === 'xtream' && container === 'ts' && !isRetry) {
                        attemptPlay(source, channel, 'm3u8', true);
                        return;
                    }
                    Spinner.hide();
                    window.PlayingScreen.setError('Could not play "' + channel.name + '". ' + msg);
                },
                onEnded: function () {
                    window.PlayingScreen.setError('Stream ended.');
                }
            });
        }).catch(function (err) {
            Spinner.hide();
            window.PlayingScreen.setError('Could not get a stream URL: ' + err.message);
        });
    }

    /**
     * Plays list[index] (wrapping around), remembers it as the zapping
     * context and as the "resume on next launch" channel, and switches to
     * the playing screen.
     *
     * fromScreen ('browse' | 'search') records where this call came from,
     * so BACK from the playing screen returns there - see showReturnScreen().
     * Omitted on a same-channel retry, which leaves it (and everything else
     * about "previous"/Recent) untouched.
     */
    function playChannel(source, list, index, fromScreen) {
        if (!list.length) return;
        var idx = ((index % list.length) + list.length) % list.length;
        var channel = list[idx];

        var isNewChannel = !isPlaying() || state.currentSource.id !== source.id || state.currentList[state.currentIndex].stream_id !== channel.stream_id;
        if (isNewChannel && isPlaying()) {
            state.previous = { source: state.currentSource, list: state.currentList, index: state.currentIndex };
        }

        state.currentSource = source;
        state.currentList = list;
        state.currentIndex = idx;
        if (fromScreen) state.returnScreen = fromScreen;

        Config.set('lastSourceId', source.id);
        Config.set('lastChannel', { source: { id: source.id, type: source.type }, channel: channel });
        if (isNewChannel) Recent.add(source.id, channel);

        window.PlayingScreen.onChannelChanging(source, list, idx);
        showPlaying();
        Spinner.show();
        attemptPlay(source, channel, source.type === 'xtream' ? 'ts' : null, false);
    }

    function retryCurrent() {
        if (!isPlaying()) return;
        playChannel(state.currentSource, state.currentList, state.currentIndex);
    }

    function playPrevious() {
        if (!state.previous) return;
        var prev = state.previous;
        playChannel(prev.source, prev.list, prev.index, state.returnScreen);
    }

    function exit() {
        try {
            tizen.application.getCurrentApplication().exit();
        } catch (e) {
            console.log('App.exit() - not running on the TV, nothing to do');
        }
    }

    // ---- Boot ----------------------------------------------------------------

    function boot() {
        Config.init && Config.init();
        Keys.init();
        Player.init(document.getElementById('dev-video'));
        Keys.setHandler(dispatchKey);

        SetupScreen.init();
        BrowseScreen.init();
        SearchScreen.init();
        PlayingScreen.init();

        document.addEventListener('visibilitychange', function () {
            if (document.hidden) Player.suspend();
            else Player.restore();
        });

        if (!Config.isConfigured()) {
            state.screen = 'setup';
            SetupScreen.show();
            return;
        }

        Epg.load();

        var lastChannel = Config.get('lastChannel');
        if (lastChannel && lastChannel.source && lastChannel.channel) {
            // Resume immediately for a snappy startup; browse's own channel
            // list loads lazily the first time the user opens it (Back).
            playChannel(lastChannel.source, [lastChannel.channel], 0);
        } else {
            state.screen = 'browse';
            BrowseScreen.show();
        }
    }

    window.App = {
        Favorites: Favorites,
        Recent: Recent,
        playChannel: playChannel,
        playPrevious: playPrevious,
        retryCurrent: retryCurrent,
        showBrowse: showBrowse,
        showSearch: showSearch,
        showPlaying: showPlaying,
        showReturnScreen: showReturnScreen,
        isPlaying: isPlaying,
        onLoggedIn: function () {
            state.screen = 'browse';
            SetupScreen.hide();
            BrowseScreen.show();
            Epg.load();
        },
        exit: exit
    };

    document.addEventListener('DOMContentLoaded', boot);
})();
