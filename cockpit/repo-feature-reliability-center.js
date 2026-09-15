/* Roadmap Priority 3: health, scheduled maintenance, backups and diagnostics. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.statusSnapshot || !m.mapLimit) return;
    var tab, panel, healthRows = [], busy = false;

    function $(id) { return document.getElementById(id); }
    function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function msg(e) { return e && e.message ? e.message : String(e || "Unknown error"); }
    function notify(variant, title, body, details) { if (window.GHSyncNotifications && window.GHSyncNotifications.add) window.GHSyncNotifications.add({ variant: variant, title: title, body: body || "", details: details || [], source: "reliability" }); }
    function parseCheck(out) { var v = {}; String(out || "").split("\n").forEach(function (line) { var f = line.split("\t"); if (f[0] === "check") v[f[1]] = f[2] || ""; }); return v; }
    function fmtKb(kb) { kb = Number(kb) || 0; if (kb >= 1048576) return (kb / 1048576).toFixed(1) + " GiB"; if (kb >= 1024) return (kb / 1024).toFixed(1) + " MiB"; return Math.round(kb) + " KiB"; }
    function isoDisplay(value) { if (!value) return "—"; var d = new Date(value.replace(" ", "T") + (value.indexOf("T") >= 0 ? "" : "Z")); return isNaN(d.getTime()) ? value : d.toLocaleString(); }
    function setBusy(on) { busy = on; panel && panel.querySelectorAll("button").forEach(function (b) { if (!b.dataset.allowBusy) b.disabled = on; }); if (!on) updateMaintenanceState(); }

    function logSignals(check) {
        if (!check.log) return Promise.resolve({ success: {}, failed: {} });
        return cockpit.spawn(["tail", "-n", "5000", "--", check.log], { err: "ignore", superuser: null }).then(function (text) {
            var out = { success: {}, failed: {} };
            text.split("\n").forEach(function (line) {
                var m1 = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(cloned|updated|up-to-date|clean|maintained|failed)\s+(\S+)/);
                if (!m1) return; var stamp = m1[1], tag = m1[2], name = m1[3];
                if (tag === "failed") out.failed[name] = stamp; else out.success[name] = stamp;
            });
            return out;
        }, function () { return { success: {}, failed: {} }; });
    }
    function scanHealth() {
        setBusy(true); $("health-status").textContent = "Scanning repository health…";
        return Promise.all([m.statusSnapshot(), m.runCore(["check"]).then(parseCheck)]).then(function (values) {
            var rows = values[0], check = values[1];
            return Promise.all([logSignals(check), m.repositoryRoot().then(function (root) { return cockpit.spawn(["df", "-Pk", root], { err: "ignore", superuser: null }); })]).then(function (extra) {
                var logs = extra[0], df = extra[1], freePct = 100;
                var lines = df.trim().split("\n"); if (lines.length > 1) { var f = lines[lines.length - 1].trim().split(/\s+/); freePct = 100 - (parseInt((f[4] || "0").replace("%", ""), 10) || 0); }
                return m.mapLimit(rows, 2, function (row) {
                    return m.repoDirectory(row.name).then(function (dir) {
                        return Promise.all([
                            cockpit.spawn(["du", "-sk", dir], { err: "ignore", superuser: null }).catch(function () { return "0"; }),
                            m.runGit(row.name, ["fsck", "--connectivity-only"]).then(function () { return true; }, function () { return false; }),
                            row.branch === "mirror" ? Promise.resolve(true) : m.runGit(row.name, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).then(function () { return true; }, function () { return false; })
                        ]).then(function (parts) {
                            var kb = parseInt(String(parts[0]).split(/\s+/)[0], 10) || 0, reasons = [], problem = false;
                            if (!parts[1]) { reasons.push("integrity check failed"); problem = true; }
                            if (logs.failed[row.name] && (!logs.success[row.name] || logs.failed[row.name] > logs.success[row.name])) { reasons.push("latest recorded operation failed"); problem = true; }
                            if (row.dirty > 0) reasons.push("dirty working tree"); if (row.ahead > 0) reasons.push(row.ahead + " ahead"); if (row.behind > 0) reasons.push(row.behind + " behind");
                            if (!parts[2] && row.branch !== "mirror") reasons.push("missing upstream"); if (row.branch === "detached") reasons.push("detached HEAD");
                            if (kb > 5 * 1024 * 1024) reasons.push("large repository"); if (freePct < 10) reasons.push("low free disk space");
                            return { name: row.name, state: problem ? "Problem" : (reasons.length ? "Attention" : "Healthy"), reasons: reasons, sizeKb: kb, lastSuccess: logs.success[row.name] || "", integrity: parts[1], upstream: parts[2], row: row };
                        });
                    });
                }).then(function (health) { return { health: health, freePct: freePct }; });
            });
        }).then(function (result) {
            healthRows = result.health; renderHealth(result.freePct); return result;
        }).catch(function (e) { $("health-status").textContent = "Health scan failed: " + msg(e); throw e; }).finally(function () { setBusy(false); });
    }
    function renderHealth(freePct) {
        var body = $("health-body"); if (!body) return; body.textContent = ""; var counts = { Healthy: 0, Attention: 0, Problem: 0 };
        healthRows.forEach(function (row) {
            counts[row.state] += 1; var tr = document.createElement("tr"); tr.innerHTML = '<td class="ghs-mono">' + esc(row.name) + '</td><td>' + esc(row.state) + '</td><td>' + esc(row.reasons.join(", ") || "—") + '</td><td>' + esc(isoDisplay(row.lastSuccess)) + '</td><td>' + esc(fmtKb(row.sizeKb)) + '</td><td>' + (row.integrity ? "OK" : "Failed") + '</td>'; body.appendChild(tr);
            document.querySelectorAll("#repos tr").forEach(function (mainRow) {
                if ((m.rowName ? m.rowName(mainRow) : "") !== row.name) return; var stateCell = mainRow.children[2]; if (!stateCell) return; var old = mainRow.querySelector(".ghs-health-state"); if (old) old.remove();
                var note = document.createElement("div"); note.className = "ghs-helper ghs-health-state"; note.textContent = "Health: " + row.state; stateCell.appendChild(note);
            });
        });
        $("health-status").textContent = counts.Healthy + " healthy, " + counts.Attention + " attention, " + counts.Problem + " problem. Root free space: " + Math.round(freePct) + "%";
        var metric = $("v-health"); if (metric) metric.textContent = counts.Healthy + " healthy · " + counts.Attention + " attention · " + counts.Problem + " problem";
        if (freePct < 10) notify("warning", "Low repository disk space", "Only " + Math.round(freePct) + "% free space remains on the repository filesystem.");
    }
    function ensureOverviewMetric() {
        if ($("v-health")) return; var dl = document.querySelector(".ghs-card .ghs-dl"); if (!dl) return;
        var div = document.createElement("div"); div.className = "ghs-dl__group"; div.innerHTML = '<dt class="ghs-dl__term">Repository health</dt><dd class="ghs-dl__desc" id="v-health">Not scanned</dd>'; dl.appendChild(div);
    }

    function findMaintenance() {
        var script = 'for p in "$HOME/.local/bin/ghsync-maintenance" /usr/local/bin/ghsync-maintenance /usr/bin/ghsync-maintenance "$HOME/.local/share/cockpit/ghsync/ghsync-maintenance" /usr/share/cockpit/ghsync/ghsync-maintenance; do [ -x "$p" ] && { echo "$p"; exit 0; }; done; exit 1';
        return cockpit.spawn(["sh", "-c", script], { err: "message", superuser: null }).then(function (out) { return out.trim(); });
    }
    function runMaintenance() {
        setBusy(true); $("maintenance-status").textContent = "Running fetch --prune, gc --auto and fsck…";
        return findMaintenance().then(function (path) {
            var args = [path, "--porcelain"]; if ($("maintenance-submodules").checked) args.push("--submodules");
            return cockpit.spawn(args, { err: "message", superuser: null });
        }).then(function (out) {
            var failures = [], count = 0; out.split("\n").forEach(function (line) { var f = line.split("\t"); if (f[0] === "maintained") count += 1; if (f[0] === "failed") failures.push((f[1] || "") + ": " + (f[2] || "")); });
            var summary = count + " repositories maintained" + (failures.length ? "; " + failures.length + " failed" : "."); $("maintenance-status").textContent = summary; notify(failures.length ? "warning" : "success", "Repository maintenance finished", summary, failures); return scanHealth();
        }).catch(function (e) { $("maintenance-status").textContent = "Maintenance failed: " + msg(e); notify("danger", "Repository maintenance failed", msg(e)); }).finally(function () { setBusy(false); });
    }
    function unitDir() { return cockpit.spawn(["sh", "-c", 'printf %s "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"'], { err: "message", superuser: null }).then(function (out) { return out.trim(); }); }
    function installMaintenanceTimer() {
        var when = $("maintenance-calendar").value.trim(); if (!when || /[\r\n]/.test(when)) return window.alert("Enter a valid systemd OnCalendar expression.");
        setBusy(true);
        Promise.all([findMaintenance(), unitDir()]).then(function (v) {
            var helper = v[0], dir = v[1], sub = $("maintenance-submodules").checked ? " --submodules" : "";
            var service = "[Unit]\nDescription=Maintain ghsync repositories\n\n[Service]\nType=oneshot\nExecStart=\"" + helper.replace(/"/g, "\\\"") + "\" --quiet" + sub + "\n";
            var timer = "[Unit]\nDescription=Scheduled ghsync maintenance\n\n[Timer]\nOnCalendar=" + when + "\nPersistent=true\nRandomizedDelaySec=300\n\n[Install]\nWantedBy=timers.target\n";
            return cockpit.spawn(["mkdir", "-p", dir], { err: "message", superuser: null }).then(function () { return Promise.all([cockpit.file(dir + "/ghsync-maintenance.service").replace(service), cockpit.file(dir + "/ghsync-maintenance.timer").replace(timer)]); });
        }).then(function () { return cockpit.spawn(["systemctl", "--user", "daemon-reload"], { err: "message", superuser: null }); })
            .then(function () { return cockpit.spawn(["systemctl", "--user", "enable", "--now", "ghsync-maintenance.timer"], { err: "message", superuser: null }); })
            .then(function () { $("maintenance-status").textContent = "Maintenance timer enabled."; notify("success", "Maintenance schedule enabled", $("maintenance-calendar").value.trim()); })
            .catch(function (e) { $("maintenance-status").textContent = "Could not enable maintenance timer: " + msg(e); }).finally(function () { setBusy(false); updateMaintenanceState(); });
    }
    function removeMaintenanceTimer() {
        if (!window.confirm("Remove the separate ghsync maintenance schedule?")) return;
        setBusy(true); unitDir().then(function (dir) {
            return cockpit.spawn(["systemctl", "--user", "disable", "--now", "ghsync-maintenance.timer"], { err: "ignore", superuser: null }).then(function () { return cockpit.spawn(["rm", "-f", dir + "/ghsync-maintenance.timer", dir + "/ghsync-maintenance.service"], { err: "message", superuser: null }); });
        }).then(function () { return cockpit.spawn(["systemctl", "--user", "daemon-reload"], { err: "ignore", superuser: null }); }).finally(function () { setBusy(false); updateMaintenanceState(); });
    }
    function updateMaintenanceState() {
        if (!$("maintenance-status") || busy) return;
        cockpit.spawn(["systemctl", "--user", "is-enabled", "ghsync-maintenance.timer"], { err: "ignore", superuser: null }).then(function () { $("maintenance-status").textContent = "Maintenance timer is enabled."; }, function () { $("maintenance-status").textContent = "No separate maintenance timer is enabled."; });
    }

    function refreshBackups() {
        if (!m.backupApi) { $("backups-status").textContent = "Backup API is unavailable."; return Promise.resolve(); }
        return Promise.all([m.backupApi.list(), m.backupApi.settings(), m.statusSnapshot()]).then(function (values) {
            var backups = values[0], settings = values[1], repos = values[2], body = $("backups-body"), select = $("backup-repo"); body.textContent = ""; select.textContent = "";
            repos.filter(function (r) { return r.branch !== "mirror"; }).forEach(function (r) { var o = document.createElement("option"); o.value = r.name; o.textContent = r.name; select.appendChild(o); });
            $("backup-keep-last").value = settings.keepLast;
            backups.forEach(function (item) {
                var meta = item.metadata || {}, tr = document.createElement("tr");
                tr.innerHTML = '<td class="ghs-mono">' + esc(meta.repository || item.path.split("/").pop()) + '</td><td>' + esc(meta.createdAt ? new Date(meta.createdAt).toLocaleString() : "—") + '</td><td>' + esc(meta.reason || "legacy backup") + '</td><td>' + esc(fmtKb(item.sizeKb)) + '</td><td class="ghs-table__action"></td>';
                var restore = document.createElement("button"); restore.className = "ghs-btn ghs-btn--secondary ghs-btn--sm"; restore.textContent = "Restore copy"; restore.onclick = function () {
                    if (!window.confirm("Restore this backup into a separate recovery copy? The live repository will not be overwritten.")) return;
                    m.backupApi.restore(item.path).then(function (r) { window.alert("Recovery copy created:\n\n" + r.path); notify("success", "Backup restored", "Recovery copy created for " + (r.metadata.repository || "repository") + "."); }).catch(function (e) { window.alert("Restore failed: " + msg(e)); });
                };
                var del = document.createElement("button"); del.className = "ghs-btn ghs-btn--secondary ghs-btn--danger-text ghs-btn--sm"; del.style.marginLeft = ".35rem"; del.textContent = "Delete"; del.onclick = function () { if (window.confirm("Delete this backup permanently?\n\n" + item.path)) m.backupApi.remove(item.path).then(refreshBackups); };
                tr.lastElementChild.appendChild(restore); tr.lastElementChild.appendChild(del); body.appendChild(tr);
            });
            $("backups-status").textContent = backups.length + " backup" + (backups.length === 1 ? "" : "s") + ". Restores always go to a separate recovery copy.";
        });
    }
    function createSelectedBackup() {
        var name = $("backup-repo").value; if (!name || !m.backupApi) return;
        var reason = window.prompt("Reason for this backup:", "manual backup before maintenance"); if (reason === null) return;
        setBusy(true); m.backupApi.create(name, reason || "manual backup").then(function (r) { notify("success", "Repository backup created", r.path); return refreshBackups(); }).catch(function (e) { window.alert("Backup failed: " + msg(e)); }).finally(function () { setBusy(false); });
    }

    function ghApi(check, args) { var cmd = ["gh", "api"]; if (check.host) cmd.push("--hostname", check.host); return cockpit.spawn(cmd.concat(args), { err: "message", superuser: null }); }
    function runDiagnostics() {
        setBusy(true); $("diagnostics-body").textContent = "Running diagnostics…";
        return m.runCore(["check"]).then(parseCheck).then(function (check) {
            var tests = [];
            function add(name, promise, advice) { tests.push(Promise.resolve(promise).then(function (detail) { return { name: name, ok: true, detail: String(detail || "OK").trim() || "OK", advice: "" }; }, function (e) { return { name: name, ok: false, detail: msg(e), advice: advice }; })); }
            add("Git", check.git ? Promise.resolve("Version " + check.git) : Promise.reject(new Error("git is not installed")), "Install Git and reload the page.");
            add("GitHub CLI", check.gh ? Promise.resolve("Version " + check.gh) : Promise.reject(new Error("gh is not installed")), "Install GitHub CLI from cli.github.com.");
            add("GitHub authentication", check.auth === "yes" ? Promise.resolve(check.user || "authenticated") : Promise.reject(new Error("not authenticated")), "Run `gh auth login` as the Cockpit user.");
            add("GitHub API connectivity", ghApi(check, ["rate_limit"]).then(function () { return check.host || "github.com"; }), "Check network/DNS and `gh auth status`.");
            add("Repository disk space", cockpit.spawn(["df", "-Ph", check.root || "."], { err: "message", superuser: null }).then(function (out) { return out.trim().split("\n").slice(-1)[0]; }), "Free disk space or move the repository root.");
            var configDir = check.config ? check.config.slice(0, check.config.lastIndexOf("/")) : "";
            if (configDir) add("Shared manifest", cockpit.spawn(["cat", configDir + "/repository-sync.json"], { err: "message", superuser: null }).then(function (text) {
                var cfg = JSON.parse(text); if (!cfg.sourceRepo) throw new Error("not configured");
                var endpoint = "repos/" + cfg.sourceRepo + "/contents/" + String(cfg.path || "ghsync-repositories.json").split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(cfg.branch || "main");
                return ghApi(check, [endpoint]).then(function () { return cfg.sourceRepo + "/" + (cfg.path || "ghsync-repositories.json"); });
            }), "Open Sync, Test connection, and initialize the manifest if necessary.");
            if ((check.proto || "ssh") === "ssh") add("SSH connectivity", cockpit.spawn(["sh", "-c", 'out=$(ssh -T -o BatchMode=yes -o ConnectTimeout=8 "git@$1" 2>&1 || true); printf "%s" "$out"; echo "$out" | grep -Eqi "successfully authenticated|shell access is disabled|authenticated"', "_", check.host || "github.com"], { err: "message", superuser: null }), "Check SSH keys with `ssh -T git@" + (check.host || "github.com") + "`.");
            return Promise.all(tests);
        }).then(function (results) {
            var body = $("diagnostics-body"); body.textContent = ""; results.forEach(function (r) { var div = document.createElement("div"); div.className = "ghs-alert ghs-alert--" + (r.ok ? "success" : "warning"); div.innerHTML = '<div><strong>' + esc(r.name) + ': ' + (r.ok ? "OK" : "Needs attention") + '</strong><div class="ghs-helper">' + esc(r.detail) + (r.advice ? " · " + esc(r.advice) : "") + '</div></div>'; body.appendChild(div); });
            var failed = results.filter(function (r) { return !r.ok; }); if (failed.length) notify("warning", "Diagnostics found issues", failed.length + " diagnostic check(s) need attention.", failed.map(function (r) { return r.name + ": " + r.advice; }));
            return results;
        }).finally(function () { setBusy(false); });
    }

    function createUi() {
        if ($("panel-health-center")) return;
        var tabs = document.querySelector(".ghs-tabs"), settingsTab = document.querySelector('.ghs-tab[data-tab="settings"]'), settingsPanel = $("panel-settings"); if (!tabs || !settingsPanel) return;
        tab = document.createElement("button"); tab.className = "ghs-tab"; tab.type = "button"; tab.dataset.tab = "health-center"; tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", "false"); tab.textContent = "Health"; tabs.insertBefore(tab, settingsTab || null);
        panel = document.createElement("section"); panel.id = "panel-health-center"; panel.className = "ghs-tab-panel ghs-hidden"; panel.setAttribute("role", "tabpanel");
        panel.innerHTML = '<div class="ghs-form"><div class="ghs-form-actions"><button id="btn-health-scan" class="ghs-btn ghs-btn--primary" type="button">Scan health</button><button id="btn-diagnostics" class="ghs-btn ghs-btn--secondary" type="button">Run diagnostics</button></div><p id="health-status" class="ghs-helper">Health has not been scanned yet.</p></div>' +
            '<h3>Repository health</h3><div class="ghs-table-wrap"><table class="ghs-table"><thead><tr><th>Repository</th><th>Health</th><th>Signals</th><th>Last successful sync</th><th>Disk</th><th>Integrity</th></tr></thead><tbody id="health-body"></tbody></table></div>' +
            '<h3>Scheduled maintenance</h3><div class="ghs-form"><div class="ghs-form-row"><div class="ghs-form-group"><label class="ghs-label" for="maintenance-calendar">OnCalendar</label><input id="maintenance-calendar" class="ghs-input ghs-mono" value="*-*-* 04:00:00"></div><div class="ghs-form-group"><span class="ghs-label">Options</span><label><input id="maintenance-submodules" type="checkbox"> Refresh submodules</label></div></div><div class="ghs-form-actions"><button id="btn-maintenance-run" class="ghs-btn ghs-btn--secondary" type="button">Run maintenance now</button><button id="btn-maintenance-install" class="ghs-btn ghs-btn--secondary" type="button">Enable schedule</button><button id="btn-maintenance-remove" class="ghs-btn ghs-btn--secondary" type="button">Remove schedule</button></div><p id="maintenance-status" class="ghs-helper"></p></div>' +
            '<h3>Backups</h3><div class="ghs-form"><div class="ghs-form-row"><div class="ghs-form-group"><label class="ghs-label" for="backup-repo">Repository</label><select id="backup-repo" class="ghs-input"></select></div><div class="ghs-form-group"><label class="ghs-label" for="backup-keep-last">Keep last per repository</label><input id="backup-keep-last" class="ghs-input" type="number" min="1" max="100" value="10"></div></div><div class="ghs-form-actions"><button id="btn-backup-create" class="ghs-btn ghs-btn--secondary" type="button">Create backup</button><button id="btn-backup-retention" class="ghs-btn ghs-btn--secondary" type="button">Save retention</button><button id="btn-backup-refresh" class="ghs-btn ghs-btn--secondary" type="button">Refresh backups</button></div><p id="backups-status" class="ghs-helper"></p></div><div class="ghs-table-wrap"><table class="ghs-table"><thead><tr><th>Repository</th><th>Time</th><th>Reason</th><th>Size</th><th class="ghs-table__action">Actions</th></tr></thead><tbody id="backups-body"></tbody></table></div>' +
            '<h3>Authentication and connectivity diagnostics</h3><div id="diagnostics-body"><p class="ghs-helper">Run diagnostics to test Git, gh authentication, connectivity, shared-manifest access and disk space.</p></div>';
        settingsPanel.parentNode.insertBefore(panel, settingsPanel);
        tab.onclick = function () { document.querySelectorAll(".ghs-tab").forEach(function (t) { var on = t === tab; t.classList.toggle("ghs-tab--current", on); t.setAttribute("aria-selected", on ? "true" : "false"); }); document.querySelectorAll(".ghs-tab-panel").forEach(function (p) { p.classList.add("ghs-hidden"); }); panel.classList.remove("ghs-hidden"); refreshBackups(); updateMaintenanceState(); };
        $("btn-health-scan").onclick = function () { scanHealth().catch(function () {}); }; $("btn-diagnostics").onclick = function () { runDiagnostics().catch(function () {}); };
        $("btn-maintenance-run").onclick = runMaintenance; $("btn-maintenance-install").onclick = installMaintenanceTimer; $("btn-maintenance-remove").onclick = removeMaintenanceTimer;
        $("btn-backup-create").onclick = createSelectedBackup; $("btn-backup-refresh").onclick = refreshBackups; $("btn-backup-retention").onclick = function () { if (m.backupApi) m.backupApi.saveSettings($("backup-keep-last").value).then(function () { return refreshBackups(); }); };
    }

    ensureOverviewMetric(); createUi();
    window.GHSyncReliability = { scanHealth: scanHealth, runDiagnostics: runDiagnostics, healthRows: function () { return healthRows.slice(); } };
})();
