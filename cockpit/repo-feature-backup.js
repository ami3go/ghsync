/* Feature 18: recovery backup for local-only repository work. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    function checkValues(out) {
        var values = {};
        out.split("\n").forEach(function (line) {
            var f = line.split("\t"); if (f[0] === "check") values[f[1]] = f[2] || "";
        });
        return values;
    }

    function redactOrigin(value) {
        value = (value || "").trim();
        if (!/^https?:\/\//i.test(value)) return value;
        try {
            var url = new URL(value);
            if (url.username || url.password) {
                url.username = "";
                url.password = "";
            }
            return url.toString();
        } catch (e) {
            return value.replace(/^(https?:\/\/)[^/@]+@/i, "$1");
        }
    }

    function writePrivate(path, content) {
        return cockpit.file(path).replace(content || "")
            .then(function () { return cockpit.spawn(["chmod", "600", path], { err: "message" }); });
    }

    function createGitArtifacts(dir, root) {
        var script = [
            "set -euo pipefail",
            "umask 077",
            "dir=$1",
            "root=$2",
            "if git -C \"$dir\" show-ref --head --quiet; then",
            "  git -C \"$dir\" bundle create \"$root/repository.bundle\" --all >/dev/null",
            "fi",
            "list=\"$root/.untracked-list\"",
            "git -C \"$dir\" ls-files --others --exclude-standard -z >\"$list\"",
            "if [ -s \"$list\" ]; then",
            "  tar -C \"$dir\" --null --verbatim-files-from -T \"$list\" -czf \"$root/untracked.tar.gz\"",
            "fi",
            "rm -f \"$list\"",
            "chmod 600 \"$root\"/* 2>/dev/null || true"
        ].join("\n");
        return cockpit.spawn(["bash", "-c", script, "_", dir, root], { err: "message" });
    }

    function backup(name) {
        Promise.all([m.repoDirectory(name), m.runCore(["check"]), cockpit.spawn(["date", "+%Y%m%d-%H%M%S"], { err: "message" })])
            .then(function (values) {
                var dir = values[0], cfg = checkValues(values[1]), stamp = values[2].trim();
                if (!cfg.log) throw new Error("Could not determine ghsync state directory");
                var state = cfg.log.slice(0, cfg.log.lastIndexOf("/"));
                var root = state + "/backups/" + name.replace("/", "__") + "-" + stamp;
                return cockpit.spawn(["mkdir", "-p", "-m", "700", root], { err: "message" })
                    .then(function () { return cockpit.spawn(["chmod", "700", root], { err: "message" }); })
                    .then(function () {
                        return Promise.all([
                            cockpit.spawn(["git", "-C", dir, "status", "--porcelain=v1", "--branch"], { err: "message" }),
                            cockpit.spawn(["git", "-C", dir, "diff", "--binary"], { err: "message" }),
                            cockpit.spawn(["git", "-C", dir, "diff", "--cached", "--binary"], { err: "message" }),
                            cockpit.spawn(["git", "-C", dir, "remote", "get-url", "origin"], { err: "ignore" }),
                            cockpit.spawn(["git", "-C", dir, "rev-parse", "HEAD"], { err: "ignore" })
                        ]);
                    }).then(function (parts) {
                        var manifest = "Repository: " + name + "\nCreated: " + new Date().toISOString() +
                            "\nOrigin: " + (redactOrigin(parts[3]) || "(none)") +
                            "\nHEAD: " + (parts[4].trim() || "(unborn)") + "\n\nStatus:\n" + parts[0];
                        var restore =
                            "GitHub Sync local-work backup\n\n" +
                            "repository.bundle contains committed refs when the repository has refs.\n" +
                            "staged.patch contains staged changes.\n" +
                            "working.patch contains unstaged tracked-file changes.\n" +
                            "untracked.tar.gz contains untracked files when any existed.\n\n" +
                            "Typical recovery for a repository with repository.bundle:\n" +
                            "  git clone repository.bundle recovered-repo\n" +
                            "  cd recovered-repo\n" +
                            "  git apply --index ../staged.patch\n" +
                            "  git apply ../working.patch\n" +
                            "  tar -xzf ../untracked.tar.gz   # if present\n\n" +
                            "For an unborn repository, recreate/init the repository first; repository.bundle may be absent.\n";
                        return Promise.all([
                            writePrivate(root + "/manifest.txt", manifest),
                            writePrivate(root + "/working.patch", parts[1]),
                            writePrivate(root + "/staged.patch", parts[2]),
                            writePrivate(root + "/RESTORE.txt", restore),
                            createGitArtifacts(dir, root)
                        ]).then(function () { return root; });
                    });
            }).then(function (path) {
                window.alert("Local-work backup created:\n\n" + path);
            }).catch(function (e) {
                window.alert("Backup failed for " + name + ": " + (e.message || String(e)));
            });
    }

    m.registerAction({ label: "Backup local work…", run: function (name) {
        if (window.confirm("Create a recovery backup of local work for " + name + "?")) backup(name);
    }});
})();
