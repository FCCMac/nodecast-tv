/**
 * Setup screen: server URL + login. Shown on first run, and again if
 * silent re-login ever fails outright (bad/changed password).
 *
 * Text inputs handle their own up/down/enter navigation directly (the
 * global Keys dispatcher deliberately leaves editable fields alone - see
 * keys.js), everything else (the Connect button, Back) goes through the
 * normal onKey() path like any other screen.
 */
(function () {

    var el = {};
    var order = []; // [serverInput, usernameInput, passwordInput, connectButton]

    function spinner(show) {
        document.getElementById('buffering-spinner').classList.toggle('hidden', !show);
    }

    function showError(msg) {
        el.error.textContent = msg;
        el.error.classList.remove('hidden');
    }

    function hideError() {
        el.error.classList.add('hidden');
    }

    function focusIndex(i) {
        if (i < 0 || i >= order.length) return;
        order[i].focus();
    }

    function indexOf(target) {
        for (var i = 0; i < order.length; i++) if (order[i] === target) return i;
        return -1;
    }

    function attachFieldNav(field) {
        field.addEventListener('keydown', function (e) {
            var i = indexOf(field);
            if (e.keyCode === 38) { // up
                e.preventDefault();
                focusIndex(i - 1);
            } else if (e.keyCode === 40) { // down
                e.preventDefault();
                focusIndex(i + 1);
            } else if (e.keyCode === 13 && field.tagName === 'INPUT') { // enter
                e.preventDefault();
                focusIndex(i + 1);
            }
        });
    }

    function normalizeServerUrl(raw) {
        var url = raw.trim();
        if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
        return url.replace(/\/+$/, '');
    }

    function tryConnect() {
        var serverUrl = normalizeServerUrl(el.server.value);
        var username = el.username.value.trim();
        var password = el.password.value;

        if (!el.server.value.trim() || !username || !password) {
            showError('Please fill in all fields.');
            return;
        }

        hideError();
        spinner(true);
        Config.set('serverUrl', serverUrl);

        API.login(username, password).then(function () {
            Config.set('username', username);
            Config.set('password', password);
            spinner(false);
            window.App.onLoggedIn();
        }).catch(function (err) {
            spinner(false);
            showError(err.message || 'Could not connect to the server.');
        });
    }

    var SetupScreen = {
        init: function () {
            el.screen = document.getElementById('screen-setup');
            el.server = document.getElementById('input-server');
            el.username = document.getElementById('input-username');
            el.password = document.getElementById('input-password');
            el.connect = document.getElementById('btn-connect');
            el.error = document.getElementById('setup-error');

            order = [el.server, el.username, el.password, el.connect];
            attachFieldNav(el.server);
            attachFieldNav(el.username);
            attachFieldNav(el.password);

            el.connect.addEventListener('click', tryConnect);

            var savedUrl = Config.get('serverUrl');
            var savedUser = Config.get('username');
            if (savedUrl) el.server.value = savedUrl;
            if (savedUser) el.username.value = savedUser;
        },

        show: function () {
            el.screen.classList.remove('hidden');
            hideError();
            (el.server.value ? el.username : el.server).focus();
        },

        hide: function () {
            el.screen.classList.add('hidden');
        },

        onKey: function (name) {
            var active = document.activeElement;
            if (name === 'BACK') {
                window.App.exit();
            } else if (name === 'ENTER' && active === el.connect) {
                tryConnect();
            } else if (name === 'UP' && active === el.connect) {
                el.password.focus();
            }
        }
    };

    window.SetupScreen = SetupScreen;
})();
