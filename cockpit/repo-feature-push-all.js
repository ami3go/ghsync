/* Feature 8: safely push repositories with current branches ahead of upstream. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;
    var anchor = document.getElementById("btn-orphans");
    if (!anchor || document.getElementById("btn-push-pending")) return;

    var button = document.createElement("button");
    button.id = "btn-push-pending"; button.type = "button";
    button.className = "ghs-btn ghs-btn--secondary ghs-btn--sm"; button.textContent = "Push pending";
    anchor.parentNode.insertBefore(button, anchor);

    button.onclick = function () {
        var pending = [];
        document.querySelectorAll("#repos tr").forEach(function (row) {
            var cells = row.children, branch = cells[1] ? cells[1].textContent.trim() : "";
            var ahead = cells[4] ? parseInt(cells[4].textContent, 10) || 0 : 0;
            var name = cells[0] ? cells[0].textContent.trim() : "";
            if (name && ahead > 0 && branch !== "mirror" && branch !== "detached") pending.push(name);
        });
        if (!pending.length) { window.alert("No current branches are ahead of their upstream."); return; }
        if (!window.confirm("Push " + pending.length + " repositories?\n\n" + pending.join("\n"))) return;
        button.disabled = true; button.textContent = "Pushing…";
        var failures = [];
        Promise.all(pending.map(function (name) {
            return m.runGit(name, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
                .then(function () { return m.runGit(name, ["push"]); })
                .catch(function (e) { failures.push(name + ": " + (e.message || String(e))); });
        })).then(m.refreshMainPage).then(function () {
            if (failures.length) window.alert("Some repositories were not pushed:\n\n" + failures.join("\n"));
        }).finally(function () { button.disabled = false; button.textContent = "Push pending"; });
    };
})();
