/* Feature 9: persistent repository groups, labels, notes and policy metadata. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;
    var META = null, PATH = null;

    function uniq(values) {
        var seen = Object.create(null), out = [];
        (values || []).forEach(function (value) {
            value = String(value || "").trim();
            if (!value || seen[value]) return;
            seen[value] = true; out.push(value);
        });
        return out;
    }
    function defaultMeta() {
        return {
            groups: {}, groupDefinitions: [], tags: {}, favorites: {}, policies: {},
            groupPolicies: {}, machinePolicies: {}, notes: {}, labelRules: {}, shareLabels: false
        };
    }
    function normalizeObject(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
    function normalizeMeta(value) {
        value = normalizeObject(value);
        var out = defaultMeta();
        ["groups", "tags", "favorites", "policies", "groupPolicies", "machinePolicies", "notes", "labelRules"].forEach(function (key) {
            out[key] = normalizeObject(value[key]);
        });
        out.groupDefinitions = uniq(Array.isArray(value.groupDefinitions) ? value.groupDefinitions : []);
        out.shareLabels = value.shareLabels === true;
        Object.keys(out.groups).forEach(function (repo) {
            var group = String(out.groups[repo] || "").trim();
            if (group && out.groupDefinitions.indexOf(group) < 0) out.groupDefinitions.push(group);
        });
        out.groupDefinitions.sort();
        return out;
    }
    function rowName(row) {
        if (row.dataset.repoName) return row.dataset.repoName;
        var cell = row.querySelector(".ghs-repo-name"); if (!cell) return "";
        var clone = cell.cloneNode(true);
        clone.querySelectorAll(".ghs-repo-meta,.ghs-favorite-star,.ghs-update-policy,.ghs-health-state,.ghs-repo-source").forEach(function (el) { el.remove(); });
        var name = clone.textContent.trim(); row.dataset.repoName = name; return name;
    }
    m.rowName = rowName;
    function metaPath() {
        if (PATH) return Promise.resolve(PATH);
        return m.runCore(["check"]).then(function (out) {
            var config = "";
            out.split("\n").some(function (line) { var f = line.split("\t"); if (f[0] === "check" && f[1] === "config") { config = f[2] || ""; return true; } return false; });
            if (!config) throw new Error("Could not determine ghsync config directory");
            PATH = config.slice(0, config.lastIndexOf("/")) + "/repository-meta.json";
            return PATH;
        });
    }
    function loadMeta(force) {
        if (META && !force) return Promise.resolve(META);
        return metaPath().then(function (path) { return cockpit.spawn(["cat", path], { err: "ignore" }); })
            .then(function (text) { try { META = normalizeMeta(JSON.parse(text)); } catch (e) { META = defaultMeta(); } return META; })
            .catch(function () { META = defaultMeta(); return META; });
    }
    function saveMeta() {
        META = normalizeMeta(META);
        return metaPath().then(function (path) {
            var dir = path.slice(0, path.lastIndexOf("/"));
            return cockpit.spawn(["mkdir", "-p", dir], { err: "message" })
                .then(function () { return cockpit.file(path).replace(JSON.stringify(META, null, 2) + "\n"); });
        });
    }
    m.loadMeta = loadMeta; m.saveMeta = saveMeta; m.getMeta = function () { return META || defaultMeta(); }; m.normalizeMeta = normalizeMeta;

    function ensureFilter() {
        var toolbar = document.querySelector("#panel-repos .ghs-toolbar"), search = document.getElementById("filter");
        if (!toolbar || !search || document.getElementById("repo-group-filter")) return;
        var select = document.createElement("select"); select.id = "repo-group-filter"; select.className = "ghs-input ghs-input--narrow"; select.setAttribute("aria-label", "Filter by group");
        toolbar.insertBefore(select, search.parentNode.nextSibling); select.onchange = apply;
    }
    function rebuildFilter() {
        ensureFilter(); var select = document.getElementById("repo-group-filter"); if (!select || !META) return;
        var current = select.value, names = uniq(META.groupDefinitions || []);
        Object.keys(META.groups || {}).forEach(function (repo) {
            var group = String(META.groups[repo] || "").trim();
            if (group && names.indexOf(group) < 0) names.push(group);
        });
        names.sort(); select.textContent = "";
        var all = document.createElement("option"); all.value = ""; all.textContent = "All groups"; select.appendChild(all);
        names.forEach(function (g) { var o = document.createElement("option"); o.value = g; o.textContent = g; select.appendChild(o); });
        select.value = names.indexOf(current) >= 0 ? current : "";
    }
    function apply() {
        if (!META) return;
        rebuildFilter(); var selected = (document.getElementById("repo-group-filter") || {}).value || "";
        document.querySelectorAll("#repos tr").forEach(function (row) {
            var nameCell = row.querySelector(".ghs-repo-name"), stateCell = row.children[2];
            if (!nameCell || !stateCell) return;
            var name = rowName(row), old = row.querySelector(".ghs-repo-meta"); if (old) old.remove();
            var group = (META.groups || {})[name] || "", tags = (META.tags || {})[name] || [], note = (META.notes || {})[name] || "";
            if (group || tags.length || note) {
                var meta = document.createElement("div"); meta.className = "ghs-helper ghs-repo-meta";
                meta.textContent = [group, tags.join(", "), note ? "note" : ""].filter(Boolean).join(" • "); stateCell.appendChild(meta);
            }
            if (m.setRowFilterHidden) m.setRowFilterHidden(row, "group", !!selected && group !== selected);
            else row.style.display = selected && group !== selected ? "none" : "";
        });
        if (m.refreshRepositoryView) m.refreshRepositoryView();
    }
    m.refreshGroups = apply; m.rebuildGroupFilter = rebuildFilter;

    function edit(name) {
        loadMeta().then(function () {
            var group = window.prompt("Group for " + name + " (blank clears):", META.groups[name] || ""); if (group === null) return;
            var tags = window.prompt("Comma-separated labels/tags for " + name + " (blank clears):", (META.tags[name] || []).join(", ")); if (tags === null) return;
            group = group.trim(); tags = uniq(tags.split(","));
            if (group && !/^[A-Za-z0-9._-]+$/.test(group)) throw new Error("Group names may contain letters, numbers, dot, underscore and dash only");
            if (group) { META.groups[name] = group; if (META.groupDefinitions.indexOf(group) < 0) META.groupDefinitions.push(group); }
            else delete META.groups[name];
            if (tags.length) META.tags[name] = tags; else delete META.tags[name];
            return saveMeta().then(apply);
        }).catch(function (e) { window.alert("Could not save group/labels: " + (e.message || String(e))); });
    }
    m.registerAction({ label: "Group / labels…", run: edit });
    if (document.getElementById("repos")) new MutationObserver(function () { setTimeout(apply, 0); }).observe(document.getElementById("repos"), { childList: true });
    loadMeta().then(function () { ensureFilter(); apply(); });

    window.GHSyncGroupMeta = {
        normalize: normalizeMeta,
        groupNames: function (meta) { return normalizeMeta(meta).groupDefinitions.slice(); },
        uniq: uniq
    };
})();