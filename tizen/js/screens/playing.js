/**
 * Fullscreen playing screen: info banner over the video, channel zapping,
 * favorite toggle, and the playback-error overlay.
 *
 * Zapping is debounced - providers commonly allow only one active
 * connection per account, so rattling through channels shouldn't open a
 * new stream on every single key press, only once the user settles on one.
 */
(function () {

    var ZAP_DEBOUNCE_MS = 500;
    var BANNER_HIDE_MS = 4000;

    var el = {};

    var localSource = null;
    var localList = [];
    var localIndex = -1;  // the channel actually committed to Player.play()
    var pendingIndex = -1; // where zapping currently points, before the debounce fires

    var zapTimer = null;
    var hideTimer = null;

    function displayChannel(channel, index) {
        el.logo.src = channel.stream_icon ? API.proxy.imageUrl(channel.stream_icon) : '';
        el.logo.style.visibility = channel.stream_icon ? 'visible' : 'hidden';
        el.number.textContent = (index + 1) + ' / ' + localList.length;
        el.name.textContent = channel.name;
        el.fav.textContent = window.App.Favorites.has(channel.stream_id) ? '★' : '';
        displayNowNext(channel);
    }

    function displayNowNext(channel) {
        var info = window.Epg.nowNext(channel);
        if (!info || !info.now) {
            el.now.textContent = '';
            el.progressFill.style.width = '0%';
            el.next.textContent = '';
            return;
        }
        el.now.textContent = window.Epg.formatTime(info.now.start) + ' - ' + window.Epg.formatTime(info.now.stop) + '  ' + info.now.title;
        el.progressFill.style.width = (window.Epg.progress(info.now) * 100) + '%';
        el.next.textContent = info.next ? ('Next: ' + window.Epg.formatTime(info.next.start) + '  ' + info.next.title) : '';
    }

    function showBanner() {
        el.banner.classList.remove('hidden');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            el.banner.classList.add('hidden');
        }, BANNER_HIDE_MS);
    }

    function commitZap() {
        window.App.playChannel(localSource, localList, pendingIndex);
    }

    function zap(delta) {
        if (!localList.length) return;
        pendingIndex = ((pendingIndex + delta) % localList.length + localList.length) % localList.length;
        displayChannel(localList[pendingIndex], pendingIndex);
        showBanner();
        clearTimeout(zapTimer);
        zapTimer = setTimeout(commitZap, ZAP_DEBOUNCE_MS);
    }

    var PlayingScreen = {
        init: function () {
            el.screen = document.getElementById('screen-playing');
            el.banner = document.getElementById('playing-banner');
            el.logo = document.getElementById('playing-logo');
            el.number = document.getElementById('playing-number');
            el.name = document.getElementById('playing-name');
            el.fav = document.getElementById('playing-fav');
            el.error = document.getElementById('playing-error');
            el.errorText = document.getElementById('playing-error-text');
            el.now = document.getElementById('playing-now');
            el.progressFill = document.getElementById('playing-progress-fill');
            el.next = document.getElementById('playing-next');

            window.Epg.onChange(function () {
                if (localIndex !== -1 && !el.screen.classList.contains('hidden')) {
                    displayNowNext(localList[localIndex]);
                }
            });
        },

        show: function () {
            el.screen.classList.remove('hidden');
        },

        hide: function () {
            el.screen.classList.add('hidden');
            clearTimeout(hideTimer);
        },

        // Called by App.playChannel() right as a new channel is committed to,
        // whether that came from the browse screen or from zapping settling.
        onChannelChanging: function (source, list, index) {
            localSource = source;
            localList = list;
            localIndex = index;
            pendingIndex = index;
            clearTimeout(zapTimer);
            PlayingScreen.setError(null);
            displayChannel(list[index], index);
            showBanner();
        },

        setError: function (msg) {
            if (msg) {
                el.errorText.textContent = msg;
                el.error.classList.remove('hidden');
            } else {
                el.error.classList.add('hidden');
            }
        },

        onKey: function (name) {
            if (name === 'BACK') {
                window.App.showReturnScreen();
                return;
            }

            if (name === 'BLUE') {
                window.App.showSearch();
                return;
            }

            var errorShowing = !el.error.classList.contains('hidden');

            if (name === 'ENTER') {
                if (errorShowing) window.App.retryCurrent();
                else showBanner();
                return;
            }

            // Arrow Up/Down mirror the existing web UI (up = previous).
            // Channel Up/Down mirror a real remote (channel up = next).
            if (name === 'UP') { zap(-1); return; }
            if (name === 'DOWN') { zap(1); return; }
            if (name === 'CH_UP') { zap(1); return; }
            if (name === 'CH_DOWN') { zap(-1); return; }

            // GREEN mirrors the web UI's shortcut for "previous channel";
            // PREV_CH is the real remote's dedicated key for the same thing.
            if (name === 'GREEN' || name === 'PREV_CH') { window.App.playPrevious(); return; }

            if (name === 'YELLOW' && localIndex !== -1) {
                var channel = localList[localIndex];
                window.App.Favorites.toggle(localSource.id, channel.stream_id).catch(function (err) {
                    displayChannel(localList[localIndex], localIndex);
                    window.Toast.show('Could not update favorite: ' + err.message);
                });
                displayChannel(channel, localIndex); // optimistic star flip
            }
        }
    };

    window.PlayingScreen = PlayingScreen;
})();
