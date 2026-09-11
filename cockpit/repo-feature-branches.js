/* Feature 6: local branch management. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    function manageBranches(name) {
        Promise.all([
            m.runGit(name, ["branch", "--format=%(refname:short)"]),
            m.runGit(name, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(function () { return "detached"; })
        ]).then(function (v) {
            var branches = v[0].trim().split("\n").filter(Boolean), current = v[1].trim();
            var answer = window.prompt("Current: " + current + "\n\nLocal branches:\n" + branches.join("\n") +
                "\n\nEnter a branch to switch.\nUse +name to create and switch.\nUse -name to safely delete a merged local branch.");
            if (answer === null) return;
            answer = answer.trim(); if (!answer) return;
            if (answer.charAt(0) === "+") {
                var created = answer.slice(1).trim();
                if (!created) throw new Error("Branch name is required");
                return m.runGit(name, ["switch", "-c", created]);
            }
            if (answer.charAt(0) === "-") {
                var removed = answer.slice(1).trim();
                if (!removed) throw new Error("Branch name is required");
                if (removed === current) throw new Error("Switch away from " + removed + " before deleting it");
                if (!window.confirm("Delete local branch " + removed + "? Git will refuse if it is not safely merged.")) return;
                return m.runGit(name, ["branch", "-d", removed]);
            }
            return m.runGit(name, ["switch", answer]);
        }).then(function (result) {
            if (result !== undefined) m.refreshMainPage();
        }).catch(function (e) { window.alert("Branch operation failed for " + name + ": " + (e.message || String(e))); });
    }

    m.registerAction({
        label: "Branches…",
        state: function (name, row) {
            var branch = row.children[1] ? row.children[1].textContent.trim() : "";
            return branch === "mirror" ? { disabled: true, title: "Bare mirrors do not have a working branch" } : {};
        },
        run: manageBranches
    });
})();
