/* Roadmap: recovery backups with structured metadata, restore copies and retention. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    function checkValues(out) {
        var values = {};
        out.split("\n").forEach(function (line) { var f = line.split("\t"); if (f[0] === "check") values[f[1]] = f[2] || ""; });
        return values;
    }
    function redactOrigin(value) {
        value = (value || "").trim(); if (!/^https?:\/\//i.test(value)) return value;
        try { var url = new URL(value); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); }
        catch (e) { return value.replace(/^(https?:\/\/)[^/@]+@/i, "$1").replace(/[?#].*$/, ""); }
    }
    function writePrivate(path, content) { return cockpit.file(path).replace(content || "").then(function () { return cockpit.spawn(["chmod", "600", path], { err: "message" }); }); }
    function statePaths() {
        return m.runCore(["check"]).then(checkValues).then(function (cfg) {
            if (!cfg.log) throw new Error("Could not determine ghsync state directory");
            var state = cfg.log.slice(0, cfg.log.lastIndexOf("/"));
            return { state: state, backups: state + "/backups", settings: state + "/backups/settings.json", recovery: state + "/recovery" };
        });
    }
    function readSettings(paths) {
        return cockpit.spawn(["cat", paths.settings], { err: "ignore", superuser: null }).then(function (text) {
            try { var value = JSON.parse(text); return { keepLast: Math.max(1, Math.min(100, parseInt(value.keepLast, 10) || 10)) }; }
            catch (e) { return { keepLast: 10 }; }
        }, function () { return { keepLast: 10 }; });
    }
    function saveSettings(keepLast) {
        keepLast = Math.max(1, Math.min(100, parseInt(keepLast, 10) || 10));
        return statePaths().then(function (paths) { return cockpit.spawn(["mkdir", "-p", "-m", "700", paths.backups], { err: "message" }).then(function () { return writePrivate(paths.settings, JSON.stringify({ keepLast: keepLast }, null, 2) + "\n"); }); });
    }
    function createGitArtifacts(dir, root) {
        var script = ["set -euo pipefail", "umask 077", "dir=$1", "root=$2",
            "if git -C \"$dir\" show-ref --head --quiet; then git -C \"$dir\" bundle create \"$root/repository.bundle\" --all >/dev/null; fi",
            "list=\"$root/.untracked-list\"", "git -C \"$dir\" ls-files --others --exclude-standard -z >\"$list\"",
            "if [ -s \"$list\" ]; then tar -C \"$dir\" --null --verbatim-files-from -T \"$list\" -czf \"$root/untracked.tar.gz\"; fi",
            "rm -f \"$list\"", "chmod 600 \"$root\"/* 2>/dev/null || true"].join("\n");
        return cockpit.spawn(["bash", "-c", script, "_", dir, root], { err: "message" });
    }
    function applyRetention(paths, name, keepLast) {
        var prefix = name.replace("/", "__") + "-";
        var script = ["set -euo pipefail", "root=$1", "prefix=$2", "keep=$3", "[ -d \"$root\" ] || exit 0",
            "mapfile -t rows < <(find \"$root\" -mindepth 1 -maxdepth 1 -type d -name \"${prefix}*\" -printf '%T@ %p\\n' | sort -nr)",
            "for ((i=keep; i<${#rows[@]}; i++)); do path=${rows[$i]#* }; rm -rf -- \"$path\"; done"].join("\n");
        return cockpit.spawn(["bash", "-c", script, "_", paths.backups, prefix, String(keepLast)], { err: "message", superuser: null });
    }
    function createBackup(name, reason) {
        reason = String(reason || "manual backup");
        return Promise.all([m.repoDirectory(name), statePaths(), cockpit.spawn(["date", "+%Y%m%d-%H%M%S"], { err: "message" })]).then(function (values) {
            var dir = values[0], paths = values[1], stamp = values[2].trim(), root = paths.backups + "/" + name.replace("/", "__") + "-" + stamp;
            return cockpit.spawn(["mkdir", "-p", "-m", "700", root], { err: "message" }).then(function () {
                return Promise.all([
                    cockpit.spawn(["git", "-C", dir, "status", "--porcelain=v1", "--branch"], { err: "message" }),
                    cockpit.spawn(["git", "-C", dir, "diff", "--binary"], { err: "message" }),
                    cockpit.spawn(["git", "-C", dir, "diff", "--cached", "--binary"], { err: "message" }),
                    cockpit.spawn(["git", "-C", dir, "remote", "get-url", "origin"], { err: "ignore" }),
                    cockpit.spawn(["git", "-C", dir, "rev-parse", "HEAD"], { err: "ignore" }), readSettings(paths)
                ]);
            }).then(function (parts) {
                var createdAt = new Date().toISOString(), origin = redactOrigin(parts[3]), head = parts[4].trim() || "";
                var metadata = { version: 1, repository: name, createdAt: createdAt, reason: reason, origin: origin, head: head };
                var manifest = "Repository: " + name + "\nCreated: " + createdAt + "\nReason: " + reason + "\nOrigin: " + (origin || "(none)") + "\nHEAD: " + (head || "(unborn)") + "\n\nStatus:\n" + parts[0];
                var restore = "GitHub Sync recovery backup\n\nThe Cockpit Backups view restores into a separate recovery copy by default, so the live repository is never overwritten.\nrepository.bundle contains committed refs; staged.patch and working.patch contain tracked changes; untracked.tar.gz contains untracked files when present.\n";
                return Promise.all([
                    writePrivate(root + "/metadata.json", JSON.stringify(metadata, null, 2) + "\n"), writePrivate(root + "/manifest.txt", manifest),
                    writePrivate(root + "/working.patch", parts[1]), writePrivate(root + "/staged.patch", parts[2]), writePrivate(root + "/RESTORE.txt", restore), createGitArtifacts(dir, root)
                ]).then(function () { return applyRetention(paths, name, parts[5].keepLast); }).then(function () { return { path: root, metadata: metadata }; });
            });
        });
    }
    function listBackups() {
        return statePaths().then(function (paths) {
            var script = "set -e; mkdir -p -m 700 \"$1\"; find \"$1\" -mindepth 1 -maxdepth 1 -type d -printf '%T@\\t%p\\n' | sort -nr";
            return cockpit.spawn(["bash", "-c", script, "_", paths.backups], { err: "message", superuser: null }).then(function (out) {
                var rows = out.split("\n").filter(Boolean);
                return Promise.all(rows.map(function (line) {
                    var f = line.split("\t"), path = f.slice(1).join("\t");
                    return Promise.all([
                        cockpit.spawn(["cat", path + "/metadata.json"], { err: "ignore", superuser: null }),
                        cockpit.spawn(["du", "-sk", path], { err: "ignore", superuser: null })
                    ]).then(function (v) {
                        var meta = {}; try { meta = JSON.parse(v[0]); } catch (e) { meta = {}; }
                        var size = parseInt((v[1].split(/\s+/)[0] || "0"), 10) || 0;
                        return { path: path, modified: parseFloat(f[0]) || 0, sizeKb: size, metadata: meta };
                    });
                }));
            });
        });
    }
    function deleteBackup(path) {
        return statePaths().then(function (paths) {
            if (String(path).indexOf(paths.backups + "/") !== 0 || /\/\.\.?($|\/)/.test(path)) throw new Error("Refusing to delete outside the backup directory");
            return cockpit.spawn(["rm", "-rf", "--", path], { err: "message", superuser: null });
        });
    }
    function restoreBackup(path) {
        return statePaths().then(function (paths) {
            if (String(path).indexOf(paths.backups + "/") !== 0) throw new Error("Invalid backup path");
            return cockpit.spawn(["cat", path + "/metadata.json"], { err: "message", superuser: null }).then(function (text) {
                var meta = JSON.parse(text), safe = String(meta.repository || "").replace(/[^A-Za-z0-9._-]+/g, "__");
                if (!safe) throw new Error("Backup metadata has no repository name");
                var stamp = new Date().toISOString().replace(/[:.]/g, "-"); var dest = paths.recovery + "/" + safe + "-" + stamp;
                var script = ["set -euo pipefail", "src=$1", "dest=$2", "mkdir -p -m 700 \"$(dirname \"$dest\")\"",
                    "if [ -f \"$src/repository.bundle\" ]; then git clone \"$src/repository.bundle\" \"$dest\" >/dev/null 2>&1; else mkdir -p \"$dest\"; git -C \"$dest\" init >/dev/null; fi",
                    "[ ! -s \"$src/staged.patch\" ] || git -C \"$dest\" apply --index \"$src/staged.patch\"",
                    "[ ! -s \"$src/working.patch\" ] || git -C \"$dest\" apply \"$src/working.patch\"",
                    "[ ! -f \"$src/untracked.tar.gz\" ] || tar -C \"$dest\" -xzf \"$src/untracked.tar.gz\"", "printf '%s\\n' \"$dest\""].join("\n");
                return cockpit.spawn(["bash", "-c", script, "_", path, dest], { err: "message", superuser: null }).then(function (out) { return { path: out.trim(), metadata: meta }; });
            });
        });
    }

    m.createBackup = createBackup;
    m.backupApi = { create: createBackup, list: listBackups, remove: deleteBackup, restore: restoreBackup, settings: function () { return statePaths().then(readSettings); }, saveSettings: saveSettings };
    m.registerAction({ label: "Backup local work…", run: function (name) {
        if (!window.confirm("Create a recovery backup of local work for " + name + "?")) return;
        createBackup(name, "manual repository backup").then(function (result) { window.alert("Local-work backup created:\n\n" + result.path); })
            .catch(function (e) { window.alert("Backup failed for " + name + ": " + (e.message || String(e))); });
    }});
})();
