/* Roadmap: per-repository sync policy with group inheritance and machine overrides. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.loadMeta || !m.saveMeta || !m.statusSnapshot) return;
    var running = false, MACHINE = null;
    var VALID = ["manual", "pull-only", "pull+push", "fetch-only"];

    function normalizePolicy(value) {
        value = String(value || "").trim().toLowerCase();
        if (value === "automatic") return "pull-only";
        if (value === "ignore") return "manual";
        return VALID.indexOf(value) >= 0 ? value : "";
    }
    function machineId() {
        if (MACHINE) return Promise.resolve(MACHINE);
        return m.runCore(["check"]).then(function (out) {
            var config = "";
            out.split("\n").forEach(function (line) {
                var f = line.split("\t"); if (f[0] === "check" && f[1] === "config") config = f[2] || "";
            });
            if (!config) throw new Error("Could not determine config directory");
            var dir = config.slice(0, config.lastIndexOf("/"));
            return cockpit.spawn(["cat", dir + "/repository-sync.json"], { err: "ignore", superuser: null }).then(function (text) {
                try { MACHINE = String((JSON.parse(text) || {}).machine || "").trim(); } catch (e) { MACHINE = ""; }
                if (MACHINE) return MACHINE;
                return cockpit.spawn(["hostname", "-s"], { err: "ignore", superuser: null }).then(function (host) { MACHINE = host.trim() || "this-machine"; return MACHINE; });
            }, function () { return cockpit.spawn(["hostname", "-s"], { err: "ignore", superuser: null }).then(function (host) { MACHINE = host.trim() || "this-machine"; return MACHINE; }); });
        });
    }
    function effective(meta, name, machine) {
        meta = meta || {};
        var perMachine = meta.machinePolicies && meta.machinePolicies[name];
        var value = perMachine && normalizePolicy(perMachine[machine]);
        if (value) return { policy: value, source: "machine" };
        value = normalizePolicy((meta.policies || {})[name]);
        if (value) return { policy: value, source: "repository" };
        var group = (meta.groups || {})[name] || "";
        value = group ? normalizePolicy((meta.groupPolicies || {})[group]) : "";
        if (value) return { policy: value, source: "group " + group };
        return { policy: "pull-only", source: "default" };
    }
    m.policyFor = function (meta, name, machine) { return effective(meta, name, machine || MACHINE || "").policy; };
    m.policyDetails = effective;

    function apply() {
        return Promise.all([m.loadMeta(), machineId()]).then(function (values) {
            var meta = values[0], machine = values[1];
            document.querySelectorAll("#repos tr").forEach(function (row) {
                var name = m.rowName ? m.rowName(row) : "", stateCell = row.children[2];
                if (!name || !stateCell) return;
                var old = row.querySelector(".ghs-update-policy"); if (old) old.remove();
                var p = effective(meta, name, machine); row.dataset.updatePolicy = p.policy;
                if (p.policy !== "pull-only" || p.source !== "default") {
                    var note = document.createElement("div"); note.className = "ghs-helper ghs-update-policy";
                    note.textContent = p.policy + " · " + p.source; stateCell.appendChild(note);
                }
            });
        });
    }
    function promptPolicy(label, current, allowInherit) {
        var suffix = allowInherit ? "\ninherit — remove this override" : "";
        var answer = window.prompt(label + "\n\nmanual — never automatic\npull-only — fetch and fast-forward only\npull+push — pull safely, then push current branch if ahead\nfetch-only — fetch/prune without merging" + suffix + "\n\nEnter policy:", current || (allowInherit ? "inherit" : "pull-only"));
        if (answer === null) return null;
        answer = answer.trim().toLowerCase();
        if (allowInherit && answer === "inherit") return "inherit";
        if (VALID.indexOf(answer) < 0) throw new Error("Policy must be manual, pull-only, pull+push or fetch-only");
        return answer;
    }
    function edit(name) {
        Promise.all([m.loadMeta(), machineId()]).then(function (values) {
            var meta = values[0], machine = values[1], current = effective(meta, name, machine);
            var scope = window.prompt("Policy scope for " + name + ":\n\nrepository — shareable repository override\nmachine — override only on " + machine + "\ngroup — policy for its current group\n\nEnter repository, machine, or group:", "repository");
            if (scope === null) return; scope = scope.trim().toLowerCase();
            if (["repository", "machine", "group"].indexOf(scope) < 0) throw new Error("Unknown policy scope");
            if (scope === "group") {
                var group = (meta.groups || {})[name]; if (!group) throw new Error(name + " is not assigned to a group");
                var gp = promptPolicy("Group policy for " + group + ":", normalizePolicy((meta.groupPolicies || {})[group]) || "pull-only", true); if (gp === null) return;
                meta.groupPolicies = meta.groupPolicies || {}; if (gp === "inherit") delete meta.groupPolicies[group]; else meta.groupPolicies[group] = gp;
            } else if (scope === "machine") {
                var mp = promptPolicy("Machine policy for " + name + " on " + machine + ":", current.source === "machine" ? current.policy : "inherit", true); if (mp === null) return;
                meta.machinePolicies = meta.machinePolicies || {}; meta.machinePolicies[name] = meta.machinePolicies[name] || {};
                if (mp === "inherit") delete meta.machinePolicies[name][machine]; else meta.machinePolicies[name][machine] = mp;
                if (!Object.keys(meta.machinePolicies[name]).length) delete meta.machinePolicies[name];
            } else {
                var rp = promptPolicy("Repository policy for " + name + ":", current.source === "repository" ? current.policy : "inherit", true); if (rp === null) return;
                meta.policies = meta.policies || {}; if (rp === "inherit") delete meta.policies[name]; else meta.policies[name] = rp;
            }
            return m.saveMeta().then(apply);
        }).catch(function (e) { window.alert("Could not save sync policy: " + (e.message || String(e))); });
    }
    function pushIfAhead(name) {
        return Promise.all([
            m.runGit(name, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]),
            m.runGit(name, ["symbolic-ref", "--quiet", "--short", "HEAD"])
        ]).then(function (values) {
            var parts = values[0].trim().split(/\s+/), ahead = parseInt(parts[0], 10) || 0;
            if (!ahead) return "";
            return m.runGit(name, ["push"]).then(function () { return "pushed"; });
        });
    }
    function runPolicies(button) {
        if (running) return;
        running = true; button.disabled = true;
        var failures = [], counts = { manual: 0, "pull-only": 0, "pull+push": 0, "fetch-only": 0 };
        Promise.all([m.loadMeta(), m.statusSnapshot(), machineId()]).then(function (values) {
            var meta = values[0], rows = values[1], machine = values[2];
            return m.mapLimit(rows, 3, function (row) {
                var policy = effective(meta, row.name, machine).policy; counts[policy] += 1;
                if (policy === "manual") return;
                var work;
                if (policy === "fetch-only") work = m.runGit(row.name, ["fetch", "--all", "--prune", "--tags"]);
                else work = m.runCore(["pull", row.name]);
                if (policy === "pull+push") work = work.then(function () { return pushIfAhead(row.name); });
                return work.catch(function (e) { failures.push(row.name + ": " + (e.message || String(e))); });
            });
        }).then(function () {
            m.refreshMainPage();
            var summary = "Policy run: " + counts["pull-only"] + " pull-only, " + counts["pull+push"] + " pull+push, " + counts["fetch-only"] + " fetch-only, " + counts.manual + " manual";
            if (failures.length) summary += "; " + failures.length + " failed";
            if (window.GHSyncNotifications && window.GHSyncNotifications.add) window.GHSyncNotifications.add({ variant: failures.length ? "warning" : "success", title: "Repository policy run finished", body: summary, details: failures, source: "policy" });
            window.alert(summary + (failures.length ? "\n\n" + failures.join("\n") : ""));
        }).catch(function (e) { window.alert("Policy run failed: " + (e.message || String(e))); })
            .finally(function () { running = false; button.disabled = false; });
    }

    m.registerAction({ label: "Sync policy…", run: edit });
    var anchor = document.getElementById("btn-check-updates") || document.getElementById("btn-orphans");
    if (anchor && !document.getElementById("btn-auto-update")) {
        var button = document.createElement("button"); button.id = "btn-auto-update"; button.type = "button";
        button.className = "ghs-btn ghs-btn--secondary ghs-btn--sm"; button.textContent = "Run policies";
        button.title = "Apply pull-only, pull+push and fetch-only policies; manual repositories are skipped";
        anchor.parentNode.insertBefore(button, anchor); button.onclick = function () { runPolicies(button); };
    }
    var body = document.getElementById("repos"); if (body) new MutationObserver(function () { setTimeout(apply, 0); }).observe(body, { childList: true });
    apply();
    window.GHSyncPolicy = { normalize: normalizePolicy, effective: effective, valid: VALID.slice(), machineId: machineId };
})();
