/* Roadmap: branch overview with safe merged-branch cleanup. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.statusSnapshot || !m.mapLimit) return;
    var tab, panel, selectedRepo = "", lastRows = [];

    function $(id) { return document.getElementById(id); }
    function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function when(epoch) { var n = parseInt(epoch, 10) || 0; return n ? new Date(n * 1000).toLocaleDateString() : "—"; }
    function isOld(epoch) { var n = parseInt(epoch, 10) || 0; return n > 0 && (Date.now() / 1000 - n) > 180 * 86400; }
    function parseLocal(out) {
        return String(out || "").split("\n").filter(Boolean).map(function (line) {
            var f = line.split("\t"); return { name: f[0] || "", upstream: f[1] || "", epoch: parseInt(f[2], 10) || 0, sha: f[3] || "" };
        }).filter(function (row) { return !!row.name; });
    }
    function parseRemote(out) {
        return String(out || "").split("\n").filter(Boolean).map(function (line) {
            var f = line.split("\t"); return { name: f[0] || "", epoch: parseInt(f[1], 10) || 0, sha: f[2] || "" };
        }).filter(function (row) { return row.name && !/\/HEAD$/.test(row.name); });
    }
    function load(name) {
        selectedRepo = name; var status = $("branches-overview-status"); if (status) status.textContent = "Loading branches for " + name + "…";
        return Promise.all([
            m.runGit(name, ["for-each-ref", "--format=%(refname:short)%09%(upstream:short)%09%(committerdate:unix)%09%(objectname:short)", "refs/heads"]),
            m.runGit(name, ["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)%09%(objectname:short)", "refs/remotes"]),
            m.runGit(name, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(function () { return "detached"; }),
            m.runGit(name, ["branch", "--merged", "HEAD", "--format=%(refname:short)"]).catch(function () { return ""; })
        ]).then(function (values) {
            var locals = parseLocal(values[0]), remotes = parseRemote(values[1]), current = values[2].trim(), merged = {};
            values[3].split("\n").filter(Boolean).forEach(function (b) { merged[b.trim()] = true; });
            return m.mapLimit(locals, 5, function (row) {
                row.current = row.name === current; row.merged = !!merged[row.name]; row.stale = isOld(row.epoch); row.ahead = 0; row.behind = 0;
                if (!row.upstream) return row;
                return m.runGit(name, ["rev-list", "--left-right", "--count", row.name + "..." + row.upstream]).then(function (out) {
                    var p = out.trim().split(/\s+/); row.ahead = parseInt(p[0], 10) || 0; row.behind = parseInt(p[1], 10) || 0; return row;
                }, function () { row.upstreamMissing = true; return row; });
            }).then(function () { return { locals: locals, remotes: remotes, current: current }; });
        }).then(function (data) { lastRows = data.locals; render(data); return data; })
            .catch(function (e) { if (status) status.textContent = "Could not load branches: " + (e.message || String(e)); throw e; });
    }
    function render(data) {
        var body = $("branches-overview-body"); if (!body) return; body.textContent = "";
        data.locals.forEach(function (row) {
            var tr = document.createElement("tr"), flags = [];
            if (row.current) flags.push("current"); if (row.merged && !row.current) flags.push("merged"); if (row.stale) flags.push("stale"); if (row.upstreamMissing) flags.push("upstream missing");
            tr.innerHTML = '<td class="ghs-mono">' + esc(row.name) + '</td><td class="ghs-mono">' + esc(row.upstream || "—") + '</td><td>' + row.ahead + '</td><td>' + row.behind + '</td><td>' + esc(when(row.epoch)) + '</td><td>' + esc(flags.join(", ") || "active") + '</td>';
            body.appendChild(tr);
        });
        var remote = $("branches-remote-body"); if (remote) {
            remote.textContent = ""; data.remotes.forEach(function (row) {
                var tr = document.createElement("tr"); tr.innerHTML = '<td class="ghs-mono">' + esc(row.name) + '</td><td>' + esc(when(row.epoch)) + '</td><td class="ghs-mono">' + esc(row.sha) + '</td><td>' + (isOld(row.epoch) ? "stale" : "active") + '</td>'; remote.appendChild(tr);
            });
        }
        $("branches-overview-status").textContent = data.locals.length + " local and " + data.remotes.length + " remote branches. Current: " + data.current;
        var cleanup = $("btn-branches-cleanup"); if (cleanup) cleanup.disabled = !data.locals.some(function (r) { return r.merged && !r.current && ["main", "master", "develop"].indexOf(r.name) < 0; });
    }
    function cleanup() {
        if (!selectedRepo) return;
        var candidates = lastRows.filter(function (r) { return r.merged && !r.current && ["main", "master", "develop"].indexOf(r.name) < 0; });
        if (!candidates.length) return window.alert("No safely merged local branches are available for cleanup.");
        if (!window.confirm("Safely delete these merged local branches from " + selectedRepo + "?\n\n" + candidates.map(function (r) { return r.name; }).join("\n") + "\n\nGit branch -d will still refuse any branch Git considers unmerged. No force-delete is used.")) return;
        var failures = [];
        m.mapLimit(candidates, 1, function (row) {
            return m.runGit(selectedRepo, ["branch", "-d", "--", row.name]).catch(function (e) { failures.push(row.name + ": " + (e.message || String(e))); });
        }).then(function () {
            if (window.GHSyncNotifications && window.GHSyncNotifications.add) window.GHSyncNotifications.add({ variant: failures.length ? "warning" : "success", title: "Branch cleanup finished", body: (candidates.length - failures.length) + " merged branch(es) deleted from " + selectedRepo, details: failures, source: "branches" });
            return load(selectedRepo);
        });
    }
    function fillRepos(preselect) {
        return m.statusSnapshot().then(function (rows) {
            var select = $("branches-repo"); if (!select) return; var current = preselect || select.value || selectedRepo;
            select.textContent = ""; rows.filter(function (r) { return r.branch !== "mirror"; }).forEach(function (r) { var o = document.createElement("option"); o.value = r.name; o.textContent = r.name; select.appendChild(o); });
            if (current && Array.prototype.some.call(select.options, function (o) { return o.value === current; })) select.value = current;
            if (select.value) load(select.value).catch(function () {});
        });
    }
    function selectTab(preselect) {
        document.querySelectorAll(".ghs-tab").forEach(function (item) { var on = item === tab; item.classList.toggle("ghs-tab--current", on); item.setAttribute("aria-selected", on ? "true" : "false"); });
        document.querySelectorAll(".ghs-tab-panel").forEach(function (item) { item.classList.add("ghs-hidden"); }); panel.classList.remove("ghs-hidden"); fillRepos(preselect);
    }
    function createUi() {
        if ($("panel-branches-overview")) return;
        var tabs = document.querySelector(".ghs-tabs"), settings = document.querySelector('.ghs-tab[data-tab="settings"]'), settingsPanel = $("panel-settings"); if (!tabs || !settingsPanel) return;
        tab = document.createElement("button"); tab.className = "ghs-tab"; tab.type = "button"; tab.dataset.tab = "branches-overview"; tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", "false"); tab.textContent = "Branches"; tabs.insertBefore(tab, settings || null);
        panel = document.createElement("section"); panel.id = "panel-branches-overview"; panel.className = "ghs-tab-panel ghs-hidden"; panel.setAttribute("role", "tabpanel");
        panel.innerHTML = '<div class="ghs-form"><div class="ghs-form-row"><div class="ghs-form-group"><label class="ghs-label" for="branches-repo">Repository</label><select id="branches-repo" class="ghs-input"></select></div><div class="ghs-form-group"><span class="ghs-label">Safe cleanup</span><button id="btn-branches-cleanup" class="ghs-btn ghs-btn--secondary" type="button">Delete merged local branches…</button></div></div><p id="branches-overview-status" class="ghs-helper"></p></div>' +
            '<h3>Local branches</h3><div class="ghs-table-wrap"><table class="ghs-table"><thead><tr><th>Branch</th><th>Upstream</th><th>Ahead</th><th>Behind</th><th>Last commit</th><th>State</th></tr></thead><tbody id="branches-overview-body"></tbody></table></div>' +
            '<h3>Remote branches</h3><div class="ghs-table-wrap"><table class="ghs-table"><thead><tr><th>Branch</th><th>Last commit</th><th>Commit</th><th>State</th></tr></thead><tbody id="branches-remote-body"></tbody></table></div>';
        settingsPanel.parentNode.insertBefore(panel, settingsPanel); tab.onclick = function () { selectTab(); };
        $("branches-repo").onchange = function () { load(this.value).catch(function () {}); }; $("btn-branches-cleanup").onclick = cleanup;
    }
    createUi();
    if (m.registerAction) m.registerAction({ label: "Branch overview…", state: function (name, row) { return row.children[1] && row.children[1].textContent.trim() === "mirror" ? { disabled: true, title: "Bare mirrors do not have working branches" } : {}; }, run: function (name) { selectTab(name); } });
    window.GHSyncBranchOverview = { parseLocal: parseLocal, parseRemote: parseRemote };
})();
