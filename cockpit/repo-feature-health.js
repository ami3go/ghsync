/* Priority 3: repository health indicators and aggregate health metrics. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.statusSnapshot || !m.mapLimit || !m.runGit || !m.repoDirectory) return;

    function $(id) { return document.getElementById(id); }
    function resize() { try { cockpit.transport.control("size-change"); } catch (e) { /* standalone */ } }
    function safe(promise, fallback) { return Promise.resolve(promise).catch(function () { return fallback; }); }
    function message(error) { return error && error.message ? error.message : String(error || "Unknown error"); }

    var tab = null, panel = null, scanning = false, lastRows = [], byName = Object.create(null);

    function parseCheck(out) {
        var values = {};
        String(out || "").split("\n").forEach(function (line) {
            var f = line.split("\t");
            if (f[0] === "check") values[f[1]] = f[2] || "";
        });
        return values;
    }

    function historyTime(text, fallback) {
        var value = Date.parse(String(text || "").replace(" ", "T"));
        return isNaN(value) ? fallback : value;
    }

    function parseHistory(text) {
        var history = { success: Object.create(null), failure: Object.create(null) };
        String(text || "").split(/\r?\n/).forEach(function (line, index) {
            var match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(updated|up-to-date|cloned|failed)\s+([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)(?:\s+—\s+(.*))?\s*$/);
            if (!match) return;
            var item = { at: match[1], time: historyTime(match[1], index), tag: match[2], detail: match[4] || "" };
            if (match[2] === "failed") history.failure[match[3]] = item;
            else history.success[match[3]] = item;
        });
        return history;
    }

    function readHistory() {
        return m.runCore(["check"]).then(function (out) {
            var log = parseCheck(out).log;
            if (!log) return { success: Object.create(null), failure: Object.create(null) };
            return cockpit.spawn(["tail", "-n", "3000", log], { err: "ignore", superuser: null })
                .then(parseHistory, function () { return { success: Object.create(null), failure: Object.create(null) }; });
        }, function () { return { success: Object.create(null), failure: Object.create(null) }; });
    }

    function formatSize(kb) {
        if (kb === null || kb === undefined || isNaN(kb)) return "Unknown";
        var bytes = Number(kb) * 1024, units = ["B", "KiB", "MiB", "GiB", "TiB"], index = 0;
        while (bytes >= 1024 && index < units.length - 1) { bytes /= 1024; index += 1; }
        var digits = index >= 3 ? 1 : (index >= 2 ? 0 : 0);
        return bytes.toFixed(digits) + " " + units[index];
    }

    function relativeTime(value) {
        if (!value) return "Never recorded";
        var d = new Date(String(value).replace(" ", "T"));
        if (isNaN(d.getTime())) return value;
        var delta = Date.now() - d.getTime(), future = delta < 0;
        delta = Math.abs(delta);
        var amount, unit;
        if (delta < 60000) { amount = Math.max(1, Math.round(delta / 1000)); unit = "second"; }
        else if (delta < 3600000) { amount = Math.round(delta / 60000); unit = "minute"; }
        else if (delta < 86400000) { amount = Math.round(delta / 3600000); unit = "hour"; }
        else { amount = Math.round(delta / 86400000); unit = "day"; }
        return future ? "in " + amount + " " + unit + (amount === 1 ? "" : "s") : amount + " " + unit + (amount === 1 ? "" : "s") + " ago";
    }

    function repoMeta(row) {
        var mirror = row.branch === "mirror", detached = row.branch === "detached";
        var upstream = mirror ? Promise.resolve(true) : (detached ? Promise.resolve(false) :
            m.runGit(row.name, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).then(function () { return true; }, function () { return false; }));
        var integrity = m.runGit(row.name, ["fsck", "--connectivity-only", "--no-dangling"])
            .then(function () { return { ok: true, detail: "" }; }, function (e) { return { ok: false, detail: message(e).split("\n")[0] }; });
        var size = m.repoDirectory(row.name).then(function (dir) {
            return cockpit.spawn(["du", "-sk", dir], { err: "ignore", superuser: null })
                .then(function (out) {
                    var value = parseInt(String(out || "").trim().split(/\s+/)[0], 10);
                    return isNaN(value) ? null : value;
                }, function () { return null; });
        }, function () { return null; });
        return Promise.all([upstream, integrity, size]).then(function (values) {
            return { detached: detached, upstream: values[0], integrity: values[1], sizeKb: values[2] };
        });
    }

    function signal(key, severity, title, detail) {
        return { key: key, severity: severity, title: title, detail: detail || "" };
    }

    function assess(row, meta, history) {
        history = history || { success: {}, failure: {} };
        var signals = [], success = history.success[row.name] || null, failure = history.failure[row.name] || null;
        if (!meta.integrity || meta.integrity.ok !== true)
            signals.push(signal("integrity", "danger", "Integrity check failed", meta.integrity && meta.integrity.detail ? meta.integrity.detail : "git fsck did not complete successfully."));
        if (failure && (!success || failure.time > success.time))
            signals.push(signal("failed", "danger", "Latest sync failed", failure.detail || "The most recent repository operation failed."));
        if (row.branch !== "mirror" && meta.detached)
            signals.push(signal("detached", "danger", "Detached HEAD", "The repository is not on a normal branch."));
        if (row.ahead > 0 && row.behind > 0)
            signals.push(signal("diverged", "danger", "Branch diverged", row.ahead + " ahead and " + row.behind + " behind upstream."));
        else {
            if (row.behind > 0) signals.push(signal("behind", "warning", "Behind upstream", row.behind + " commit" + (row.behind === 1 ? "" : "s") + " behind."));
            if (row.ahead > 0) signals.push(signal("ahead", "warning", "Local commits not pushed", row.ahead + " commit" + (row.ahead === 1 ? "" : "s") + " ahead."));
        }
        if (row.dirty > 0)
            signals.push(signal("dirty", "warning", "Uncommitted changes", row.dirty + " changed path" + (row.dirty === 1 ? "" : "s") + "."));
        if (row.branch !== "mirror" && !meta.detached && !meta.upstream)
            signals.push(signal("no-upstream", "warning", "No upstream branch", "The current branch has no tracking branch."));
        return {
            name: row.name,
            row: row,
            meta: meta,
            signals: signals,
            state: signals.some(function (item) { return item.severity === "danger"; }) ? "problem" :
                (signals.length ? "attention" : "healthy"),
            lastSuccess: success,
            lastFailure: failure,
            sizeKb: meta.sizeKb
        };
    }

    function summary(rows) {
        var out = { healthy: 0, attention: 0, problem: 0, total: rows.length, sizeKb: 0, measured: 0 };
        rows.forEach(function (entry) {
            out[entry.state] += 1;
            if (entry.sizeKb !== null && entry.sizeKb !== undefined) { out.sizeKb += Number(entry.sizeKb) || 0; out.measured += 1; }
        });
        return out;
    }

    function stateLabel(state) {
        return state === "problem" ? "Problem" : (state === "attention" ? "Attention" : "Healthy");
    }

    function overview() {
        var dl = document.querySelector(".ghs-card .ghs-dl");
        if (!dl || $("health-overview-group")) return;
        var group = document.createElement("div");
        group.id = "health-overview-group"; group.className = "ghs-dl__group";
        group.innerHTML = '<dt class="ghs-dl__term">Repository health</dt><dd class="ghs-dl__desc" id="v-health">Checking…</dd>';
        var attention = $("v-attention"), anchor = attention && attention.closest ? attention.closest(".ghs-dl__group") : null;
        if (anchor && anchor.parentNode === dl && anchor.nextSibling) dl.insertBefore(group, anchor.nextSibling);
        else dl.appendChild(group);
    }

    function updateOverview() {
        overview();
        var el = $("v-health"); if (!el) return;
        if (scanning && !lastRows.length) { el.textContent = "Checking…"; return; }
        var counts = summary(lastRows);
        el.textContent = counts.healthy + " healthy • " + counts.attention + " attention • " + counts.problem + " problem" +
            (counts.measured ? " • " + formatSize(counts.sizeKb) + " on disk" : "");
        el.className = "ghs-dl__desc" + (counts.problem ? " ghs-t-red" : "");
    }

    function rowName(row) {
        if (m.rowName) return m.rowName(row);
        if (row.dataset.repoName) return row.dataset.repoName;
        var cell = row.querySelector(".ghs-repo-name"); return cell ? cell.textContent.trim() : "";
    }

    function renderRepoBadges() {
        var body = $("repos"); if (!body) return;
        body.querySelectorAll("tr").forEach(function (row) {
            var name = rowName(row), stateCell = row.children[2], entry = byName[name];
            if (!stateCell) return;
            var badge = row.querySelector(".ghs-health-inline");
            if (!entry) { if (badge) badge.remove(); return; }
            if (!badge) {
                badge = document.createElement("span");
                badge.className = "ghs-health-inline";
                stateCell.appendChild(badge);
            }
            badge.className = "ghs-health-inline ghs-health-inline--" + entry.state;
            badge.textContent = stateLabel(entry.state);
            badge.title = entry.signals.length ? entry.signals.map(function (item) { return item.title; }).join(", ") : "No health problems detected";
        });
    }

    function renderTable() {
        var body = $("health-body"), wrap = $("health-wrap"), empty = $("health-empty");
        if (!body || !wrap || !empty) return;
        body.textContent = "";
        var filter = ($("health-filter") ? $("health-filter").value : "").trim().toLowerCase();
        var state = $("health-state-filter") ? $("health-state-filter").value : "";
        var visible = lastRows.filter(function (entry) {
            if (state && entry.state !== state) return false;
            if (!filter) return true;
            var text = entry.name + " " + entry.signals.map(function (item) { return item.title + " " + item.detail; }).join(" ");
            return text.toLowerCase().indexOf(filter) >= 0;
        });
        visible.forEach(function (entry) {
            var tr = document.createElement("tr");
            tr.className = "ghs-health-row ghs-health-row--" + entry.state;
            var repo = document.createElement("td"), health = document.createElement("td"), signals = document.createElement("td"), synced = document.createElement("td"), size = document.createElement("td"), integrity = document.createElement("td");
            repo.className = "ghs-repo-name"; repo.textContent = entry.name;
            var badge = document.createElement("span"); badge.className = "ghs-health-state ghs-health-state--" + entry.state; badge.textContent = stateLabel(entry.state); health.appendChild(badge);
            if (entry.signals.length) {
                var list = document.createElement("ul"); list.className = "ghs-health-signals";
                entry.signals.forEach(function (item) {
                    var li = document.createElement("li"), strong = document.createElement("strong"), detail = document.createElement("span");
                    strong.textContent = item.title; detail.textContent = item.detail ? " — " + item.detail : "";
                    li.appendChild(strong); li.appendChild(detail); list.appendChild(li);
                });
                signals.appendChild(list);
            } else signals.textContent = "No problems detected";
            synced.textContent = entry.lastSuccess ? relativeTime(entry.lastSuccess.at) : "Never recorded";
            if (entry.lastSuccess) synced.title = entry.lastSuccess.at;
            size.textContent = formatSize(entry.sizeKb); size.className = "ghs-num";
            integrity.textContent = entry.meta.integrity && entry.meta.integrity.ok ? "OK" : "Problem";
            integrity.className = entry.meta.integrity && entry.meta.integrity.ok ? "" : "ghs-t-red";
            tr.appendChild(repo); tr.appendChild(health); tr.appendChild(signals); tr.appendChild(synced); tr.appendChild(size); tr.appendChild(integrity); body.appendChild(tr);
        });
        wrap.classList.toggle("ghs-hidden", visible.length === 0);
        empty.classList.toggle("ghs-hidden", visible.length !== 0 || lastRows.length !== 0);
        if ($("health-no-match")) $("health-no-match").classList.toggle("ghs-hidden", visible.length !== 0 || lastRows.length === 0 || (!filter && !state));
        var counts = summary(lastRows);
        if ($("health-summary")) $("health-summary").textContent = counts.total + " repositories • " + counts.healthy + " healthy • " + counts.attention + " attention • " + counts.problem + " problem";
        if ($("health-disk")) $("health-disk").textContent = counts.measured ? formatSize(counts.sizeKb) + " measured" : "Disk usage unavailable";
        resize();
    }

    function render() {
        byName = Object.create(null);
        lastRows.forEach(function (entry) { byName[entry.name] = entry; });
        renderRepoBadges(); renderTable(); updateOverview();
    }

    function setScanning(on) {
        scanning = on;
        if ($("btn-health-refresh")) $("btn-health-refresh").disabled = on;
        if ($("health-summary") && on) $("health-summary").textContent = "Checking repository health…";
        updateOverview();
    }

    function scan() {
        if (scanning) return Promise.resolve(lastRows);
        setScanning(true);
        return Promise.all([
            m.statusSnapshot().catch(function (e) { return /no matching local clones/i.test(message(e)) ? [] : Promise.reject(e); }),
            readHistory()
        ]).then(function (values) {
            var rows = values[0], history = values[1];
            return m.mapLimit(rows, 4, function (row) {
                return repoMeta(row).then(function (meta) { return assess(row, meta, history); });
            });
        }).then(function (entries) {
            lastRows = entries.sort(function (a, b) {
                var rank = { problem: 0, attention: 1, healthy: 2 };
                if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
                return a.name.localeCompare(b.name);
            });
            render();
            return lastRows;
        }).catch(function (e) {
            if ($("health-summary")) $("health-summary").textContent = "Could not check repository health: " + message(e);
            return lastRows;
        }).finally(function () { setScanning(false); updateOverview(); resize(); });
    }

    function createUi() {
        overview();
        if (!$("ghs-health-css")) {
            var css = document.createElement("link"); css.id = "ghs-health-css"; css.rel = "stylesheet"; css.href = "repo-feature-health.css"; document.head.appendChild(css);
        }
        if ($("panel-health")) return;
        var tabs = document.querySelector(".ghs-tabs"), reposPanel = $("panel-repos"), attentionTab = document.querySelector('.ghs-tab[data-tab="attention"]'), reposTab = document.querySelector('.ghs-tab[data-tab="repos"]');
        if (!tabs || !reposPanel || !reposPanel.parentNode) return;
        tab = document.createElement("button"); tab.type = "button"; tab.className = "ghs-tab"; tab.dataset.tab = "health"; tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", "false"); tab.textContent = "Health";
        var anchor = attentionTab || reposTab;
        if (anchor && anchor.nextSibling) tabs.insertBefore(tab, anchor.nextSibling); else tabs.appendChild(tab);
        panel = document.createElement("section"); panel.id = "panel-health"; panel.className = "ghs-tab-panel ghs-hidden"; panel.setAttribute("role", "tabpanel");
        panel.innerHTML =
            '<div class="ghs-toolbar ghs-health-toolbar"><strong id="health-summary">Checking repository health…</strong><span id="health-disk" class="ghs-helper"></span><span class="ghs-toolbar__spacer"></span>' +
            '<select id="health-state-filter" class="ghs-input ghs-input--narrow" aria-label="Filter by health state"><option value="">All health states</option><option value="healthy">Healthy</option><option value="attention">Attention</option><option value="problem">Problem</option></select>' +
            '<input id="health-filter" class="ghs-input ghs-health-filter" type="search" placeholder="Filter health" aria-label="Filter repository health">' +
            '<button id="btn-health-refresh" class="ghs-btn ghs-btn--secondary ghs-btn--sm" type="button">Run health check</button></div>' +
            '<p class="ghs-helper">Health combines live branch/worktree state, the latest recorded sync outcome, disk usage and a read-only <span class="ghs-mono">git fsck --connectivity-only</span> integrity check. Health checks never modify repositories.</p>' +
            '<div id="health-wrap" class="ghs-table-wrap ghs-hidden"><table class="ghs-table ghs-health-table"><thead><tr><th>Repository</th><th>Health</th><th>Signals</th><th>Last successful sync</th><th class="ghs-num">On disk</th><th>Integrity</th></tr></thead><tbody id="health-body"></tbody></table></div>' +
            '<div id="health-empty" class="ghs-empty"><h3 class="ghs-empty__title">No local repositories</h3><p class="ghs-empty__body">Clone repositories before running a health check.</p></div>' +
            '<div id="health-no-match" class="ghs-empty ghs-hidden"><h3 class="ghs-empty__title">No matching repositories</h3><p class="ghs-empty__body">Change the health filter to see more repositories.</p></div>';
        reposPanel.parentNode.insertBefore(panel, reposPanel.nextSibling);
        tab.onclick = function () {
            document.querySelectorAll(".ghs-tab").forEach(function (item) {
                var on = item === tab; item.classList.toggle("ghs-tab--current", on); item.setAttribute("aria-selected", on ? "true" : "false");
            });
            document.querySelectorAll(".ghs-tab-panel").forEach(function (item) { item.classList.add("ghs-hidden"); });
            panel.classList.remove("ghs-hidden"); render(); resize();
        };
        new MutationObserver(function () {
            var current = tabs.querySelector('.ghs-tab--current:not([data-tab="health"])');
            if (current && !panel.classList.contains("ghs-hidden")) {
                panel.classList.add("ghs-hidden"); tab.classList.remove("ghs-tab--current"); tab.setAttribute("aria-selected", "false");
            }
        }).observe(tabs, { subtree: true, attributes: true, attributeFilter: ["class", "aria-selected"] });
        $("btn-health-refresh").onclick = function () { scan(); };
        $("health-filter").oninput = renderTable;
        $("health-state-filter").onchange = renderTable;
    }

    createUi();
    window.GHSyncHealth = { parseHistory: parseHistory, assess: assess, summary: summary, formatSize: formatSize, scan: scan };
    var repoBody = $("repos");
    if (repoBody) new MutationObserver(function () { setTimeout(renderRepoBadges, 0); }).observe(repoBody, { childList: true, subtree: true });
    var refresh = $("btn-refresh");
    if (refresh) refresh.addEventListener("click", function () { setTimeout(scan, 500); });
    setTimeout(scan, 150);
})();
