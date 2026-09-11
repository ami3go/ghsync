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
        button.disabled = true; button.textContent = "Checking…";
        var failures = [], pending = [];
        m.statusSnapshot().then(function (repos) {
            pending = repos.filter(function (repo) {
                return repo.ahead > 0 && repo.branch !== "mirror" && repo.branch !== "detached";
            });
            if (!pending.length) throw { nothingToPush: true };
            if (!window.confirm("Push " + pending.length + " repositories?\n\n" + pending.map(function (repo) { return repo.name; }).join("\n")))
                throw { cancelled: true };
            button.textContent = "Pushing…";
            return m.mapLimit(pending, 4, function (repo) {
                return m.runGit(repo.name, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
                    .then(function () { return m.runGit(repo.name, ["push"]); })
                    .catch(function (e) { failures.push(repo.name + ": " + (e.message || String(e))); });
            });
        }).then(function () {
            m.refreshMainPage();
            if (failures.length) window.alert("Some repositories were not pushed:\n\n" + failures.join("\n"));
        }).catch(function (e) {
            if (e && e.cancelled) return;
            if (e && e.nothingToPush) { window.alert("No current branches are ahead of their upstream."); return; }
            window.alert("Bulk push failed: " + (e.message || String(e)));
        }).finally(function () {
            button.disabled = false; button.textContent = "Push pending";
        });
    };
})();
