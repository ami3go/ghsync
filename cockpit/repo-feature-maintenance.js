/* Feature 19: repository maintenance tools. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    function showResult(name, operation, output) {
        var text = output && output.trim() ? output.trim() : "Completed successfully.";
        window.alert(operation + " — " + name + "\n\n" + text);
    }

    function maintenance(name) {
        var choice = window.prompt(
            "Maintenance for " + name + ":\n\n" +
            "1 — Integrity check (git fsck --full)\n" +
            "2 — Garbage collection (git gc)\n" +
            "3 — Prune stale origin refs (git remote prune origin)\n" +
            "4 — Refresh submodules\n\n" +
            "Enter 1, 2, 3, or 4:", "1");
        if (choice === null) return;
        choice = choice.trim();
        var args, label;
        if (choice === "1") { args = ["fsck", "--full"]; label = "Integrity check"; }
        else if (choice === "2") { args = ["gc"]; label = "Garbage collection"; }
        else if (choice === "3") { args = ["remote", "prune", "origin"]; label = "Origin prune"; }
        else if (choice === "4") { args = ["submodule", "update", "--init", "--recursive"]; label = "Submodule refresh"; }
        else { window.alert("Choose 1, 2, 3, or 4."); return; }

        if ((choice === "2" || choice === "3") && !window.confirm(label + " for " + name + "?")) return;
        m.runGit(name, args).then(function (out) {
            showResult(name, label, out);
            m.refreshMainPage();
        }).catch(function (e) {
            window.alert(label + " failed for " + name + ":\n\n" + (e.message || String(e)));
        });
    }

    m.registerAction({ label: "Maintenance…", run: maintenance });
})();
