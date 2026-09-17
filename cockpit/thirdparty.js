/* GitHub Sync — repository-manager host and integrated third-party repositories. */
(function () {
    "use strict";
    function $(id) { return document.getElementById(id); }

    var manager = window.GHSyncRepoManager = { actions: [] };
    var CORE = null, THIRD = null, ROOT = null, thirdRows = [], openMenu = null, openTrigger = null;
    var thirdLoaded = false, thirdSyncScheduled = false;

    function resize() { try { cockpit.transport.control("size-change"); } catch (e) { /* standalone */ } }
    function installStyles() {
        if ($("ghs-manager-style")) return;
        var style = document.createElement("style");
        style.id = "ghs-manager-style";
        style.textContent =
            ".ghs-menu-wrap{position:relative;display:inline-block}" +
            ".ghs-kebab{min-width:2rem;padding:.25rem .55rem;font-size:1.15rem;line-height:1}" +
            ".ghs-action-menu{position:absolute;right:0;top:calc(100% + .25rem);z-index:50;min-width:13rem;padding:.25rem;background:#fff;border:1px solid #d2d2d2;border-radius:3px;box-shadow:0 4px 12px rgba(0,0,0,.18);text-align:left}" +
            ".ghs-action-menu button{display:block;width:100%;border:0;background:transparent;text-align:left;padding:.45rem .65rem;cursor:pointer}" +
            ".ghs-action-menu button:hover:not(:disabled){background:rgba(3,102,214,.08)}" +
            ".ghs-action-menu button:disabled{opacity:.5;cursor:not-allowed}" +
            ".ghs-action-menu__sep{height:1px;background:#d2d2d2;margin:.25rem 0}" +
            ".ghs-repo-source{white-space:nowrap}";
        document.head.appendChild(style);
    }
    function closeMenu() {
        if (openMenu) openMenu.classList.add("ghs-hidden");
        if (openTrigger) openTrigger.setAttribute("aria-expanded", "false");
        openMenu = openTrigger = null;
    }
    function menuItem(label, run, state) {
        state = state || {};
        var b = document.createElement("button");
        b.type = "button"; b.textContent = label; b.disabled = !!state.disabled;
        if (state.title) b.title = state.title;
        b.onclick = function (ev) { ev.stopPropagation(); if (!b.disabled) { closeMenu(); run(); } };
        return b;
    }
    function compactRow(row) {
        var cell = row.querySelector("td.ghs-table__action");
        if (!cell || cell.dataset.managerReady === "yes") return;
        if (!row._ghsyncBuiltins) {
            var old = Array.prototype.slice.call(cell.querySelectorAll("button"));
            if (!old.length) return;
            row._ghsyncBuiltins = old.map(function (b) {
                return { label: b.textContent.trim(), run: function () { b.click(); }, state: { disabled: b.disabled, title: b.title } };
            });
        }
        var nameCell = row.querySelector("td.ghs-repo-name");
        if (!row.dataset.repoName && nameCell) row.dataset.repoName = nameCell.textContent.trim();
        var name = row.dataset.repoName || "";
        cell.textContent = ""; cell.dataset.managerReady = "yes";
        var wrap = document.createElement("div"), trigger = document.createElement("button"), menu = document.createElement("div");
        wrap.className = "ghs-menu-wrap";
        trigger.type = "button"; trigger.className = "ghs-btn ghs-btn--secondary ghs-btn--sm ghs-kebab"; trigger.textContent = "⋮";
        trigger.setAttribute("aria-label", "Actions for " + name); trigger.setAttribute("aria-haspopup", "menu"); trigger.setAttribute("aria-expanded", "false");
        menu.className = "ghs-action-menu ghs-hidden"; menu.setAttribute("role", "menu");
        row._ghsyncBuiltins.forEach(function (a) { menu.appendChild(menuItem(a.label, a.run, a.state)); });
        if (manager.actions.length && row.dataset.thirdMissing !== "yes") {
            var sep = document.createElement("div"); sep.className = "ghs-action-menu__sep"; menu.appendChild(sep);
            manager.actions.forEach(function (a) { menu.appendChild(menuItem(a.label, function () { a.run(name, row); }, a.state ? a.state(name, row) : {})); });
        }
        trigger.onclick = function (ev) {
            ev.stopPropagation(); var opening = menu.classList.contains("ghs-hidden"); closeMenu();
            if (opening) { menu.classList.remove("ghs-hidden"); openMenu = menu; openTrigger = trigger; trigger.setAttribute("aria-expanded", "true"); }
        };
        wrap.appendChild(trigger); wrap.appendChild(menu); cell.appendChild(wrap);
    }
    function refreshMenus() { if ($("repos")) $("repos").querySelectorAll("tr").forEach(compactRow); }
    manager.registerAction = function (action) {
        manager.actions.push(action);
        if ($("repos")) $("repos").querySelectorAll("td.ghs-table__action").forEach(function (c) { c.removeAttribute("data-manager-ready"); });
        refreshMenus();
    };
    manager.refreshMenus = refreshMenus;

    function filterAttr(key) { return "data-ghs-filter-" + String(key || "filter").replace(/[^a-z0-9_-]/gi, "-").toLowerCase(); }
    function applyRowVisibility(row) {
        var hidden = Array.prototype.some.call(row.attributes || [], function (attr) {
            return attr.name.indexOf("data-ghs-filter-") === 0 && attr.value === "hidden";
        });
        row.style.display = hidden ? "none" : "";
    }
    manager.setRowFilterHidden = function (row, key, hidden) {
        if (!row) return;
        var attr = filterAttr(key);
        if (hidden) row.setAttribute(attr, "hidden"); else row.removeAttribute(attr);
        applyRowVisibility(row);
    };
    manager.applyRowVisibility = applyRowVisibility;

    installStyles(); document.addEventListener("click", closeMenu); document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });
    if ($("repos")) { new MutationObserver(refreshMenus).observe($("repos"), { childList: true, subtree: true }); refreshMenus(); }

    function findScripts() {
        if (CORE && THIRD) return Promise.resolve();
        var c = 'for p in "$HOME/.local/bin/ghsync" /usr/local/bin/ghsync /usr/bin/ghsync "$HOME/.local/share/cockpit/ghsync/ghsync" /usr/share/cockpit/ghsync/ghsync; do [ -f "$p" ] && { echo "$p"; exit 0; }; done; exit 1';
        var t = 'for p in "$HOME/.local/bin/ghsync-thirdparty" /usr/local/bin/ghsync-thirdparty /usr/bin/ghsync-thirdparty "$HOME/.local/share/cockpit/ghsync/ghsync-thirdparty" /usr/share/cockpit/ghsync/ghsync-thirdparty; do [ -f "$p" ] && { echo "$p"; exit 0; }; done; exit 1';
        return Promise.all([cockpit.spawn(["sh", "-c", c], { err: "message" }), cockpit.spawn(["sh", "-c", t], { err: "message" })])
            .then(function (p) { CORE = p[0].trim(); THIRD = p[1].trim(); });
    }
    function runCore(args) { return findScripts().then(function () { return cockpit.spawn(["bash", CORE].concat(args, ["--porcelain"]), { err: "message", superuser: null }); }); }
    function runThird(args) { return findScripts().then(function () { return cockpit.spawn(["bash", THIRD].concat(args, ["--porcelain"]), { err: "message", superuser: null }); }); }
    function repositoryRoot() {
        if (ROOT) return Promise.resolve(ROOT);
        return runCore(["check"]).then(function (out) {
            out.split("\n").some(function (line) { var f = line.split("\t"); if (f[0] === "check" && f[1] === "root") { ROOT = f[2] || ""; return true; } return false; });
            if (!ROOT) throw new Error("Could not determine repository root"); return ROOT;
        });
    }
    function repoDirectory(name) {
        if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name)) return Promise.reject(new Error("Invalid repository name"));
        return repositoryRoot().then(function (root) {
            var base = root.replace(/\/$/, "") + "/" + name;
            return cockpit.spawn(["test", "-e", base + "/.git"], { err: "ignore" }).then(function () { return base; })
                .catch(function () { return cockpit.spawn(["test", "-d", base + ".git"], { err: "ignore" }).then(function () { return base + ".git"; }); });
        });
    }
    function runGit(name, args) { return repoDirectory(name).then(function (dir) { return cockpit.spawn(["git", "-C", dir].concat(args), { err: "message", superuser: null }); }); }
    manager.runCore = runCore; manager.runThird = runThird; manager.repositoryRoot = repositoryRoot; manager.repoDirectory = repoDirectory; manager.runGit = runGit;
    manager.refreshMainPage = function () { var b = $("btn-refresh"); if (b && !b.disabled) b.click(); };

    function displayUrl(value) {
        value = (value || "").trim();
        if (!/^https?:\/\//i.test(value)) return value;
        try {
            var url = new URL(value); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString();
        } catch (e) { return value.replace(/^(https?:\/\/)[^/@]+@/i, "$1").replace(/[?#].*$/, ""); }
    }
    function thirdMessage(text, bad) {
        var el = $("third-inline-message");
        if (!el) return;
        el.textContent = text || "";
        el.className = "ghs-helper" + (bad ? " ghs-t-red" : "");
        resize();
    }
    function ensureIntegratedUi() {
        var panel = $("panel-repos"), toolbar = panel && panel.querySelector(".ghs-toolbar"), search = $("filter");
        if (!panel || !toolbar || !search) return;
        if (!$("repo-source-filter")) {
            var select = document.createElement("select");
            select.id = "repo-source-filter"; select.className = "ghs-input ghs-input--narrow"; select.setAttribute("aria-label", "Filter by repository source");
            [{ value: "", text: "All sources" }, { value: "managed", text: "Managed" }, { value: "third-party", text: "Third-party" }].forEach(function (item) {
                var option = document.createElement("option"); option.value = item.value; option.textContent = item.text; select.appendChild(option);
            });
            toolbar.insertBefore(select, search.parentNode.nextSibling);
            select.onchange = function () { applyIntegratedFilters(); };
        }
        if (!$("btn-third-add-inline")) {
            var add = document.createElement("button"); add.id = "btn-third-add-inline"; add.type = "button";
            add.className = "ghs-btn ghs-btn--secondary ghs-btn--sm"; add.textContent = "Add third-party";
            add.title = "Clone and track a public Git repository";
            toolbar.insertBefore(add, $("btn-orphans") || $("repo-count") || null);
            add.onclick = addThirdParty;
        }
        if (!$("third-inline-message")) {
            var message = document.createElement("p"); message.id = "third-inline-message"; message.className = "ghs-helper";
            toolbar.parentNode.insertBefore(message, toolbar.nextSibling);
        }
    }
    function thirdMap() {
        var map = Object.create(null);
        thirdRows.forEach(function (row) { map[row.name] = row; });
        return map;
    }
    function rowName(row) {
        if (row.dataset.repoName) return row.dataset.repoName;
        var cell = row.querySelector(".ghs-repo-name");
        if (!cell) return "";
        row.dataset.repoName = cell.textContent.trim();
        return row.dataset.repoName;
    }
    function sourceBadge(row, entry) {
        var state = row.children[2]; if (!state) return;
        var old = state.querySelector(".ghs-repo-source"); if (old) old.remove();
        if (!entry) return;
        var badge = document.createElement("div"); badge.className = "ghs-helper ghs-repo-source"; badge.textContent = "Third-party";
        badge.title = displayUrl(entry.url); state.appendChild(badge);
    }
    function cloneBuiltinSnapshot(row) {
        if (row._ghsyncBuiltins && row._ghsyncBuiltins.length) return;
        var cell = row.querySelector("td.ghs-table__action"); if (!cell) return;
        var buttons = Array.prototype.slice.call(cell.querySelectorAll("button"));
        if (!buttons.length) return;
        row._ghsyncBuiltins = buttons.map(function (button) {
            return { label: button.textContent.trim(), run: function () { button.click(); }, state: { disabled: button.disabled, title: button.title } };
        });
    }
    function untrack(name) {
        if (!window.confirm("Stop tracking " + name + " as a third-party repository? The local clone will be kept.")) return;
        thirdMessage("Untracking " + name + "…");
        runThird(["remove", name]).then(refreshThird).then(function () {
            manager.refreshMainPage(); thirdMessage("Stopped tracking " + name + ". The local clone was kept.");
        }).catch(function (e) { thirdMessage("Could not untrack " + name + ": " + (e.message || String(e)), true); });
    }
    function syncThirdPartyBuiltin(row, entry) {
        cloneBuiltinSnapshot(row);
        if (!row._ghsyncBuiltins) return false;
        var before = row._ghsyncBuiltins.length;
        row._ghsyncBuiltins = row._ghsyncBuiltins.filter(function (action) { return !action.thirdPartyUntrack; });
        if (entry && row.dataset.thirdMissing !== "yes") {
            row._ghsyncBuiltins.push({ label: "Untrack", run: function () { untrack(entry.name); }, state: {}, thirdPartyUntrack: true });
        }
        return before !== row._ghsyncBuiltins.length || !!entry;
    }
    function missingRow(entry) {
        var tr = document.createElement("tr");
        tr.dataset.repoName = entry.name; tr.dataset.repoSource = "third-party"; tr.dataset.thirdSynthetic = "yes"; tr.dataset.thirdMissing = "yes";
        var name = document.createElement("td"); name.className = "ghs-repo-name"; name.textContent = entry.name; tr.appendChild(name);
        var branch = document.createElement("td"); branch.textContent = "—"; tr.appendChild(branch);
        var state = document.createElement("td"); state.textContent = "Missing"; tr.appendChild(state); sourceBadge(tr, entry);
        for (var i = 0; i < 4; i += 1) { var n = document.createElement("td"); n.className = "ghs-num ghs-zero"; n.textContent = "0"; tr.appendChild(n); }
        var act = document.createElement("td"); act.className = "ghs-table__action"; tr.appendChild(act);
        tr._ghsyncBuiltins = [
            { label: "Clone", run: function () { cloneMissing(entry); }, state: {} },
            { label: "Untrack", run: function () { untrack(entry.name); }, state: {}, thirdPartyUntrack: true }
        ];
        return tr;
    }
    function cloneMissing(entry) {
        thirdMessage("Cloning " + entry.name + "…");
        runThird(["add", entry.url]).then(refreshThird).then(function () {
            manager.refreshMainPage(); thirdMessage("Cloned and tracked " + entry.name + ".");
        }).catch(function (e) { thirdMessage("Could not clone " + entry.name + ": " + (e.message || String(e)), true); });
    }
    function applyIntegratedFilters() {
        var source = ($("repo-source-filter") || {}).value || "", needle = ($("filter") || {}).value || "";
        needle = needle.trim().toLowerCase();
        document.querySelectorAll("#repos tr").forEach(function (row) {
            manager.setRowFilterHidden(row, "source", !!source && row.dataset.repoSource !== source);
            manager.setRowFilterHidden(row, "third-search", row.dataset.thirdSynthetic === "yes" && !!needle && rowName(row).toLowerCase().indexOf(needle) < 0);
        });
        refreshRepositoryView();
    }
    function refreshRepositoryView() {
        var body = $("repos"); if (!body) return;
        var rows = Array.prototype.slice.call(body.querySelectorAll("tr"));
        var visible = rows.filter(function (row) { return row.style.display !== "none"; });
        if ($("repo-count")) $("repo-count").textContent = visible.length + (visible.length === 1 ? " repository" : " repositories");
        var wrap = document.querySelector("#panel-repos .ghs-table-wrap"), empty = $("repos-empty"), emptyBody = $("repos-empty-body"), clone = $("btn-empty-clone");
        if (wrap) wrap.classList.toggle("ghs-hidden", visible.length === 0);
        if (empty) empty.classList.toggle("ghs-hidden", visible.length > 0);
        if (!visible.length && emptyBody) emptyBody.textContent = rows.length ? "No repository matches the current filters." : "Nothing has been cloned or tracked yet.";
        if (clone) clone.classList.toggle("ghs-hidden", rows.length > 0);
        resize();
    }
    manager.refreshRepositoryView = refreshRepositoryView;

    function integrateThirdPartyRows() {
        ensureIntegratedUi();
        var body = $("repos"); if (!body || !thirdLoaded) return;
        body.querySelectorAll('tr[data-third-synthetic="yes"]').forEach(function (row) { row.remove(); });
        var map = thirdMap(), present = Object.create(null), actionChanged = false;
        body.querySelectorAll("tr").forEach(function (row) {
            var name = rowName(row), entry = map[name] || null, source = entry ? "third-party" : "managed";
            present[name] = true;
            if (row.dataset.repoSource !== source) { row.dataset.repoSource = source; actionChanged = true; }
            sourceBadge(row, entry);
            if (syncThirdPartyBuiltin(row, entry)) actionChanged = actionChanged || !!entry;
        });
        thirdRows.forEach(function (entry) { if (!present[entry.name]) body.appendChild(missingRow(entry)); });
        applyIntegratedFilters();
        if (manager.refreshGroups) manager.refreshGroups();
        if (actionChanged) {
            body.querySelectorAll("td.ghs-table__action").forEach(function (cell) {
                cell.removeAttribute("data-manager-ready"); cell.removeAttribute("data-context-overlay-ready");
            });
        }
        refreshMenus();
    }
    function scheduleThirdIntegration() {
        if (thirdSyncScheduled) return;
        thirdSyncScheduled = true;
        window.setTimeout(function () { thirdSyncScheduled = false; integrateThirdPartyRows(); }, 0);
    }
    function refreshThird() {
        return runThird(["list"]).then(function (out) {
            thirdRows = [];
            out.split("\n").forEach(function (line) {
                var f = line.split("\t");
                if (f[0] === "third-party" && f[1]) thirdRows.push({ name: f[1], url: f[2] || "", state: f[3] || "missing" });
            });
            thirdRows.sort(function (a, b) { return a.name.localeCompare(b.name); });
            thirdLoaded = true; manager.thirdPartyRows = thirdRows.slice(); scheduleThirdIntegration(); return thirdRows;
        }).catch(function (e) {
            thirdLoaded = true; thirdRows = []; manager.thirdPartyRows = []; scheduleThirdIntegration();
            thirdMessage("Could not load third-party repositories: " + (e.message || String(e)), true);
            return [];
        });
    }
    function addThirdParty() {
        var value = window.prompt("Public Git repository URL to clone and track:", "https://github.com/");
        if (value === null) return;
        value = value.trim(); if (!value) return thirdMessage("Enter a public Git repository URL.", true);
        var button = $("btn-third-add-inline"); if (button) button.disabled = true;
        thirdMessage("Adding third-party repository…");
        runThird(["add", value]).then(refreshThird).then(function () {
            manager.refreshMainPage(); thirdMessage("Third-party repository added.");
        }).catch(function (e) { thirdMessage("Could not add repository: " + (e.message || String(e)), true); })
            .finally(function () { if (button) button.disabled = false; });
    }
    manager.refreshThirdParty = refreshThird;
    manager.isThirdParty = function (name) { return thirdRows.some(function (row) { return row.name === name; }); };

    ensureIntegratedUi();
    if ($("filter")) $("filter").addEventListener("input", scheduleThirdIntegration);
    if ($("repos")) {
        new MutationObserver(function (records) {
            var relevant = records.some(function (record) {
                return Array.prototype.slice.call(record.addedNodes).concat(Array.prototype.slice.call(record.removedNodes)).some(function (node) {
                    return node && node.nodeType === 1 && (!node.dataset || node.dataset.thirdSynthetic !== "yes");
                });
            });
            if (relevant) scheduleThirdIntegration();
        }).observe($("repos"), { childList: true });
    }
    refreshThird();

    fetch("repo-features.json", { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("feature manifest");
        return r.json();
    }).then(function (files) {
        var chain = Promise.resolve();
        files.forEach(function (src) {
            chain = chain.then(function () {
                return new Promise(function (ok, bad) {
                    var s = document.createElement("script");
                    s.src = src;
                    s.onload = ok;
                    s.onerror = bad;
                    document.body.appendChild(s);
                });
            });
        });
        return chain;
    }).catch(function (e) { console.error("Repository feature loading failed", e); });
    resize();
})();