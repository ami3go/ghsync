/* Roadmap: Full-sync preview / dry run. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.statusSnapshot) return;

    var running = false;
    function $(id) { return document.getElementById(id); }
    function esc(text) {
        return String(text == null ? "" : text).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }
    function parseCheck(out) {
        var values = {};
        String(out || "").split("\n").forEach(function (line) {
            var f = line.split("\t");
            if (f[0] === "check") values[f[1]] = f[2] || "";
        });
        return values;
    }
    function configDir() {
        return m.runCore(["check"]).then(parseCheck).then(function (check) {
            if (!check.config) throw new Error("Could not determine the ghsync configuration directory");
            return check.config.slice(0, check.config.lastIndexOf("/"));
        });
    }
    function readJson(path) {
        return cockpit.spawn(["cat", "--", path], { err: "ignore", superuser: null }).then(function (out) {
            try { return JSON.parse(out); } catch (e) { return null; }
        }, function () { return null; });
    }
    function exists(name, rows) {
        return rows.some(function (row) { return row.name === name; });
    }
    function readShared(rows) {
        return configDir().then(function (dir) {
            return Promise.all([
                readJson(dir + "/repository-sync-cache.json"),
                readJson(dir + "/repository-sync.json")
            ]).then(function (values) {
                var manifest = values[0], cfg = values[1] || {}, shared = window.GHSyncSharedList;
                if (!manifest || !shared || !shared.normalizeManifest || !shared.assigned) {
                    return { available: false, assigned: [], missing: [], extras: [], groups: [] };
                }
                try { manifest = shared.normalizeManifest(manifest); } catch (e) {
                    return { available: false, assigned: [], missing: [], extras: [], groups: [] };
                }
                var machine = String(cfg.machine || ""), groups = Array.isArray(cfg.groups) ? cfg.groups : [];
                if (!machine) return { available: false, assigned: [], missing: [], extras: [], groups: groups };
                var assigned = shared.assigned(manifest, machine, groups), wanted = {};
                assigned.forEach(function (entry) { wanted[entry.name] = true; });
                return {
                    available: true,
                    machine: machine,
                    groups: groups,
                    assigned: assigned,
                    missing: assigned.filter(function (entry) { return !exists(entry.name, rows); }),
                    extras: rows.filter(function (row) { return !wanted[row.name]; })
                };
            });
        }).catch(function () { return { available: false, assigned: [], missing: [], extras: [], groups: [] }; });
    }
    function classify(rows) {
        var pull = [], protectedRows = [];
        rows.forEach(function (row) {
            var reasons = [];
            if (row.branch === "detached") reasons.push("detached HEAD");
            if (Number(row.dirty) > 0) reasons.push("uncommitted changes");
            if (Number(row.ahead) > 0) reasons.push(row.ahead + " commit(s) ahead");
            if (Number(row.stashes) > 0) reasons.push(row.stashes + " stash(es)");
            if (Number(row.unpushed) > 0) reasons.push(row.unpushed + " unpushed branch(es)");
            if (Number(row.ahead) > 0 && Number(row.behind) > 0) reasons.push("diverged");
            if (reasons.length) protectedRows.push({ name: row.name, reasons: reasons });
            else pull.push(row);
        });
        return { pull: pull, protected: protectedRows };
    }
    function snapshot() {
        return m.statusSnapshot().then(function (rows) {
            var local = classify(rows);
            return readShared(rows).then(function (shared) {
                return {
                    createdAt: new Date().toISOString(),
                    localCount: rows.length,
                    clone: shared.missing,
                    pull: local.pull,
                    protected: local.protected,
                    shared: shared,
                    rows: rows
                };
            });
        });
    }
    function saveSnapshot(data) {
        return configDir().then(function (dir) {
            var path = dir + "/sync-preview.json";
            return cockpit.file(path).replace(JSON.stringify(data, null, 2) + "\n").then(function () { return path; });
        }).catch(function () { return ""; });
    }
    function list(items, map, empty) {
        if (!items.length) return '<p class="ghs-helper">' + esc(empty) + '</p>';
        return '<ul style="margin:.4rem 0 .8rem 1.25rem">' + items.slice(0, 40).map(function (item) {
            return '<li>' + esc(map(item)) + '</li>';
        }).join("") + (items.length > 40 ? '<li>… and ' + (items.length - 40) + ' more</li>' : '') + '</ul>';
    }
    function showPreview(data) {
        return new Promise(function (resolve) {
            var old = $("ghs-sync-preview"); if (old) old.remove();
            var cover = document.createElement("div");
            cover.id = "ghs-sync-preview";
            cover.style.cssText = "position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:1rem";
            var box = document.createElement("div");
            box.style.cssText = "background:var(--ghs-surface,#fff);color:var(--ghs-text,#151515);border:1px solid var(--ghs-border,#d2d2d2);width:min(58rem,96vw);max-height:88vh;overflow:auto;border-radius:6px;padding:1.25rem";
            var sharedSummary = data.shared.available
                ? data.shared.assigned.length + " assigned to " + data.shared.machine + "; " + data.shared.missing.length + " missing; " + data.shared.extras.length + " local not assigned (kept)"
                : "Shared-list cache is unavailable; local Full sync can still proceed.";
            box.innerHTML =
                '<h2 style="margin-top:0">Full sync preview</h2>' +
                '<p class="ghs-helper">This is a dry run. No repository has been changed yet.</p>' +
                '<h3>Clone (' + data.clone.length + ')</h3>' +
                list(data.clone, function (x) { return x.name; }, "No assigned repositories need cloning.") +
                '<h3>Normal pull candidates (' + data.pull.length + ')</h3>' +
                list(data.pull, function (x) { return x.name + (x.behind ? " — " + x.behind + " behind" : ""); }, "No clean repositories are waiting for the normal pull pass.") +
                '<h3>Protected / attention (' + data.protected.length + ')</h3>' +
                list(data.protected, function (x) { return x.name + " — " + x.reasons.join(", "); }, "No local-only work or conflict-risk states detected.") +
                '<h3>Shared-list reconciliation</h3><p>' + esc(sharedSummary) + '</p>' +
                '<p class="ghs-helper">Full sync never force-resets or deletes local repositories. Dirty or diverged work remains visible for manual resolution.</p>';
            var actions = document.createElement("div"); actions.className = "ghs-form-actions";
            var cancel = document.createElement("button"); cancel.className = "ghs-btn ghs-btn--secondary"; cancel.type = "button"; cancel.textContent = "Cancel";
            var proceed = document.createElement("button"); proceed.className = "ghs-btn ghs-btn--primary"; proceed.type = "button"; proceed.textContent = "Proceed with Full sync";
            actions.appendChild(cancel); actions.appendChild(proceed); box.appendChild(actions); cover.appendChild(box); document.body.appendChild(cover);
            function done(value) { cover.remove(); resolve(value); }
            cancel.onclick = function () { done(false); };
            proceed.onclick = function () { done(true); };
            cover.onclick = function (e) { if (e.target === cover) done(false); };
        });
    }
    function hook() {
        var button = $("btn-sync");
        if (!button || button.dataset.previewHook === "yes") return;
        button.dataset.previewHook = "yes";
        var original = button.onclick;
        button.onclick = function (event) {
            if (running) return;
            running = true; button.disabled = true;
            snapshot().then(function (data) {
                return saveSnapshot(data).then(function () { return showPreview(data); }).then(function (ok) {
                    if (ok && original) return original.call(button, event);
                });
            }).catch(function (e) {
                window.alert("Could not build Full sync preview: " + (e.message || String(e)));
            }).finally(function () {
                running = false;
                if (!document.getElementById("busy") || document.getElementById("busy").classList.contains("ghs-hidden")) button.disabled = false;
            });
        };
    }

    window.GHSyncPreview = { snapshot: snapshot, classify: classify };
    hook();
})();
