/* Feature 16: per-repository automatic/manual/ignore update policy. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.loadMeta || !m.saveMeta) return;
    var running = false;

    function policyFor(meta, name) {
        var value = (meta.policies || {})[name] || "automatic";
        return /^(automatic|manual|ignore)$/.test(value) ? value : "automatic";
    }

    function apply() {
        m.loadMeta().then(function (meta) {
            document.querySelectorAll("#repos tr").forEach(function (row) {
                var name = m.rowName ? m.rowName(row) : "";
                var stateCell = row.children[2];
                if (!name || !stateCell) return;
                var old = row.querySelector(".ghs-update-policy");
                if (old) old.remove();
                var policy = policyFor(meta, name);
                row.dataset.updatePolicy = policy;
                if (policy !== "automatic") {
                    var note = document.createElement("div");
                    note.className = "ghs-helper ghs-update-policy";
                    note.textContent = policy === "manual" ? "Manual updates" : "Ignored by automatic updates";
                    stateCell.appendChild(note);
                }
            });
        });
    }

    function edit(name) {
        m.loadMeta().then(function (meta) {
            var current = policyFor(meta, name);
            var answer = window.prompt(
                "Update policy for " + name + ":\n\n" +
                "automatic — included by Update automatic\n" +
                "manual — update only from repository actions\n" +
                "ignore — excluded from automatic updates\n\n" +
                "Enter automatic, manual, or ignore:", current);
            if (answer === null) return;
            answer = answer.trim().toLowerCase();
            if (["automatic", "manual", "ignore"].indexOf(answer) < 0)
                throw new Error("Policy must be automatic, manual, or ignore");
            meta.policies = meta.policies || {};
            if (answer === "automatic") delete meta.policies[name];
            else meta.policies[name] = answer;
            return m.saveMeta().then(apply);
        }).catch(function (e) {
            window.alert("Could not save update policy: " + (e.message || String(e)));
        });
    }

    function runAutomatic(button) {
        if (running) return;
        running = true; button.disabled = true;
        var failures = [];
        Promise.all([m.loadMeta(), m.statusSnapshot()]).then(function (values) {
            var meta = values[0];
            var names = values[1].map(function (repo) { return repo.name; }).filter(function (name) {
                return policyFor(meta, name) === "automatic";
            });
            if (!names.length) throw new Error("No repositories are set to Automatic");
            var chain = Promise.resolve();
            names.forEach(function (name) {
                chain = chain.then(function () {
                    return m.runCore(["pull", name]).catch(function (e) {
                        failures.push(name + ": " + (e.message || String(e)));
                    });
                });
            });
            return chain.then(function () { return names.length; });
        }).then(function (count) {
            m.refreshMainPage();
            if (failures.length)
                window.alert("Automatic update finished for " + count + " repositories with " + failures.length + " failure(s):\n\n" + failures.join("\n"));
            else
                window.alert("Automatic update finished for " + count + " repositories.");
        }).catch(function (e) {
            window.alert("Automatic update failed: " + (e.message || String(e)));
        }).finally(function () { running = false; button.disabled = false; });
    }

    m.registerAction({ label: "Update policy…", run: edit });

    var anchor = document.getElementById("btn-check-updates") || document.getElementById("btn-orphans");
    if (anchor && !document.getElementById("btn-auto-update")) {
        var button = document.createElement("button");
        button.id = "btn-auto-update"; button.type = "button";
        button.className = "ghs-btn ghs-btn--secondary ghs-btn--sm";
        button.textContent = "Update automatic";
        button.title = "Pull only repositories whose update policy is Automatic";
        anchor.parentNode.insertBefore(button, anchor);
        button.onclick = function () { runAutomatic(button); };
    }

    var body = document.getElementById("repos");
    if (body) new MutationObserver(function () { setTimeout(apply, 0); }).observe(body, { childList: true });
    apply();
})();
