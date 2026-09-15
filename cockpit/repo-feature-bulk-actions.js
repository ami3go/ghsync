/* Roadmap: repository selection and safe bulk actions. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.statusSnapshot || !m.mapLimit) return;
    var busy = false;

    function $(id) { return document.getElementById(id); }
    function message(e) { return e && e.message ? e.message : String(e || "Unknown error"); }
    function notify(variant, title, body, details) {
        if (window.GHSyncNotifications && window.GHSyncNotifications.add) window.GHSyncNotifications.add({ variant: variant, title: title, body: body || "", details: details || [], source: "bulk" });
    }
    function selected() {
        return Array.prototype.slice.call(document.querySelectorAll("#repos .ghs-select-repo:checked")).map(function (input) { return input.dataset.repo || ""; }).filter(Boolean);
    }
    function updateCount() {
        var names = selected(), count = $("bulk-count"); if (count) count.textContent = names.length ? names.length + " selected" : "";
        document.querySelectorAll("#ghs-bulk-actions button[data-needs-selection]").forEach(function (button) { button.disabled = busy || !names.length; });
    }
    function attachCheckboxes() {
        document.querySelectorAll("#repos tr").forEach(function (row) {
            var cell = row.querySelector(".ghs-repo-name"); if (!cell || cell.querySelector(".ghs-select-repo")) return;
            var name = m.rowName ? m.rowName(row) : (row.dataset.repoName || cell.textContent.trim()); if (!name) return;
            var input = document.createElement("input"); input.type = "checkbox"; input.className = "ghs-select-repo"; input.dataset.repo = name;
            input.setAttribute("aria-label", "Select " + name); input.style.marginRight = ".55rem"; input.onchange = updateCount;
            cell.insertBefore(input, cell.firstChild);
        });
        updateCount();
    }
    function setBusy(on) { busy = on; updateCount(); }
    function runNames(names, limit, worker) {
        var failures = [];
        return m.mapLimit(names, limit || 3, function (name) {
            return Promise.resolve().then(function () { return worker(name); }).catch(function (e) { failures.push(name + ": " + message(e)); });
        }).then(function () { return failures; });
    }
    function finish(title, names, failures) {
        m.refreshMainPage();
        var summary = title + " finished for " + names.length + " repositories" + (failures.length ? "; " + failures.length + " failed" : ".");
        notify(failures.length ? "warning" : "success", title, summary, failures);
        if (failures.length) window.alert(summary + "\n\n" + failures.join("\n"));
    }
    function pullSelected() {
        var names = selected(); if (!names.length) return;
        if (!window.confirm("Pull " + names.length + " selected repositories?\n\n" + names.join("\n"))) return;
        setBusy(true); runNames(names, 3, function (name) { return m.runCore(["pull", name]); })
            .then(function (failures) { finish("Pull selected", names, failures); }).finally(function () { setBusy(false); });
    }
    function pushSelected() {
        var names = selected(); if (!names.length) return;
        if (!window.confirm("Push current branches for selected repositories that are ahead of an existing upstream?\n\n" + names.join("\n"))) return;
        setBusy(true); var skipped = [];
        runNames(names, 3, function (name) {
            return Promise.all([
                m.runGit(name, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]),
                m.runGit(name, ["symbolic-ref", "--quiet", "--short", "HEAD"])
            ]).then(function (values) {
                var ahead = parseInt(values[0].trim().split(/\s+/)[0], 10) || 0;
                if (!ahead) { skipped.push(name + ": not ahead"); return; }
                return m.runGit(name, ["push"]);
            }).catch(function (e) {
                if (/upstream|tracking|symbolic-ref/i.test(message(e))) { skipped.push(name + ": no usable upstream/current branch"); return; }
                throw e;
            });
        }).then(function (failures) {
            finish("Push selected", names, failures);
            if (skipped.length) notify("info", "Bulk push skipped repositories", skipped.length + " selected repositories did not need or could not safely push.", skipped);
        }).finally(function () { setBusy(false); });
    }
    function checkSelected() {
        var names = selected(); if (!names.length) return;
        setBusy(true); var summaries = [];
        runNames(names, 4, function (name) {
            return m.runGit(name, ["fetch", "--all", "--prune", "--tags"]).then(function () {
                return m.runGit(name, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]).then(function (out) {
                    var p = out.trim().split(/\s+/); summaries.push(name + ": " + (parseInt(p[0], 10) || 0) + " ahead, " + (parseInt(p[1], 10) || 0) + " behind");
                }, function () { summaries.push(name + ": fetched; no upstream comparison"); });
            });
        }).then(function (failures) {
            m.refreshMainPage(); notify(failures.length ? "warning" : "success", "Check updates selected", names.length + " repositories checked.", summaries.concat(failures));
            window.alert(summaries.join("\n") + (failures.length ? "\n\nFailures:\n" + failures.join("\n") : ""));
        }).finally(function () { setBusy(false); });
    }
    function commitSelected() {
        var names = selected(); if (!names.length) return;
        var msg = window.prompt("Commit message to use for every safe selected dirty repository:"); if (msg === null) return; msg = msg.trim(); if (!msg) return window.alert("Commit message is required.");
        setBusy(true); var candidates = [], skipped = [];
        m.statusSnapshot().then(function (rows) {
            var set = {}; names.forEach(function (n) { set[n] = true; });
            rows.forEach(function (row) {
                if (!set[row.name]) return;
                if (row.dirty > 0 && row.branch !== "mirror" && row.branch !== "detached") candidates.push(row.name);
                else skipped.push(row.name + ": no safe dirty working tree on a branch");
            });
            if (!candidates.length) throw new Error("None of the selected repositories can be safely committed");
            if (!window.confirm("Create local commits in " + candidates.length + " repositories?\n\nThis stages all changes in those repositories but does not push.\n\n" + candidates.join("\n"))) throw { cancelled: true };
            return runNames(candidates, 1, function (name) { return m.runCore(["commit", name, msg]); });
        }).then(function (failures) {
            finish("Commit selected", candidates, failures); if (skipped.length) notify("info", "Bulk commit skipped repositories", skipped.length + " repositories were left untouched.", skipped);
        }).catch(function (e) { if (!(e && e.cancelled)) window.alert("Commit selected failed: " + message(e)); })
            .finally(function () { setBusy(false); });
    }
    function assignSelected() {
        var names = selected(); if (!names.length || !m.loadMeta || !m.saveMeta) return;
        m.loadMeta().then(function (meta) {
            var group = window.prompt("Group for selected repositories (blank keeps current groups):", ""); if (group === null) return;
            group = group.trim(); if (group && !/^[A-Za-z0-9._-]+$/.test(group)) throw new Error("Invalid group name");
            var labelsText = window.prompt("Comma-separated labels/tags to add to selected repositories (blank adds none):", ""); if (labelsText === null) return;
            var labels = labelsText.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
            if (!group && !labels.length) return;
            if (!window.confirm("Apply metadata to " + names.length + " selected repositories?")) return;
            meta.groups = meta.groups || {}; meta.tags = meta.tags || {}; meta.groupDefinitions = meta.groupDefinitions || [];
            if (group && meta.groupDefinitions.indexOf(group) < 0) meta.groupDefinitions.push(group);
            names.forEach(function (name) {
                if (group) meta.groups[name] = group;
                var tags = Array.isArray(meta.tags[name]) ? meta.tags[name].slice() : [];
                labels.forEach(function (label) { if (tags.indexOf(label) < 0) tags.push(label); });
                if (tags.length) meta.tags[name] = tags;
            });
            return m.saveMeta().then(function () { if (m.refreshGroups) m.refreshGroups(); notify("success", "Repository metadata updated", names.length + " repositories updated."); });
        }).catch(function (e) { window.alert("Could not assign group/labels: " + message(e)); });
    }
    function selectVisible() {
        document.querySelectorAll("#repos tr").forEach(function (row) {
            if (row.style.display === "none") return; var cb = row.querySelector(".ghs-select-repo"); if (cb) cb.checked = true;
        }); updateCount();
    }
    function clearSelection() { document.querySelectorAll("#repos .ghs-select-repo").forEach(function (cb) { cb.checked = false; }); updateCount(); }
    function addButton(container, id, text, fn, needs) {
        var b = document.createElement("button"); b.id = id; b.type = "button"; b.className = "ghs-btn ghs-btn--secondary ghs-btn--sm"; b.textContent = text; b.onclick = fn;
        if (needs) b.dataset.needsSelection = "yes"; container.appendChild(b); return b;
    }
    function installToolbar() {
        var toolbar = document.querySelector("#panel-repos .ghs-toolbar"); if (!toolbar || $("ghs-bulk-actions")) return;
        var wrap = document.createElement("div"); wrap.id = "ghs-bulk-actions"; wrap.className = "ghs-form-actions"; wrap.style.flexWrap = "wrap";
        var count = document.createElement("span"); count.id = "bulk-count"; count.className = "ghs-helper"; wrap.appendChild(count);
        addButton(wrap, "btn-bulk-select-visible", "Select visible", selectVisible, false);
        addButton(wrap, "btn-bulk-clear", "Clear", clearSelection, false);
        addButton(wrap, "btn-bulk-pull", "Pull selected", pullSelected, true);
        addButton(wrap, "btn-bulk-push", "Push selected", pushSelected, true);
        addButton(wrap, "btn-bulk-check", "Check updates selected", checkSelected, true);
        addButton(wrap, "btn-bulk-commit", "Commit selected", commitSelected, true);
        addButton(wrap, "btn-bulk-meta", "Group / labels selected", assignSelected, true);
        toolbar.parentNode.insertBefore(wrap, toolbar.nextSibling); updateCount();
    }

    installToolbar(); attachCheckboxes();
    var body = $("repos"); if (body) new MutationObserver(function () { setTimeout(attachCheckboxes, 0); }).observe(body, { childList: true, subtree: true });
    window.GHSyncBulk = { selected: selected };
})();
