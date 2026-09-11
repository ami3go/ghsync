/* Feature 9: persistent repository groups and tags. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;
    var META = null, PATH = null;

    function defaultMeta() { return { groups: {}, tags: {}, favorites: {}, policies: {} }; }
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
    function loadMeta() {
        if (META) return Promise.resolve(META);
        return metaPath().then(function (path) { return cockpit.spawn(["cat", path], { err: "ignore" }); })
            .then(function (text) { try { META = JSON.parse(text); } catch (e) { META = defaultMeta(); } return META; })
            .catch(function () { META = defaultMeta(); return META; });
    }
    function saveMeta() {
        return metaPath().then(function (path) {
            var dir = path.slice(0, path.lastIndexOf("/"));
            return cockpit.spawn(["mkdir", "-p", dir], { err: "message" })
                .then(function () { return cockpit.file(path).replace(JSON.stringify(META, null, 2) + "\n"); });
        });
    }
    m.loadMeta = loadMeta; m.saveMeta = saveMeta; m.getMeta = function () { return META || defaultMeta(); };

    function ensureFilter() {
        var toolbar = document.querySelector("#panel-repos .ghs-toolbar"), search = document.getElementById("filter");
        if (!toolbar || !search || document.getElementById("repo-group-filter")) return;
        var select = document.createElement("select"); select.id = "repo-group-filter"; select.className = "ghs-input ghs-input--narrow"; select.setAttribute("aria-label", "Filter by group");
        toolbar.insertBefore(select, search.parentNode.nextSibling); select.onchange = apply;
    }
    function rebuildFilter() {
        ensureFilter(); var select = document.getElementById("repo-group-filter"); if (!select || !META) return;
        var current = select.value, groups = {};
        Object.keys(META.groups || {}).forEach(function (name) { if (META.groups[name]) groups[META.groups[name]] = true; });
        select.textContent = "";
        var all = document.createElement("option"); all.value = ""; all.textContent = "All groups"; select.appendChild(all);
        Object.keys(groups).sort().forEach(function (g) { var o = document.createElement("option"); o.value = g; o.textContent = g; select.appendChild(o); });
        select.value = Object.prototype.hasOwnProperty.call(groups, current) ? current : "";
    }
    function apply() {
        if (!META) return;
        rebuildFilter(); var selected = (document.getElementById("repo-group-filter") || {}).value || "";
        document.querySelectorAll("#repos tr").forEach(function (row) {
            var cell = row.querySelector(".ghs-repo-name"); if (!cell) return; var name = cell.childNodes[0] ? cell.childNodes[0].textContent.trim() : cell.textContent.trim();
            var old = cell.querySelector(".ghs-repo-meta"); if (old) old.remove();
            var group = (META.groups || {})[name] || "", tags = (META.tags || {})[name] || [];
            if (group || tags.length) { var meta = document.createElement("div"); meta.className = "ghs-helper ghs-repo-meta"; meta.textContent = [group, tags.join(", ")].filter(Boolean).join(" • "); cell.appendChild(meta); }
            row.style.display = selected && group !== selected ? "none" : "";
        });
    }
    function edit(name) {
        loadMeta().then(function () {
            var group = window.prompt("Group for " + name + " (blank clears):", META.groups[name] || ""); if (group === null) return;
            var tags = window.prompt("Comma-separated tags for " + name + " (blank clears):", (META.tags[name] || []).join(", ")); if (tags === null) return;
            group = group.trim(); tags = tags.split(",").map(function (t) { return t.trim(); }).filter(Boolean);
            if (group) META.groups[name] = group; else delete META.groups[name];
            if (tags.length) META.tags[name] = tags; else delete META.tags[name];
            return saveMeta().then(apply);
        }).catch(function (e) { window.alert("Could not save group/tags: " + (e.message || String(e))); });
    }
    m.registerAction({ label: "Group / tags…", run: edit });
    if (document.getElementById("repos")) new MutationObserver(function () { setTimeout(apply, 0); }).observe(document.getElementById("repos"), { childList: true });
    loadMeta().then(function () { ensureFilter(); apply(); });
})();
