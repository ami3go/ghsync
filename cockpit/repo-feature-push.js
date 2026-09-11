/* Feature 3: safe push from the repository action menu. */
(function () {
    "use strict";
    var manager = window.GHSyncRepoManager;
    if (!manager) return;

    function pushRepository(name) {
        return manager.runGit(name, ["symbolic-ref", "--quiet", "--short", "HEAD"])
            .then(function (out) {
                var branch = out.trim();
                if (!branch) throw new Error("Repository is not on a branch");
                return manager.runGit(name, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
                    .then(function () { return manager.runGit(name, ["push"]); })
                    .catch(function () {
                        if (!window.confirm(branch + " has no upstream. Push it to origin and set origin/" + branch + " as upstream?"))
                            throw { cancelled: true };
                        return manager.runGit(name, ["push", "-u", "origin", branch]);
                    });
            })
            .then(function () {
                window.alert("Pushed " + name + " successfully.");
                manager.refreshMainPage();
            })
            .catch(function (ex) {
                if (ex && ex.cancelled) return;
                window.alert("Push failed for " + name + ": " + (ex.message || String(ex)));
            });
    }

    manager.registerAction({
        label: "Push",
        state: function (name, row) {
            var branch = row.children[1] ? row.children[1].textContent.trim() : "";
            if (branch === "mirror") return { disabled: true, title: "Bare mirrors are refreshed with Pull" };
            if (branch === "detached") return { disabled: true, title: "Switch to a branch before pushing" };
            return {};
        },
        run: pushRepository
    });
})();
