/**
 * Playback backend.
 *
 * On the TV this drives Samsung's AVPlay (webapis.avplay), which
 * hardware-decodes MPEG-TS/HLS with AC3/EAC3/HEVC - the reason nodecast-tv's
 * server-side transcode/remux paths aren't needed here.
 *
 * In desktop Chrome (no `webapis`), it falls back to a plain <video> element,
 * using hls.js (loaded lazily from a CDN) for .m3u8 URLs. This is dev-only;
 * it's how the UI gets built and iterated on without redeploying to the TV
 * every time.
 */
(function () {

    var isTv = typeof webapis !== 'undefined' && webapis.avplay;

    var callbacks = null; // { onPlaying, onBuffering, onError(message), onEnded }
    var currentUrl = null;
    var devVideoEl = null;
    var devHls = null;
    var hlsLoadPromise = null;

    function fire(name) {
        var args = Array.prototype.slice.call(arguments, 1);
        if (callbacks && typeof callbacks[name] === 'function') {
            callbacks[name].apply(null, args);
        }
    }

    // ---- TV backend (AVPlay) -------------------------------------------------

    function tvStop() {
        try { webapis.avplay.stop(); } catch (e) { /* ignore */ }
        try { webapis.avplay.close(); } catch (e) { /* ignore */ }
    }

    function tvPlay(url) {
        tvStop();
        currentUrl = url;
        try {
            webapis.avplay.open(url);
            webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
            try {
                webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
            } catch (e) {
                // Not fatal - some firmwares default to full-screen already.
            }
            try {
                // Default closed captions off - there's no in-app toggle yet,
                // and most providers burn CC into the stream by default.
                webapis.avplay.setSilentSubtitle(true);
            } catch (e) {
                // Not fatal.
            }
            webapis.avplay.setListener({
                onbufferingstart: function () { fire('onBuffering', true); },
                onbufferingcomplete: function () { fire('onBuffering', false); },
                onstreamcompleted: function () { fire('onEnded'); },
                onerror: function (eventType) { fire('onError', 'AVPlay error: ' + eventType); },
                onevent: function (eventType, eventData) {
                    // PLAYER_STREAM_TYPE / PLAYER_ERROR events land here too on some firmwares
                    if (eventType === 'PLAYER_ERROR' || eventType === 'PLAYER_MSG_ERROR') {
                        fire('onError', 'AVPlay event error: ' + eventData);
                    }
                }
            });
            webapis.avplay.prepareAsync(
                function () {
                    try {
                        webapis.avplay.play();
                        fire('onPlaying');
                    } catch (e) {
                        fire('onError', 'AVPlay play() failed: ' + e.message);
                    }
                },
                function (err) {
                    fire('onError', 'AVPlay prepare failed: ' + (err && err.message));
                }
            );
        } catch (e) {
            fire('onError', 'AVPlay open failed: ' + e.message);
        }
    }

    function tvSuspend() {
        try { webapis.avplay.suspend(); } catch (e) { /* ignore */ }
    }

    function tvRestore() {
        try { webapis.avplay.restore(); } catch (e) { /* ignore */ }
    }

    // ---- Desktop dev backend (<video> + hls.js) ------------------------------

    function loadHlsJs() {
        if (window.Hls) return Promise.resolve();
        if (hlsLoadPromise) return hlsLoadPromise;
        hlsLoadPromise = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js';
            s.onload = resolve;
            s.onerror = function () { reject(new Error('Failed to load hls.js')); };
            document.head.appendChild(s);
        });
        return hlsLoadPromise;
    }

    function devTeardown() {
        if (devHls) {
            devHls.destroy();
            devHls = null;
        }
        if (devVideoEl) {
            devVideoEl.pause();
            devVideoEl.removeAttribute('src');
            devVideoEl.load();
        }
    }

    function devPlay(url) {
        devTeardown();
        currentUrl = url;

        function attachErrorHandling() {
            devVideoEl.onwaiting = function () { fire('onBuffering', true); };
            devVideoEl.onplaying = function () { fire('onBuffering', false); fire('onPlaying'); };
            devVideoEl.onended = function () { fire('onEnded'); };
            devVideoEl.onerror = function () {
                var err = devVideoEl.error;
                fire('onError', 'video element error: ' + (err ? err.code : 'unknown'));
            };
        }

        attachErrorHandling();

        var isM3u8 = /\.m3u8($|\?)/i.test(url);
        if (isM3u8 && !devVideoEl.canPlayType('application/vnd.apple.mpegurl')) {
            loadHlsJs().then(function () {
                if (!window.Hls || !window.Hls.isSupported()) {
                    fire('onError', 'hls.js not supported in this browser');
                    return;
                }
                devHls = new window.Hls();
                devHls.on(window.Hls.Events.ERROR, function (evt, data) {
                    if (data.fatal) fire('onError', 'hls.js fatal error: ' + data.type);
                });
                devHls.loadSource(url);
                devHls.attachMedia(devVideoEl);
                devVideoEl.play().catch(function (e) { fire('onError', 'play() rejected: ' + e.message); });
            }).catch(function (e) {
                fire('onError', e.message);
            });
        } else {
            devVideoEl.src = url;
            devVideoEl.play().catch(function (e) { fire('onError', 'play() rejected: ' + e.message); });
        }
    }

    // ---- Public API -----------------------------------------------------------

    var Player = {
        isTv: isTv,

        init: function (devVideoElement) {
            devVideoEl = devVideoElement;
            // This element is only ever used by the desktop dev-loop backend.
            // On the TV it's still in the DOM (same index.html for both), sits
            // at the same z-index as #av-player, comes after it in document
            // order, and has an opaque background - left visible, it paints
            // over the AVPlay hole-punch region and blocks the video plane
            // entirely (while leaving audio/system-rendered CC unaffected).
            if (isTv && devVideoEl) {
                devVideoEl.style.display = 'none';
            }
        },

        play: function (url, cb) {
            callbacks = cb || null;
            if (isTv) tvPlay(url);
            else devPlay(url);
        },

        stop: function () {
            currentUrl = null;
            if (isTv) tvStop();
            else devTeardown();
        },

        getCurrentUrl: function () {
            return currentUrl;
        },

        suspend: function () {
            if (isTv) tvSuspend();
            else if (devVideoEl) devVideoEl.pause();
        },

        restore: function () {
            if (isTv) tvRestore();
            else if (devVideoEl && currentUrl) devVideoEl.play().catch(function () {});
        }
    };

    window.Player = Player;
})();
