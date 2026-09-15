/* Export and import the current repository list from the Cockpit UI. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.statusSnapshot || !m.mapLimit) return;

    function $(id) { return document.getElementById(id); }

    var panel = $("panel-repos");
    var toolbar = panel && panel.querySelector(".ghs-toolbar");
    if (!toolbar || $("btn-repo-export") || $("btn-repo-import")) return;

    var exportBtn = document.createElement("button");
    exportBtn.id = "btn-repo-export";
    exportBtn.type = "button";
    exportBtn.className = "ghs-btn ghs-btn--secondary ghs-btn--sm";
    exportBtn.textContent = "Export list";

    var importBtn = document.createElement("button");
    importBtn.id = "btn-repo-import";
    importBtn.type = "button";
    importBtn.className = "ghs-btn ghs-btn--secondary ghs-btn--sm";
    importBtn.textContent = "Import list";

    var chooser = document.createElement("input");
    chooser.id = "repo-list-file";
    chooser.type = "file";
    chooser.accept = ".tsv,.txt,text/tab-separated-values,text/plain";
    chooser.className = "ghs-hidden";

    var status = document.createElement("span");
    status.id = "repo-list-status";
    status.className = "ghs-toolbar__count";

    var anchor = $("btn-orphans") || $("repo-count");
    toolbar.insertBefore(exportBtn, anchor);
    toolbar.insertBefore(importBtn, anchor);
    toolbar.insertBefore(status, anchor);
    toolbar.appendChild(chooser);

    function resize() {
        try { cockpit.transport.control("size-change"); } catch (e) { /* standalone */ }
    }

    function setStatus(text, bad) {
        status.textContent = text || "";
        status.className = "ghs-toolbar__count" + (bad ? " ghs-t-red" : "");
        resize();
    }

    function setBusy(on) {
        exportBtn.disabled = on;
        importBtn.disabled = on;
    }

    function cleanOrigin(value) {
        value = (value || "").trim();
        if (!value) return "";
        if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
            try {
                var url = new URL(value);
                url.username = "";
                url.password = "";
                url.search = "";
                url.hash = "";
                value = url.toString();
            } catch (e) {
                value = value.replace(/^(https?:\/\/)[^/@]+@/i, "$1").replace(/[?#].*$/, "");
            }
        }
        return value;
    }

    function validEntry(name, url) {
        return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name) &&
            !!url && url.charAt(0) !== "-" && !/[\r\n\t]/.test(url);
    }

    function downloadText(name, text) {
        var blob = new Blob([text], { type: "text/tab-separated-values;charset=utf-8" });
        var href = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = href;
        link.download = name;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(href); }, 0);
    }

    function exportList() {
        setBusy(true);
        setStatus("Reading repository origins…");
        m.statusSnapshot().then(function (rows) {
            if (!rows.length) throw new Error("No local repositories to export");
            return m.mapLimit(rows, 6, function (row) {
                return m.runGit(row.name, ["remote", "get-url", "origin"])
                    .then(function (origin) {
                        origin = cleanOrigin(origin);
                        if (!validEntry(row.name, origin)) return null;
                        return { name: row.name, url: origin };
                    }, function () { return null; });
            });
        }).then(function (entries) {
            var usable = entries.filter(Boolean).sort(function (a, b) { return a.name.localeCompare(b.name); });
            if (!usable.length) throw new Error("No repositories with a usable origin URL were found");
            var lines = [
                "# GitHub Sync repository list v1",
                "# repository\tclone-url"
            ];
            usable.forEach(function (entry) { lines.push(entry.name + "\t" + entry.url); });
            var stamp = new Date().toISOString().slice(0, 10);
            downloadText("ghsync-repositories-" + stamp + ".tsv", lines.join("\n") + "\n");
            setStatus("Exported " + usable.length + (usable.length === 1 ? " repository" : " repositories"));
        }).catch(function (e) {
            setStatus(e.message || String(e), true);
        }).finally(function () { setBusy(false); });
    }

    function parseList(text) {
        var entries = [];
        var positions = Object.create(null);
        text.split(/\r?\n/).forEach(function (line, index) {
            if (!line.trim() || /^\s*#/.test(line)) return;
            var tab = line.indexOf("\t");
            if (tab <= 0) throw new Error("Line " + (index + 1) + " is not repository<TAB>clone-url");
            var name = line.slice(0, tab).trim();
            var url = line.slice(tab + 1).trim();
            if (!validEntry(name, url)) throw new Error("Line " + (index + 1) + " contains an invalid repository name or URL");
            if (Object.prototype.hasOwnProperty.call(positions, name)) {
                entries[positions[name]].url = url;
            } else {
                positions[name] = entries.length;
                entries.push({ name: name, url: url });
            }
        });
        return entries;
    }

    function readCheck() {
        var cfg = {};
        return m.runCore(["check"]).then(function (out) {
            out.split("\n").forEach(function (line) {
                var f = line.split("\t");
                if (f[0] === "check") cfg[f[1]] = f[2] || "";
            });
            return cfg;
        });
    }

    function exists(path) {
        return cockpit.spawn(["test", "-e", path], { err: "ignore", superuser: null })
            .then(function () { return true; }, function () { return false; });
    }

    function cloneOne(root, cfg, entry) {
        var base = root.replace(/\/$/, "") + "/" + entry.name;
        var mirror = cfg.mirror === "true";
        var dest = mirror ? base + ".git" : base;
        return Promise.all([exists(base + "/.git"), exists(base + ".git")]).then(function (present) {
            if (present[0] || present[1]) return { state: "exists", name: entry.name };
            var parent = dest.slice(0, dest.lastIndexOf("/"));
            return cockpit.spawn(["mkdir", "-p", "--", parent], { err: "message", superuser: null })
                .then(function () {
                    var args = ["clone"];
                    if (mirror) {
                        args.push("--mirror", "--quiet");
                    } else {
                        args.push("--recurse-submodules", "--quiet");
                        if (cfg.filter === "blob:none" || cfg.filter === "tree:0") {
                            args.push("--filter=" + cfg.filter);
                        } else if (/^depth:[1-9][0-9]*$/.test(cfg.filter || "")) {
                            args.push("--depth", cfg.filter.slice(6), "--no-single-branch");
                        }
                    }
                    args.push("--", entry.url, dest);
                    return cockpit.spawn(["git"].concat(args), { err: "message", superuser: null });
                }).then(function () {
                    return { state: "cloned", name: entry.name };
                }, function (e) {
                    return { state: "failed", name: entry.name, error: e.message || String(e) };
                });
        });
    }

    function importText(text) {
        var entries;
        try { entries = parseList(text); }
        catch (e) { setStatus(e.message || String(e), true); return; }
        if (!entries.length) { setStatus("The selected file contains no repositories", true); return; }
        if (!window.confirm("Import " + entries.length + (entries.length === 1 ? " repository" : " repositories") + " and clone any that are missing?")) return;

        setBusy(true);
        setStatus("Importing " + entries.length + (entries.length === 1 ? " repository…" : " repositories…"));
        Promise.all([m.repositoryRoot(), readCheck()]).then(function (values) {
            var root = values[0], cfg = values[1];
            var jobs = Math.max(1, Math.min(16, parseInt(cfg.jobs, 10) || 4));
            return m.mapLimit(entries, jobs, function (entry) { return cloneOne(root, cfg, entry); });
        }).then(function (results) {
            var cloned = 0, existing = 0, failed = [];
            results.forEach(function (r) {
                if (r.state === "cloned") cloned += 1;
                else if (r.state === "exists") existing += 1;
                else failed.push(r);
            });
            var summary = cloned + " cloned, " + existing + " already present";
            if (failed.length) summary += ", " + failed.length + " failed";
            setStatus(summary, failed.length > 0);
            if (failed.length) {
                window.alert("Some repositories could not be imported:\n\n" + failed.slice(0, 8).map(function (r) {
                    return r.name + ": " + r.error;
                }).join("\n") + (failed.length > 8 ? "\n…" : ""));
            }
            m.refreshMainPage();
        }).catch(function (e) {
            setStatus("Import failed: " + (e.message || String(e)), true);
        }).finally(function () { setBusy(false); });
    }

    exportBtn.onclick = exportList;
    importBtn.onclick = function () { chooser.value = ""; chooser.click(); };
    chooser.onchange = function () {
        var file = chooser.files && chooser.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () { importText(String(reader.result || "")); };
        reader.onerror = function () { setStatus("Could not read the selected file", true); };
        reader.readAsText(file);
    };

    resize();
})();
