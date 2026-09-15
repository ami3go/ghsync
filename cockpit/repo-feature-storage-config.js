/* Roadmap Priority 5: disk usage/cleanup and safe configuration backup/migration. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.statusSnapshot || !m.mapLimit) return;
    var tab, panel, diskRows = [], importBundle = null;

    function $(id) { return document.getElementById(id); }
    function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function msg(e) { return e && e.message ? e.message : String(e || "Unknown error"); }
    function parseCheck(out) { var v = {}; out.split("\n").forEach(function (line) { var f = line.split("\t"); if (f[0] === "check") v[f[1]] = f[2] || ""; }); return v; }
    function fmtKb(kb) { kb = Number(kb) || 0; if (kb >= 1048576) return (kb / 1048576).toFixed(1) + " GiB"; if (kb >= 1024) return (kb / 1024).toFixed(1) + " MiB"; return Math.round(kb) + " KiB"; }
    function notify(variant, title, body, details) { if (window.GHSyncNotifications && window.GHSyncNotifications.add) window.GHSyncNotifications.add({ variant: variant, title: title, body: body || "", details: details || [], source: "storage" }); }

    function scanDisk() {
        $("storage-status").textContent = "Scanning repository disk usage…";
        return Promise.all([m.statusSnapshot(), m.repositoryRoot()]).then(function (values) {
            var rows = values[0], root = values[1];
            return Promise.all([
                m.mapLimit(rows, 4, function (row) {
                    return m.repoDirectory(row.name).then(function (dir) {
                        return Promise.all([
                            cockpit.spawn(["du", "-sk", dir], { err: "ignore", superuser: null }),
                            row.branch === "mirror" ? Promise.resolve("0") : cockpit.spawn(["du", "-sk", dir + "/.git"], { err: "ignore", superuser: null }).catch(function () { return "0"; })
                        ]).then(function (parts) {
                            var total = parseInt(parts[0].split(/\s+/)[0], 10) || 0, git = row.branch === "mirror" ? total : (parseInt(parts[1].split(/\s+/)[0], 10) || 0);
                            return { name: row.name, totalKb: total, gitKb: git, workKb: Math.max(0, total - git), branch: row.branch };
                        });
                    });
                }),
                cockpit.spawn(["df", "-Pk", root], { err: "message", superuser: null })
            ]).then(function (parts) {
                var data = parts[0], df = parts[1].trim().split("\n").slice(-1)[0].trim().split(/\s+/), usedPct = parseInt((df[4] || "0").replace("%", ""), 10) || 0;
                var sortedSizes = data.map(function (r) { return r.totalKb; }).sort(function (a, b) { return a - b; }), median = sortedSizes.length ? sortedSizes[Math.floor(sortedSizes.length / 2)] : 0;
                data.forEach(function (r) { r.large = r.totalKb > 2 * 1024 * 1024 || (median > 0 && r.totalKb > median * 3); });
                diskRows = data.sort(function (a, b) { return b.totalKb - a.totalKb; });
                return { rows: diskRows, usedPct: usedPct, freeKb: parseInt(df[3], 10) || 0, root: root };
            });
        }).then(function (result) { renderDisk(result); return result; }).catch(function (e) { $("storage-status").textContent = "Disk scan failed: " + msg(e); throw e; });
    }
    function renderDisk(result) {
        var body = $("storage-body"); body.textContent = ""; var total = 0;
        result.rows.forEach(function (row) {
            total += row.totalKb; var tr = document.createElement("tr"); if (row.large) tr.title = "Unusually large repository";
            tr.innerHTML = '<td class="ghs-mono">' + esc(row.name) + (row.large ? ' <span title="Unusually large">⚠</span>' : '') + '</td><td>' + esc(fmtKb(row.workKb)) + '</td><td>' + esc(fmtKb(row.gitKb)) + '</td><td>' + esc(fmtKb(row.totalKb)) + '</td><td class="ghs-table__action"></td>';
            var gc = document.createElement("button"); gc.className = "ghs-btn ghs-btn--secondary ghs-btn--sm"; gc.type = "button"; gc.textContent = "git gc --auto"; gc.onclick = function () { m.runGit(row.name, ["gc", "--auto"]).then(function () { notify("success", "Repository cleanup finished", row.name + " — git gc --auto"); return scanDisk(); }).catch(function (e) { window.alert("git gc failed: " + msg(e)); }); }; tr.lastElementChild.appendChild(gc); body.appendChild(tr);
        });
        $("storage-status").textContent = "Repository root uses " + fmtKb(total) + " across tracked repositories. Filesystem: " + result.usedPct + "% used, " + fmtKb(result.freeKb) + " free.";
        if (result.usedPct >= 90) notify("warning", "Repository filesystem is almost full", result.usedPct + "% of the filesystem containing " + result.root + " is used.");
    }

    function sanitizeUrl(value) {
        value = String(value || "").trim(); if (!/^https?:\/\//i.test(value)) return value;
        try { var u = new URL(value); u.username = ""; u.password = ""; u.search = ""; u.hash = ""; return u.toString(); } catch (e) { return value.replace(/^(https?:\/\/)[^/@]+@/i, "$1").replace(/[?#].*$/, ""); }
    }
    function safeString(value) { value = String(value == null ? "" : value); if (/[\r\n\0]/.test(value)) throw new Error("Configuration values cannot contain control characters"); return value; }
    function shellQuote(value) { return '"' + safeString(value).replace(/([\\"$`])/g, "\\$1") + '"'; }
    function buildConfig(settings) {
        settings = settings || {}; var proto = settings.proto === "https" ? "https" : "ssh", filter = /^(blob:none|tree:0|depth:[1-9][0-9]*|none)$/.test(settings.filter || "") ? settings.filter : "blob:none";
        function bool(v) { return v === true || v === "true" ? "true" : "false"; } function num(v, d) { v = parseInt(v, 10); return isFinite(v) && v > 0 ? v : d; }
        return ["# ghsync configuration restored from a safe migration bundle",
            "ROOT=" + shellQuote(settings.root || "$HOME/github"), "OWNERS=" + shellQuote(settings.owners || ""), "PROTOCOL=" + shellQuote(proto),
            "INCLUDE_FORKS=" + bool(settings.forks), "INCLUDE_ARCHIVED=" + bool(settings.archived), "JOBS=" + num(settings.jobs, 4), "LIMIT=" + num(settings.limit, 1000), "GIT_TIMEOUT=600",
            "HOST=" + shellQuote(settings.host || ""), "CLONE_FILTER=" + shellQuote(filter), "MIRROR=" + bool(settings.mirror), "EXCLUDE=" + shellQuote(settings.exclude || ""), "NOTIFY=" + (settings.notify === false || settings.notify === "false" ? "false" : "true"), ""].join("\n");
    }
    function readOptional(path) { return cockpit.spawn(["cat", path], { err: "ignore", superuser: null }).then(function (t) { return t; }, function () { return ""; }); }
    function configPaths(check) { var dir = check.config.slice(0, check.config.lastIndexOf("/")); return { dir: dir, config: check.config, meta: dir + "/repository-meta.json", sync: dir + "/repository-sync.json", third: dir + "/third-party.tsv" }; }
    function exportConfig() {
        return m.runCore(["check"]).then(parseCheck).then(function (check) {
            if (!check.config) throw new Error("Configuration path is unavailable"); var paths = configPaths(check);
            return Promise.all([readOptional(paths.meta), readOptional(paths.sync), readOptional(paths.third)]).then(function (files) {
                var meta = {}, sync = {}; try { meta = JSON.parse(files[0] || "{}"); } catch (e) { meta = {}; } try { sync = JSON.parse(files[1] || "{}"); } catch (e2) { sync = {}; }
                var third = files[2].split("\n").filter(Boolean).map(function (line) { var f = line.split("\t"); return f[0] + "\t" + sanitizeUrl(f[1] || ""); }).join("\n"); if (third) third += "\n";
                var cronExpr = check.cron ? check.cron.trim().split(/\s+/).slice(0, 5).join(" ") : "";
                return { version: 1, exportedAt: new Date().toISOString(), settings: { root: check.root, owners: check.owners, proto: check.proto, jobs: check.jobs, limit: check.limit, forks: check.forks, archived: check.archived, host: check.host, filter: check.filter, mirror: check.mirror, exclude: check.exclude, notify: check.notify }, schedule: { timer: check.timer || "", cron: cronExpr }, repositoryMeta: meta, repositorySync: sync, thirdPartyTsv: third };
            });
        }).then(function (bundle) {
            var blob = new Blob([JSON.stringify(bundle, null, 2) + "\n"], { type: "application/json" }), url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = "ghsync-config-" + new Date().toISOString().slice(0, 10) + ".json"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); notify("success", "Configuration exported", "Credentials and authentication data were not included."); return bundle;
        }).catch(function (e) { window.alert("Configuration export failed: " + msg(e)); });
    }
    function validateBundle(value) {
        if (!value || typeof value !== "object" || Number(value.version) !== 1) throw new Error("Unsupported configuration bundle");
        var text = JSON.stringify(value); if (/token|password|secret|credential/i.test(text)) throw new Error("Bundle contains a key or value that looks like a credential/secret and was rejected");
        value.settings = value.settings || {}; value.schedule = value.schedule || {}; value.repositoryMeta = value.repositoryMeta || {}; value.repositorySync = value.repositorySync || {}; value.thirdPartyTsv = String(value.thirdPartyTsv || "");
        return value;
    }
    function previewImport(bundle) {
        var lines = ["Configuration bundle v" + bundle.version, "Exported: " + (bundle.exportedAt || "unknown"), "Repository root: " + (bundle.settings.root || "default"), "Owners: " + (bundle.settings.owners || "authenticated user"), "Machine ID: " + ((bundle.repositorySync || {}).machine || "not set"), "Groups/metadata entries: " + Object.keys((bundle.repositoryMeta || {}).groups || {}).length, "Third-party registry lines: " + bundle.thirdPartyTsv.split("\n").filter(Boolean).length, "Schedule: " + (bundle.schedule.timer || bundle.schedule.cron || "none"), "", "No credentials, tokens, SSH keys or gh authentication are imported."];
        $("config-import-preview").textContent = lines.join("\n"); $("btn-config-apply").disabled = false;
    }
    function applyImport() {
        if (!importBundle) return; if (!window.confirm("Apply this configuration bundle to this PC? Existing ghsync configuration files will be replaced. Repositories themselves are not deleted.")) return;
        m.runCore(["check"]).then(parseCheck).then(function (check) {
            var paths = configPaths(check), b = importBundle, writes = [cockpit.file(paths.config).replace(buildConfig(b.settings)), cockpit.file(paths.meta).replace(JSON.stringify(b.repositoryMeta, null, 2) + "\n"), cockpit.file(paths.sync).replace(JSON.stringify(b.repositorySync, null, 2) + "\n"), cockpit.file(paths.third).replace(b.thirdPartyTsv)];
            return cockpit.spawn(["mkdir", "-p", paths.dir], { err: "message", superuser: null }).then(function () { return Promise.all(writes); });
        }).then(function () {
            var sched = importBundle.schedule || {}; if (sched.timer) return m.runCore(["timer", "install", safeString(sched.timer)]); if (sched.cron) return m.runCore(["cron", "install", safeString(sched.cron)]); return Promise.resolve();
        }).then(function () { notify("success", "Configuration restored", "Configuration and scheduling were applied. Reloading repository data is recommended."); window.alert("Configuration restored. Reload the Cockpit page to apply every setting."); }).catch(function (e) { window.alert("Configuration restore failed: " + msg(e)); });
    }
    function chooseImport(file) {
        if (!file) return; var reader = new FileReader(); reader.onload = function () { try { importBundle = validateBundle(JSON.parse(String(reader.result || ""))); previewImport(importBundle); } catch (e) { importBundle = null; $("btn-config-apply").disabled = true; $("config-import-preview").textContent = "Import rejected: " + msg(e); } }; reader.readAsText(file);
    }

    function createUi() {
        if ($("panel-storage-config")) return; var tabs = document.querySelector(".ghs-tabs"), settings = document.querySelector('.ghs-tab[data-tab="settings"]'), settingsPanel = $("panel-settings"); if (!tabs || !settingsPanel) return;
        tab = document.createElement("button"); tab.className = "ghs-tab"; tab.type = "button"; tab.dataset.tab = "storage-config"; tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", "false"); tab.textContent = "Storage"; tabs.insertBefore(tab, settings || null);
        panel = document.createElement("section"); panel.id = "panel-storage-config"; panel.className = "ghs-tab-panel ghs-hidden"; panel.setAttribute("role", "tabpanel");
        panel.innerHTML = '<div class="ghs-form"><div class="ghs-form-actions"><button id="btn-storage-scan" class="ghs-btn ghs-btn--primary" type="button">Scan disk usage</button></div><p id="storage-status" class="ghs-helper">Disk usage has not been scanned yet.</p></div><div class="ghs-table-wrap"><table class="ghs-table"><thead><tr><th>Repository</th><th>Working tree</th><th>.git</th><th>Total</th><th class="ghs-table__action">Cleanup</th></tr></thead><tbody id="storage-body"></tbody></table></div>' +
            '<h3>Configuration backup and migration</h3><div class="ghs-form"><p class="ghs-helper">Exports local ghsync settings, machine ID, repository metadata, shared-sync configuration, scheduling and the third-party registry. Credentials and gh authentication are never exported.</p><div class="ghs-form-actions"><button id="btn-config-export" class="ghs-btn ghs-btn--secondary" type="button">Export configuration</button><label class="ghs-btn ghs-btn--secondary" for="config-import-file">Choose configuration backup</label><input id="config-import-file" type="file" accept="application/json,.json" class="ghs-hidden"><button id="btn-config-apply" class="ghs-btn ghs-btn--primary" type="button" disabled>Apply restored configuration…</button></div><pre id="config-import-preview" class="ghs-log" style="max-height:14rem">No configuration backup selected.</pre></div>';
        settingsPanel.parentNode.insertBefore(panel, settingsPanel); tab.onclick = function () { document.querySelectorAll(".ghs-tab").forEach(function (t) { var on = t === tab; t.classList.toggle("ghs-tab--current", on); t.setAttribute("aria-selected", on ? "true" : "false"); }); document.querySelectorAll(".ghs-tab-panel").forEach(function (p) { p.classList.add("ghs-hidden"); }); panel.classList.remove("ghs-hidden"); };
        $("btn-storage-scan").onclick = function () { scanDisk().catch(function () {}); }; $("btn-config-export").onclick = exportConfig; $("config-import-file").onchange = function () { chooseImport(this.files && this.files[0]); }; $("btn-config-apply").onclick = applyImport;
    }
    createUi(); window.GHSyncStorage = { scanDisk: scanDisk, validateBundle: validateBundle, buildConfig: buildConfig };
})();
