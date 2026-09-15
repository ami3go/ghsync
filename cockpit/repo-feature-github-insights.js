/* Roadmap Priority 4: optional GitHub Actions, PR and issue indicators. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.statusSnapshot || !m.mapLimit) return;
    var tab, panel, rows = [], host = "", busy = false;
    var ENABLED_KEY = "ghsync:github-insights:enabled", COUNTS_KEY = "ghsync:github-insights:counts", CACHE_KEY = "ghsync:github-insights:cache:v1", NOTIFIED_KEY = "ghsync:github-insights:notified:v1";
    var TTL = 5 * 60 * 1000;

    function $(id) { return document.getElementById(id); }
    function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function getJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || "") || fallback; } catch (e) { return fallback; } }
    function setJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } }
    function enabled() { return localStorage.getItem(ENABLED_KEY) === "yes"; }
    function countsEnabled() { return localStorage.getItem(COUNTS_KEY) === "yes"; }
    function parseCheck(out) { var v = {}; out.split("\n").forEach(function (line) { var f = line.split("\t"); if (f[0] === "check") v[f[1]] = f[2] || ""; }); return v; }
    function ghApi(args) { var cmd = ["gh", "api"]; if (host) cmd.push("--hostname", host); return cockpit.spawn(cmd.concat(args), { err: "message", superuser: null }); }
    function webBase() { return "https://" + (host || "github.com"); }
    function state(run) {
        if (!run) return "No workflows"; if (run.status && run.status !== "completed") return "Running";
        if (run.conclusion === "success") return "Passing"; if (["failure", "cancelled", "timed_out", "action_required"].indexOf(run.conclusion) >= 0) return "Failed";
        return run.conclusion || run.status || "Unknown";
    }
    function queryCount(repo, kind) {
        var q = "repo:" + repo + " is:" + kind + " is:open";
        return ghApi(["--method", "GET", "search/issues", "-f", "q=" + q, "-f", "per_page=1"]).then(function (out) { return parseInt((JSON.parse(out) || {}).total_count, 10) || 0; });
    }
    function fetchRepo(name, force) {
        var cache = getJson(CACHE_KEY, {}), cached = cache[name];
        if (!force && cached && Date.now() - cached.at < TTL) return Promise.resolve(cached.data);
        var workflow = ghApi(["repos/" + name + "/actions/runs?per_page=1"]).then(function (out) { var list = (JSON.parse(out) || {}).workflow_runs || []; return list[0] || null; });
        var promises = [workflow]; if (countsEnabled()) promises.push(queryCount(name, "pr"), queryCount(name, "issue"));
        return Promise.all(promises).then(function (values) {
            var data = { name: name, workflow: values[0], prs: countsEnabled() ? values[1] : null, issues: countsEnabled() ? values[2] : null, unavailable: false };
            cache[name] = { at: Date.now(), data: data }; setJson(CACHE_KEY, cache); return data;
        }).catch(function (e) {
            var data = { name: name, workflow: null, prs: null, issues: null, unavailable: true, error: e.message || String(e) };
            cache[name] = { at: Date.now(), data: data }; setJson(CACHE_KEY, cache); return data;
        });
    }
    function notifyFailure(item) {
        var run = item.workflow; if (!run || state(run) !== "Failed") return;
        var notified = getJson(NOTIFIED_KEY, {}), key = item.name + ":" + run.id; if (notified[key]) return; notified[key] = Date.now(); setJson(NOTIFIED_KEY, notified);
        if (window.GHSyncNotifications && window.GHSyncNotifications.add) window.GHSyncNotifications.add({ variant: "danger", title: "GitHub Actions failed", body: item.name + " — " + (run.name || "workflow") + " — " + (run.conclusion || "failed"), details: [run.html_url || ""].filter(Boolean), source: "github" });
    }
    function applyRowBadges() {
        document.querySelectorAll("#repos tr").forEach(function (row) {
            var name = m.rowName ? m.rowName(row) : "", cell = row.children[2], item = rows.filter(function (x) { return x.name === name; })[0]; if (!name || !cell) return;
            var old = row.querySelector(".ghs-github-status"); if (old) old.remove(); if (!item || item.unavailable || !item.workflow) return;
            var note = document.createElement("div"); note.className = "ghs-helper ghs-github-status"; note.textContent = "Actions: " + state(item.workflow); cell.appendChild(note);
        });
    }
    function render() {
        var body = $("github-insights-body"); if (!body) return; body.textContent = "";
        rows.forEach(function (item) {
            var tr = document.createElement("tr"), run = item.workflow, workflowState = item.unavailable ? "Unavailable" : state(run), link = run && run.html_url ? run.html_url : "";
            tr.innerHTML = '<td class="ghs-mono">' + esc(item.name) + '</td><td>' + esc(workflowState) + '</td><td>' + esc(run ? (run.name || "workflow") : "—") + '</td><td>' + esc(item.prs == null ? "—" : item.prs) + '</td><td>' + esc(item.issues == null ? "—" : item.issues) + '</td><td class="ghs-table__action"></td>';
            if (link) { var a = document.createElement("a"); a.className = "ghs-btn ghs-btn--link ghs-btn--sm"; a.href = link; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = "Open run"; tr.lastElementChild.appendChild(a); }
            var repo = document.createElement("a"); repo.className = "ghs-btn ghs-btn--link ghs-btn--sm"; repo.href = webBase() + "/" + item.name; repo.target = "_blank"; repo.rel = "noopener noreferrer"; repo.textContent = "Repository"; tr.lastElementChild.appendChild(repo);
            body.appendChild(tr); notifyFailure(item);
        });
        applyRowBadges(); $("github-insights-status").textContent = rows.length + " repositories checked. Results are cached for 5 minutes.";
    }
    function refresh(force) {
        if (!enabled()) { rows = []; render(); $("github-insights-status").textContent = "GitHub insights are disabled. Enable them to avoid background API traffic by default."; return Promise.resolve(); }
        busy = true; $("github-insights-status").textContent = "Loading GitHub status…";
        return Promise.all([m.runCore(["check"]).then(parseCheck), m.statusSnapshot()]).then(function (values) {
            host = values[0].host || ""; var names = values[1].map(function (r) { return r.name; });
            return m.mapLimit(names, 3, function (name) { return fetchRepo(name, force); });
        }).then(function (items) { rows = items; render(); return items; }).finally(function () { busy = false; });
    }
    function selectTab(name) {
        document.querySelectorAll(".ghs-tab").forEach(function (t) { var on = t === tab; t.classList.toggle("ghs-tab--current", on); t.setAttribute("aria-selected", on ? "true" : "false"); }); document.querySelectorAll(".ghs-tab-panel").forEach(function (p) { p.classList.add("ghs-hidden"); }); panel.classList.remove("ghs-hidden");
        refresh(false).then(function () { if (name) { var target = Array.prototype.slice.call($("github-insights-body").children).filter(function (tr) { return tr.firstElementChild && tr.firstElementChild.textContent === name; })[0]; if (target) target.scrollIntoView({ block: "nearest" }); } });
    }
    function createUi() {
        if ($("panel-github-insights")) return; var tabs = document.querySelector(".ghs-tabs"), settings = document.querySelector('.ghs-tab[data-tab="settings"]'), settingsPanel = $("panel-settings"); if (!tabs || !settingsPanel) return;
        tab = document.createElement("button"); tab.className = "ghs-tab"; tab.type = "button"; tab.dataset.tab = "github-insights"; tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", "false"); tab.textContent = "GitHub"; tabs.insertBefore(tab, settings || null);
        panel = document.createElement("section"); panel.id = "panel-github-insights"; panel.className = "ghs-tab-panel ghs-hidden"; panel.setAttribute("role", "tabpanel");
        panel.innerHTML = '<div class="ghs-form"><div class="ghs-form-group"><span class="ghs-label">Optional GitHub API integration</span><label><input id="github-insights-enabled" type="checkbox"> Enable workflow status</label><br><label><input id="github-counts-enabled" type="checkbox"> Include open PR and issue counts</label><p class="ghs-helper">Disabled by default. When enabled, results are cached for five minutes and fetched with limited concurrency.</p></div><div class="ghs-form-actions"><button id="btn-github-refresh" class="ghs-btn ghs-btn--primary" type="button">Refresh GitHub status</button></div><p id="github-insights-status" class="ghs-helper"></p></div><div class="ghs-table-wrap"><table class="ghs-table"><thead><tr><th>Repository</th><th>Actions</th><th>Workflow</th><th>Open PRs</th><th>Open issues</th><th class="ghs-table__action">Links</th></tr></thead><tbody id="github-insights-body"></tbody></table></div>';
        settingsPanel.parentNode.insertBefore(panel, settingsPanel); tab.onclick = function () { selectTab(); };
        $("github-insights-enabled").checked = enabled(); $("github-counts-enabled").checked = countsEnabled();
        $("github-insights-enabled").onchange = function () { localStorage.setItem(ENABLED_KEY, this.checked ? "yes" : "no"); if (!this.checked) { rows = []; render(); } else refresh(true); };
        $("github-counts-enabled").onchange = function () { localStorage.setItem(COUNTS_KEY, this.checked ? "yes" : "no"); setJson(CACHE_KEY, {}); if (enabled()) refresh(true); };
        $("btn-github-refresh").onclick = function () { setJson(CACHE_KEY, {}); refresh(true); };
    }
    createUi();
    if (m.registerAction) m.registerAction({ label: "GitHub status…", run: function (name) { selectTab(name); } });
    window.GHSyncGitHubInsights = { refresh: refresh, state: state };
})();
