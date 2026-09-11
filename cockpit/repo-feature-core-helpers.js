/* Shared repository-manager helpers for bulk actions. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    function parseStatus(out) {
        var rows = [];
        out.split("\n").forEach(function (line) {
            var f = line.split("\t");
            if (f[0] !== "repo" || !f[1]) return;
            rows.push({
                name: f[1],
                branch: f[2] || "",
                dirty: parseInt(f[3], 10) || 0,
                ahead: parseInt(f[4], 10) || 0,
                behind: parseInt(f[5], 10) || 0,
                stashes: parseInt(f[6], 10) || 0,
                unpushed: parseInt(f[7], 10) || 0
            });
        });
        return rows;
    }

    m.statusSnapshot = function () {
        return m.runCore(["status"]).then(parseStatus);
    };

    m.mapLimit = function (items, limit, worker) {
        var next = 0, active = 0, results = new Array(items.length);
        limit = Math.max(1, parseInt(limit, 10) || 1);
        return new Promise(function (resolve, reject) {
            function pump() {
                if (next >= items.length && active === 0) { resolve(results); return; }
                while (active < limit && next < items.length) {
                    (function (index) {
                        active += 1;
                        Promise.resolve().then(function () { return worker(items[index], index); })
                            .then(function (value) { results[index] = value; }, reject)
                            .then(function () { active -= 1; pump(); });
                    })(next++);
                }
            }
            pump();
        });
    };
})();
