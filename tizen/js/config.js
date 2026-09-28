/**
 * Persisted app settings (localStorage-backed).
 * Kept deliberately flat and small - this is a single-user sideloaded app.
 */
(function () {
    var KEY = 'nodecast_tv_config';

    function load() {
        try {
            var raw = localStorage.getItem(KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    var state = load();

    function save() {
        try {
            localStorage.setItem(KEY, JSON.stringify(state));
        } catch (e) {
            // ignore quota errors, nothing we can do about it here
        }
    }

    var Config = {
        get: function (key) {
            return state[key];
        },
        set: function (key, value) {
            state[key] = value;
            save();
        },
        setAll: function (obj) {
            for (var k in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, k)) {
                    state[k] = obj[k];
                }
            }
            save();
        },
        clear: function () {
            state = {};
            save();
        },
        // Convenience accessors for the fields we actually use
        isConfigured: function () {
            return !!(state.serverUrl && state.username && state.password);
        }
    };

    window.Config = Config;
})();
