/**
 * EPG (electronic program guide) data: now/next lookups for the browse and
 * playing screens, and program-title search.
 *
 * Merges /api/proxy/epg/:sourceId across every enabled 'epg' or 'xtream'
 * source (same approach as public/js/components/EpgGuide.js), matching
 * channels to EPG entries by epg_channel_id first, falling back to a
 * lowercased name match when a provider doesn't set one.
 *
 * Data is pruned to a 12-hour forward window right after fetch - the raw
 * feed covers +/-24h and can be large, and nothing here needs more than a
 * "what's on now and next" lookup.
 */
(function () {

    var REFRESH_MS = 30 * 60 * 1000; // re-fetch from the server every 30 min
    var TICK_MS = 60 * 1000;         // recompute now/next + progress every 60s
    var PRUNE_AHEAD_MS = 12 * 60 * 60 * 1000;

    // channelId -> [{start, stop, title, desc}], sorted by start ascending
    var progsByChannel = {};
    // lowercased EPG channel name -> channelId, for the name-match fallback
    var nameToId = {};

    var listeners = [];
    var refreshTimer = null;
    var tickTimer = null;

    function notify() {
        for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](); } catch (e) { /* a bad listener shouldn't break the others */ }
        }
    }

    function fetchOne(sourceId) {
        return API.proxy.epg(sourceId).catch(function (err) {
            console.warn('Epg: could not load source ' + sourceId + ': ' + err.message);
            return null;
        });
    }

    function buildIndexes(results) {
        var now = Date.now();
        var maxStart = now + PRUNE_AHEAD_MS;

        var newProgsByChannel = {};
        var newNameToId = {};

        for (var i = 0; i < results.length; i++) {
            var data = results[i];
            if (!data) continue;

            var channels = data.channels || [];
            for (var c = 0; c < channels.length; c++) {
                var ch = channels[c];
                if (ch.name) newNameToId[String(ch.name).toLowerCase()] = ch.id;
            }

            var programmes = data.programmes || [];
            for (var p = 0; p < programmes.length; p++) {
                var prog = programmes[p];
                var start = new Date(prog.start).getTime();
                var stop = new Date(prog.stop).getTime();
                if (isNaN(start) || isNaN(stop)) continue;
                if (stop <= now || start >= maxStart) continue; // prune

                var list = newProgsByChannel[prog.channelId];
                if (!list) list = newProgsByChannel[prog.channelId] = [];
                list.push({ start: start, stop: stop, title: prog.title || '', desc: prog.description || '' });
            }
        }

        for (var chId in newProgsByChannel) {
            newProgsByChannel[chId].sort(function (a, b) { return a.start - b.start; });
        }

        progsByChannel = newProgsByChannel;
        nameToId = newNameToId;
    }

    function load() {
        return API.sources.getAll().then(function (all) {
            var sources = all.filter(function (s) {
                return s.enabled && (s.type === 'epg' || s.type === 'xtream');
            });
            if (sources.length === 0) return;
            return Promise.all(sources.map(function (s) { return fetchOne(s.id); })).then(function (results) {
                buildIndexes(results);
                notify();
            });
        }).catch(function (err) {
            console.warn('Epg: load failed: ' + err.message);
        });
    }

    function resolveChannelId(channel) {
        if (channel.epg_channel_id && progsByChannel[channel.epg_channel_id]) {
            return channel.epg_channel_id;
        }
        var byName = channel.name && nameToId[String(channel.name).toLowerCase()];
        if (byName && progsByChannel[byName]) return byName;
        // Some providers' epg_channel_id has no matching programmes but is
        // still the right key (e.g. a channel with no schedule right now) -
        // prefer it over nothing.
        return channel.epg_channel_id || byName || null;
    }

    // Returns { now: prog|null, next: prog|null } or null if there's no
    // programme data at all for this channel.
    function nowNext(channel) {
        var chId = resolveChannelId(channel);
        if (!chId) return null;
        var list = progsByChannel[chId];
        if (!list || list.length === 0) return null;

        var now = Date.now();
        var current = null, next = null;
        for (var i = 0; i < list.length; i++) {
            var prog = list[i];
            if (prog.stop <= now) continue;
            if (prog.start <= now && now < prog.stop) {
                current = prog;
                next = list[i + 1] || null;
                break;
            }
            if (prog.start > now) {
                next = prog;
                break;
            }
        }
        if (!current && !next) return null;
        return { now: current, next: next };
    }

    function progress(prog) {
        if (!prog) return 0;
        var now = Date.now();
        var span = prog.stop - prog.start;
        if (span <= 0) return 0;
        var frac = (now - prog.start) / span;
        return Math.max(0, Math.min(1, frac));
    }

    function pad2(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    function formatTime(ms) {
        var d = new Date(ms);
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    function onChange(fn) {
        listeners.push(fn);
    }

    function startTimers() {
        clearInterval(refreshTimer);
        clearInterval(tickTimer);
        refreshTimer = setInterval(load, REFRESH_MS);
        tickTimer = setInterval(notify, TICK_MS);
    }

    window.Epg = {
        load: function () {
            startTimers();
            return load();
        },
        nowNext: nowNext,
        progress: progress,
        formatTime: formatTime,
        onChange: onChange
    };
})();
