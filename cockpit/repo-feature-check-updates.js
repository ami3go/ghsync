/* Feature 7: refresh remote state without pulling. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;
    var panel = document.getElementById("panel-repos"), orphan = document.getElementById("btn-orphans");
    if (!panel || !orphan || document.getElementById("btn-check-updates")) return;

    var button = document.createElement("button");
    button.id = "btn-check-updates";
    button.type = "button";
    button.className = "ghs-btn ghs-btn--secondary ghs-btn--sm";
    button.textContent = "Check updates";
    orphan.parentNode.insertBefore(button, orphan);

    button.onclick = function () {
        button.disabled = true; button.textContent = "Checking…";
        var failures = [];
        m.statusSnapshot().then(function (repos) {
            if (!repos.length) throw new Error("No local repositories were found");
            return m.mapLimit(repos, 4, function (repo) {
                return m.runGit(repo.name, ["fetch", "--all", "--prune", "--tags", "--quiet"])
                    .catch(function (e) { failures.push(repo.name + ": " + (e.message || String(e))); });
            });
        }).then(function () {
            m.refreshMainPage();
            if (failures.length) window.alert("Some repositories could not be fetched:\n\n" + failures.join("\n"));
        }).catch(function (e) {
            window.alert("Update check failed: " + (e.message || String(e)));
        }).finally(function () {
            button.disabled = false; button.textContent = "Check updates";
        });
    };
})();
