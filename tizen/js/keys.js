/**
 * Remote control input.
 *
 * Normalizes both the Samsung remote (via webapis.tvinputdevice keyCodes)
 * and a regular keyboard (for the desktop Chrome dev loop) into a small
 * set of named actions, then dispatches them to whichever screen is
 * currently active (see app.js).
 */
(function () {

    // Desktop keyboard fallbacks, by DOM keyCode. These always apply.
    var DESKTOP_MAP = {
        37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN',
        13: 'ENTER', 32: 'PLAY_PAUSE',
        27: 'BACK', 8: 'BACK',
        33: 'CH_UP', 34: 'CH_DOWN',       // PageUp / PageDown
        82: 'RED', 71: 'GREEN', 89: 'YELLOW', 66: 'BLUE', // r g y b
        80: 'PREV_CH', // p
        48: '0', 49: '1', 50: '2', 51: '3', 52: '4',
        53: '5', 54: '6', 55: '7', 56: '8', 57: '9'
    };

    // Known Samsung TV remote keyCodes as a fallback if registerKey()
    // isn't available for some reason. registerKey's resolved codes
    // (below) take priority when present.
    var TV_FALLBACK = {
        10009: 'BACK',
        10252: 'PLAY_PAUSE',
        427: 'CH_UP', 428: 'CH_DOWN',
        403: 'RED', 404: 'GREEN', 405: 'YELLOW', 406: 'BLUE'
    };

    var KEY_MAP = {};
    for (var k in DESKTOP_MAP) KEY_MAP[k] = DESKTOP_MAP[k];
    for (var k2 in TV_FALLBACK) if (!(k2 in KEY_MAP)) KEY_MAP[k2] = TV_FALLBACK[k2];

    var TV_KEY_NAMES = {
        'Back': 'BACK',
        'MediaPlayPause': 'PLAY_PAUSE',
        'ChannelUp': 'CH_UP',
        'ChannelDown': 'CH_DOWN',
        'ColorF0Red': 'RED',
        'ColorF1Green': 'GREEN',
        'ColorF2Yellow': 'YELLOW',
        'ColorF3Blue': 'BLUE',
        'PreviousChannel': 'PREV_CH'
    };

    function registerTvKeys() {
        if (typeof tizen === 'undefined' || !tizen.tvinputdevice) return;
        for (var tvName in TV_KEY_NAMES) {
            try {
                tizen.tvinputdevice.registerKey(tvName);
                var info = tizen.tvinputdevice.getKey(tvName);
                if (info && typeof info.code === 'number') {
                    KEY_MAP[info.code] = TV_KEY_NAMES[tvName];
                }
            } catch (e) {
                console.warn('Could not register TV key', tvName, e.message);
            }
        }
    }

    var handler = null; // function(name, rawEvent)

    function isEditable(el) {
        return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    }

    function onKeyDown(e) {
        var name = KEY_MAP[e.keyCode];
        if (!name) return;

        // While a text field is focused, let the browser/IME handle
        // navigation and text entry normally. Only BACK is still routed
        // through to the app (screens use it to blur/cancel the field).
        if (isEditable(document.activeElement) && name !== 'BACK') {
            return;
        }

        e.preventDefault();
        if (handler) handler(name, e);
    }

    var Keys = {
        init: function () {
            registerTvKeys();
            document.addEventListener('keydown', onKeyDown);
        },
        setHandler: function (fn) {
            handler = fn;
        }
    };

    window.Keys = Keys;
})();
