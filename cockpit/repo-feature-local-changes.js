/* Feature 13: safe local-change tools. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    function workingTreeState(row) {
        var branch = row.children[1] ? row.children[1].textContent.trim() : "";
        if (branch === "mirror") return { disabled: true, title: "Bare mirrors have no working tree" };
        return {};
    }
    function stash(name) {
        var stamp = new Date().toISOString().replace(/[:.]/g, "-");
        m.runGit(name, ["status", "--porcelain"]).then(function (out) {
            if (!out.trim()) throw new Error("No working-tree changes to stash");
            return m.runGit(name, ["stash", "push", "-u", "-m", "ghsync manual stash " + stamp]);
        }).then(function () {
            window.alert("Changes stashed for " + name + ".");
            m.refreshMainPage();
        }).catch(function (e) { window.alert("Stash failed for " + name + ": " + (e.message || String(e))); });
    }
    function restore(name) {
        m.runGit(name, ["stash", "list", "--format=%gd%x09%s"]).then(function (out) {
            var first = out.trim().split("\n")[0];
            if (!first) throw new Error("No stash is available");
            if (!window.confirm("Apply the latest stash to " + name + "?\n\n" + first + "\n\nThe stash entry will be kept until you drop it manually.")) return null;
            return m.runGit(name, ["stash", "apply", "stash@{0}"]);
        }).then(function (result) {
            if (result === null) return;
            window.alert("Latest stash applied to " + name + ".");
            m.refreshMainPage();
        }).catch(function (e) { window.alert("Restore failed for " + name + ": " + (e.message || String(e))); });
    }
    function discard(name) {
        m.runGit(name, ["status", "--porcelain"]).then(function (out) {
            if (!out.trim()) throw new Error("No working-tree changes to discard");
            var required = "DISCARD " + name;
            var typed = window.prompt("This permanently resets tracked files and deletes untracked files in " + name + ".\n\nType exactly:\n" + required);
            if (typed === null) return null;
            if (typed !== required) throw new Error("Confirmation did not match; nothing was changed");
            return m.runGit(name, ["reset", "--hard", "HEAD"])
                .then(function () { return m.runGit(name, ["clean", "-fd"]); });
        }).then(function (result) {
            if (result === null) return;
            window.alert("Local working-tree changes discarded in " + name + ".");
            m.refreshMainPage();
        }).catch(function (e) { window.alert("Discard failed for " + name + ": " + (e.message || String(e))); });
    }

    m.registerAction({ label: "Stash changes", state: function (n, row) { return workingTreeState(row); }, run: stash });
    m.registerAction({ label: "Restore latest stash", state: function (n, row) { return workingTreeState(row); }, run: restore });
    m.registerAction({ label: "Discard changes…", state: function (n, row) { return workingTreeState(row); }, run: discard });
})();
