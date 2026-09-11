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

    function write(path, content) {
        return cockpit.file(path).replace(content || "");
    }

    function backup(name) {
        Promise.all([m.repoDirectory(name), m.runCore(["check"]), cockpit.spawn(["date", "+%Y%m%d-%H%M%S"], { err: "message" })])
            .then(function (values) {
                var dir = values[0], cfg = checkValues(values[1]), stamp = values[2].trim();
                if (!cfg.log) throw new Error("Could not determine ghsync state directory");
                var state = cfg.log.slice(0, cfg.log.lastIndexOf("/"));
                var root = state + "/backups/" + name.replace("/", "__") + "-" + stamp;
                return cockpit.spawn(["mkdir", "-p", root], { err: "message" }).then(function () {
                    return Promise.all([
                        cockpit.spawn(["git", "-C", dir, "status", "--porcelain=v1", "--branch"], { err: "message" }),
                        cockpit.spawn(["git", "-C", dir, "diff", "--binary"], { err: "message" }),
                        cockpit.spawn(["git", "-C", dir, "diff", "--cached", "--binary"], { err: "message" }),
                        cockpit.spawn(["git", "-C", dir, "remote", "get-url", "origin"], { err: "ignore" }),
                        cockpit.spawn(["git", "-C", dir, "rev-parse", "HEAD"], { err: "ignore" })
                    ]).then(function (parts) {
                        var manifest = "Repository: " + name + "\nCreated: " + new Date().toISOString() + "\nOrigin: " + (parts[3].trim() || "(none)") + "\nHEAD: " + (parts[4].trim() || "(unborn)") + "\n\nStatus:\n" + parts[0];
                        var restore =
                            "GitHub Sync local-work backup\n\n" +
                            "repository.bundle contains committed refs when the repository has commits.\n" +
                            "staged.patch contains staged changes.\n" +
                            "working.patch contains unstaged tracked-file changes.\n" +
                            "untracked.tar.gz contains untracked files when any existed.\n\n" +
                            "Typical recovery:\n" +
                            "  git clone repository.bundle recovered-repo\n" +
                            "  cd recovered-repo\n" +
                            "  git apply ../staged.patch\n" +
                            "  git apply ../working.patch\n" +
                            "  tar -xzf ../untracked.tar.gz   # if present\n";
                        return Promise.all([
                            write(root + "/manifest.txt", manifest),
                            write(root + "/working.patch", parts[1]),
                            write(root + "/staged.patch", parts[2]),
                            write(root + "/RESTORE.txt", restore),
                            cockpit.spawn(["bash", "-c",
                                'git -C "$1" bundle create "$2/repository.bundle" --all >/dev/null 2>&1 || true; ' +
                                'git -C "$1" ls-files --others --exclude-standard -z | ' +
                                'tar -C "$1" --null -T - -czf "$2/untracked.tar.gz" 2>/dev/null || true',
                                "_", dir, root], { err: "message" })
                        ]).then(function () { return root; });
                    });
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
