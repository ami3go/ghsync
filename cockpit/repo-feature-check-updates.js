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
        var names = Array.prototype.map.call(document.querySelectorAll("#repos tr .ghs-repo-name"), function (el) { return el.textContent.trim(); });
        if (!names.length) return;
        button.disabled = true; button.textContent = "Checking…";
        var failures = [];
        Promise.all(names.map(function (name) {
            return m.runGit(name, ["fetch", "--all", "--prune", "--tags", "--quiet"])
                .catch(function (e) { failures.push(name + ": " + (e.message || String(e))); });
        })).then(function () { m.refreshMainPage(); })
          .then(function () { if (failures.length) window.alert("Some repositories could not be fetched:\n\n" + failures.join("\n")); })
          .finally(function () { button.disabled = false; button.textContent = "Check updates"; });
    };
})();
