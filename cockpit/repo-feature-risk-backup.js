/* Offer a reversible backup before the roadmap's riskier cleanup action. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.createBackup) return;

    function hook() {
        var button = document.getElementById("btn-branches-cleanup"), select = document.getElementById("branches-repo");
        if (!button || button.dataset.backupOffer === "yes") return;
        button.dataset.backupOffer = "yes";
        var original = button.onclick;
        button.onclick = function (event) {
            var name = select && select.value;
            if (!name || !window.confirm("Create a recovery backup of " + name + " before branch cleanup?\n\nChoose Cancel to continue to the normal cleanup confirmation without creating a backup.")) {
                if (original) return original.call(button, event); return;
            }
            button.disabled = true;
            return m.createBackup(name, "automatic backup before merged-branch cleanup").then(function () {
                if (original) return original.call(button, event);
            }).catch(function (e) {
                window.alert("Cleanup was not started because the safety backup failed:\n\n" + (e.message || String(e)));
            }).finally(function () { button.disabled = false; });
        };
    }
    hook(); setTimeout(hook, 0);
})();
