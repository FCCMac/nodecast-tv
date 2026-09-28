/**
 * API client for the nodecast-tv server.
 * Same endpoints/shapes as public/js/api.js, but with an absolute base URL
 * (the TV app is never same-origin with the server) and silent re-login
 * on a 401, since there's no login.html to redirect to here.
 */
(function () {

    function base() {
        var url = Config.get('serverUrl') || '';
        return url.replace(/\/+$/, '');
    }

    var reloginPromise = null;

    function login(username, password) {
        return fetch(base() + '/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        }).then(function (res) {
            return res.json().then(function (body) {
                if (!res.ok) {
                    throw new Error(body.error || ('Login failed (' + res.status + ')'));
                }
                return body;
            });
        }).then(function (body) {
            Config.set('token', body.token);
            Config.set('user', body.user);
            return body;
        });
    }

    // Re-login once using the stored credentials, sharing one in-flight
    // attempt across concurrent requests that all hit a 401 at once.
    function reloginOnce() {
        if (!reloginPromise) {
            var user = Config.get('username');
            var pass = Config.get('password');
            if (!user || !pass) {
                reloginPromise = Promise.reject(new Error('Not logged in'));
            } else {
                reloginPromise = login(user, pass).then(function (body) {
                    reloginPromise = null;
                    return body;
                }, function (err) {
                    reloginPromise = null;
                    throw err;
                });
            }
        }
        return reloginPromise;
    }

    function request(method, endpoint, data, retried) {
        var opts = {
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };
        var token = Config.get('token');
        if (token) {
            opts.headers['Authorization'] = 'Bearer ' + token;
        }
        if (data !== undefined && data !== null) {
            opts.body = JSON.stringify(data);
        }

        return fetch(base() + '/api' + endpoint, opts).then(function (res) {
            if (res.status === 401 && !retried) {
                return reloginOnce().then(function () {
                    return request(method, endpoint, data, true);
                });
            }

            var contentType = res.headers.get('content-type') || '';
            var bodyPromise = contentType.indexOf('application/json') !== -1
                ? res.json()
                : res.text().then(function (t) { return { error: t || ('HTTP ' + res.status) }; });

            return bodyPromise.then(function (body) {
                if (!res.ok) {
                    throw new Error((body && body.error) || ('Server responded with ' + res.status));
                }
                return body;
            });
        });
    }

    var API = {
        login: login,

        auth: {
            me: function () { return request('GET', '/auth/me'); }
        },

        sources: {
            getAll: function () { return request('GET', '/sources'); }
        },

        proxy: {
            xtream: {
                liveCategories: function (sourceId) {
                    return request('GET', '/proxy/xtream/' + sourceId + '/live_categories');
                },
                liveStreams: function (sourceId, categoryId) {
                    var q = categoryId ? ('?category_id=' + encodeURIComponent(categoryId)) : '';
                    return request('GET', '/proxy/xtream/' + sourceId + '/live_streams' + q);
                },
                getStreamUrl: function (sourceId, streamId, container) {
                    return request('GET', '/proxy/xtream/' + sourceId + '/stream/' + streamId + '/live?container=' + (container || 'ts'));
                }
            },
            epg: function (sourceId) {
                return request('GET', '/proxy/epg/' + sourceId);
            },
            m3u: {
                get: function (sourceId) {
                    return request('GET', '/proxy/m3u/' + sourceId);
                }
            },
            imageUrl: function (url) {
                if (!url) return '';
                return base() + '/api/proxy/image?url=' + encodeURIComponent(url);
            }
        },

        favorites: {
            getAll: function (sourceId, itemType) {
                var params = [];
                if (sourceId) params.push('sourceId=' + sourceId);
                if (itemType) params.push('itemType=' + itemType);
                var q = params.length ? ('?' + params.join('&')) : '';
                return request('GET', '/favorites' + q);
            },
            add: function (sourceId, itemId, itemType) {
                return request('POST', '/favorites', { sourceId: sourceId, itemId: itemId, itemType: itemType || 'channel' });
            },
            remove: function (sourceId, itemId, itemType) {
                return request('DELETE', '/favorites', { sourceId: sourceId, itemId: itemId, itemType: itemType || 'channel' });
            }
        }
    };

    window.API = API;
})();
