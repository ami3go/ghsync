/* Roadmap Priority 6: activity timeline and safe automatic recovery actions. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.statusSnapshot || !m.mapLimit) return;
    var events = [];

    function $(id) { return document.getElementById(id); }
    function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function msg(e) { return e && e.message ? e.message : String(e || "Unknown error"); }
    function parseCheck(out) { var v = {}; out.split("\n").forEach(function (line) { var f = line.split("\t"); if (f[0] === "check") v[f[1]] = f[2] || ""; }); return v; }
    function severity(tag) { if (/^(failed|error)$/.test(tag)) return "danger"; if (/^(dirty|diverged|detached|no-upstream|local-only|orphan)$/.test(tag)) return "warning"; if (/^(cloned|committed|updated|maintained)$/.test(tag)) return "success"; return "info"; }
    function parseLog(text) {
        var out = [];
        String(text || "").split("\n").forEach(function (line) {
            var match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+)(?:\s+—\s+(.*))?$/); if (!match) return;
            out.push({ time: match[1], action: match[2], repo: match[3], detail: match[4] || "", severity: severity(match[2]) });
        });
        return out.reverse();
    }
    function loadTimeline() {
        return m.runCore(["check"]).then(parseCheck).then(function (check) {
            if (!check.log) throw new Error("Log path is unavailable");
            return cockpit.spawn(["tail", "-n", "2500", "--", check.log], { err: "ignore", superuser: null });
        }).then(function (text) { events = parseLog(text); rebuildActionFilter(); renderTimeline(); return events; })
            .catch(function (e) { $("timeline-status").textContent = "Could not load timeline: " + msg(e); });
    }
    function rebuildActionFilter() {
        var select = $("timeline-action"); if (!select) return; var current = select.value, names = {};
        events.forEach(function (e) { names[e.action] = true; }); select.textContent = ""; var all = document.createElement("option"); all.value = ""; all.textContent = "All actions"; select.appendChild(all);
        Object.keys(names).sort().forEach(function (name) { var o = document.createElement("option"); o.value = name; o.textContent = name; select.appendChild(o); }); select.value = names[current] ? current : "";
    }
    function renderTimeline() {
        var body = $("timeline-body"); if (!body) return; body.textContent = "";
        var needle = $("timeline-repo").value.trim().toLowerCase(), action = $("timeline-action").value, sev = $("timeline-severity").value;
        var shown = events.filter(function (e) { return (!needle || e.repo.toLowerCase().indexOf(needle) >= 0) && (!action || e.action === action) && (!sev || e.severity === sev); }).slice(0, 300);
        shown.forEach(function (e) { var tr = document.createElement("tr"); tr.innerHTML = '<td>' + esc(e.time) + '</td><td class="ghs-mono">' + esc(e.repo) + '</td><td>' + esc(e.action) + '</td><td>' + esc(e.severity) + '</td><td>' + esc(e.detail || "—") + '</td>'; body.appendChild(tr); });
        $("timeline-status").textContent = shown.length + " of " + events.length + " recent events. Raw log remains available below.";
    }

    function configDir() { return m.runCore(["check"]).then(parseCheck).then(function (c) { if (!c.config) throw new Error("Config path unknown"); return c.config.slice(0, c.config.lastIndexOf("/")); }); }
    function readJson(path) { return cockpit.spawn(["cat", path], { err: "ignore", superuser: null }).then(function (t) { try { return JSON.parse(t); } catch (e) { return null; } }, function () { return null; }); }
    function missingAssigned() {
        return Promise.all([configDir(), m.statusSnapshot()]).then(function (values) {
            var dir = values[0], rows = values[1], local = {}; rows.forEach(function (r) { local[r.name] = true; });
            return Promise.all([readJson(dir + "/repository-sync-cache.json"), readJson(dir + "/repository-sync.json"), m.runCore(["check"]).then(parseCheck), m.repositoryRoot()]).then(function (parts) {
                var shared = window.GHSyncSharedList, manifest = parts[0], cfg = parts[1] || {};
                if (!shared || !shared.normalizeManifest || !shared.assigned || !manifest || !cfg.machine) return { entries: [], check: parts[2], root: parts[3] };
                manifest = shared.normalizeManifest(manifest); return { entries: shared.assigned(manifest, cfg.machine, cfg.groups || []).filter(function (e) { return !local[e.name]; }), check: parts[2], root: parts[3] };
            });
        });
    }
    function cloneEntry(entry, check, root) {
        if (!entry || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(entry.name) || !entry.url || entry.url.charAt(0) === "-" || /[\r\n\t]/.test(entry.url)) return Promise.reject(new Error("Invalid shared repository entry"));
        var mirror = check.mirror === "true", dest = root.replace(/\/$/, "") + "/" + entry.name + (mirror ? ".git" : ""), args = ["clone"];
        if (mirror) args.push("--mirror", "--quiet"); else { args.push("--recurse-submodules", "--quiet"); if (check.filter === "blob:none" || check.filter === "tree:0") args.push("--filter=" + check.filter); else if (/^depth:[1-9][0-9]*$/.test(check.filter || "")) args.push("--depth", check.filter.slice(6), "--no-single-branch"); }
        args.push("--", entry.url, dest); return cockpit.spawn(["mkdir", "-p", dest.slice(0, dest.lastIndexOf("/"))], { err: "message", superuser: null }).then(function () { return cockpit.spawn(["git"].concat(args), { err: "message", superuser: null }); });
    }
    function refreshRecovery() {
        return Promise.all([missingAssigned(), m.runCore(["check"]).then(parseCheck)]).then(function (values) {
            var data = values[0], check = values[1], box = $("recovery-missing"); box.textContent = "";
            if (check.auth !== "yes") { var auth = document.createElement("p"); auth.className = "ghs-helper ghs-t-red"; auth.textContent = "GitHub authentication needs repair. Open a terminal and run: gh auth login"; box.appendChild(auth); }
            if (!data.entries.length) { var empty = document.createElement("p"); empty.className = "ghs-helper"; empty.textContent = "No cached assigned repositories are missing from this machine."; box.appendChild(empty); return; }
            data.entries.forEach(function (entry) {
                var line = document.createElement("div"); line.className = "ghs-form-actions"; var label = document.createElement("span"); label.className = "ghs-mono"; label.textContent = entry.name; var button = document.createElement("button"); button.type = "button"; button.className = "ghs-btn ghs-btn--secondary ghs-btn--sm"; button.textContent = "Clone";
                button.onclick = function () { button.disabled = true; cloneEntry(entry, data.check, data.root).then(function () { if (window.GHSyncNotifications && window.GHSyncNotifications.add) window.GHSyncNotifications.add({ variant: "success", title: "Missing assigned repository cloned", body: entry.name, source: "recovery" }); m.refreshMainPage(); return refreshRecovery(); }).catch(function (e) { window.alert("Clone failed: " + msg(e)); }).finally(function () { button.disabled = false; }); };
                line.appendChild(label); line.appendChild(button); box.appendChild(line);
            });
        });
    }
    function setUpstream(name) {
        return Promise.all([m.runGit(name, ["symbolic-ref", "--quiet", "--short", "HEAD"]), m.runGit(name, ["branch", "-r", "--format=%(refname:short)"])]).then(function (values) {
            var branch = values[0].trim(), remotes = values[1].split("\n").filter(function (x) { return x && !/\/HEAD$/.test(x); });
            var guess = remotes.filter(function (r) { return r.split("/").slice(1).join("/") === branch; })[0] || remotes[0] || "origin/" + branch;
            var answer = window.prompt("Set upstream for " + name + " branch " + branch + ".\n\nAvailable remote branches:\n" + remotes.slice(0, 40).join("\n") + "\n\nEnter remote branch:", guess); if (answer === null) return;
            answer = answer.trim(); if (!answer || answer.charAt(0) === "-") throw new Error("Invalid upstream"); return m.runGit(name, ["branch", "--set-upstream-to=" + answer, "--", branch]);
        });
    }
    function recover(name) {
        return m.statusSnapshot().then(function (rows) {
            var row = rows.filter(function (r) { return r.name === name; })[0]; if (!row) throw new Error("Repository status is unavailable");
            return m.runGit(name, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).then(function () { row.hasUpstream = true; return row; }, function () { row.hasUpstream = false; return row; });
        }).then(function (row) {
            var options = [];
            if (row.behind > 0 && row.dirty === 0 && row.branch !== "detached") options.push("pull — fast-forward safely");
            if (!row.hasUpstream && row.branch !== "detached" && row.branch !== "mirror") options.push("upstream — set tracking branch");
            if (row.dirty > 0 && row.branch !== "mirror") { options.push("stash — stash tracked and untracked changes"); if (row.branch !== "detached") options.push("commit — create a local commit"); }
            if (!options.length) throw new Error("No safe recovery action is currently recommended");
            var choice = window.prompt("Safe recovery actions for " + name + ":\n\n" + options.join("\n") + "\n\nEnter action:", options[0].split(" ")[0]); if (choice === null) return;
            choice = choice.trim().toLowerCase();
            if (choice === "pull") return m.runCore(["pull", name]);
            if (choice === "upstream") return setUpstream(name);
            if (choice === "stash") return m.runGit(name, ["stash", "push", "-u", "-m", "ghsync recovery " + new Date().toISOString()]);
            if (choice === "commit") { var text = window.prompt("Commit message for " + name + ":"); if (text === null || !text.trim()) return; return m.runCore(["commit", name, text.trim()]); }
            throw new Error("Unknown recovery action");
        }).then(function () { m.refreshMainPage(); }).catch(function (e) { window.alert("Recovery action: " + msg(e)); });
    }

    function install() {
        var panel = $("panel-activity"); if (!panel || $("ghs-timeline")) return;
        var raw = $("console"), wrap = document.createElement("div"); wrap.id = "ghs-timeline";
        wrap.innerHTML = '<h3>Activity timeline</h3><div class="ghs-toolbar"><input id="timeline-repo" class="ghs-input ghs-input--narrow" type="search" placeholder="Filter repository"><select id="timeline-action" class="ghs-input ghs-input--narrow"><option value="">All actions</option></select><select id="timeline-severity" class="ghs-input ghs-input--narrow"><option value="">All severities</option><option value="success">success</option><option value="warning">warning</option><option value="danger">danger</option><option value="info">info</option></select><span class="ghs-toolbar__spacer"></span><button id="btn-timeline-refresh" class="ghs-btn ghs-btn--secondary ghs-btn--sm" type="button">Refresh timeline</button></div><p id="timeline-status" class="ghs-helper"></p><div class="ghs-table-wrap" style="max-height:24rem;overflow:auto"><table class="ghs-table"><thead><tr><th>Time</th><th>Repository</th><th>Action</th><th>Severity</th><th>Detail</th></tr></thead><tbody id="timeline-body"></tbody></table></div><h3>Recovery</h3><p class="ghs-helper">Only reversible/safe actions are offered automatically. Missing shared-list assignments can be cloned here; existing repositories use the row action “Recovery actions…”.</p><div id="recovery-missing"></div><h3>Raw log</h3>';
        panel.insertBefore(wrap, raw); $("btn-timeline-refresh").onclick = function () { loadTimeline(); refreshRecovery(); }; $("timeline-repo").oninput = renderTimeline; $("timeline-action").onchange = renderTimeline; $("timeline-severity").onchange = renderTimeline;
        loadTimeline(); refreshRecovery();
    }
    install(); if (m.registerAction) m.registerAction({ label: "Recovery actions…", run: recover });
    window.GHSyncActivityTimeline = { parseLog: parseLog, refreshRecovery: refreshRecovery };
})();
