/* GitHub Sync — third-party repositories and repository-manager host. */
(function () {
    "use strict";
    function $(id) { return document.getElementById(id); }

    var manager = window.GHSyncRepoManager = { actions: [] };
    var CORE = null, THIRD = null, ROOT = null, thirdRows = [], openMenu = null, openTrigger = null;

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
            ".ghs-action-menu__sep{height:1px;background:#d2d2d2;margin:.25rem 0}";
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
        var nameCell = row.querySelector("td.ghs-repo-name"), name = nameCell ? nameCell.textContent.trim() : "";
        cell.textContent = ""; cell.dataset.managerReady = "yes";
        var wrap = document.createElement("div"), trigger = document.createElement("button"), menu = document.createElement("div");
        wrap.className = "ghs-menu-wrap";
        trigger.type = "button"; trigger.className = "ghs-btn ghs-btn--secondary ghs-btn--sm ghs-kebab"; trigger.textContent = "⋮";
        trigger.setAttribute("aria-label", "Actions for " + name); trigger.setAttribute("aria-haspopup", "menu"); trigger.setAttribute("aria-expanded", "false");
        menu.className = "ghs-action-menu ghs-hidden"; menu.setAttribute("role", "menu");
        row._ghsyncBuiltins.forEach(function (a) { menu.appendChild(menuItem(a.label, a.run, a.state)); });
        if (manager.actions.length) {
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

    var tabs = document.querySelector(".ghs-tabs"), reposPanel = $("panel-repos"), thirdTab, thirdPanel;
    if (tabs && reposPanel) {
        thirdTab = $("tab-thirdparty") || document.createElement("button");
        if (!thirdTab.id) {
            thirdTab.id = "tab-thirdparty"; thirdTab.className = "ghs-tab"; thirdTab.type = "button"; thirdTab.dataset.tab = "thirdparty";
            thirdTab.setAttribute("role", "tab"); thirdTab.setAttribute("aria-selected", "false"); thirdTab.textContent = "3rd party repositories";
            tabs.insertBefore(thirdTab, tabs.querySelector('[data-tab="stats"]'));
        }
        thirdPanel = $("panel-thirdparty") || document.createElement("section");
        if (!thirdPanel.id) {
            thirdPanel.id = "panel-thirdparty"; thirdPanel.className = "ghs-tab-panel ghs-hidden"; thirdPanel.setAttribute("role", "tabpanel");
            thirdPanel.innerHTML = '<div class="ghs-form" style="margin-bottom:1rem"><div class="ghs-form-group"><label class="ghs-label" for="third-url">Public Git repository URL</label><div class="ghs-form-actions"><input id="third-url" class="ghs-input" type="text" placeholder="https://github.com/owner/repository.git" autocomplete="off"><button id="btn-third-add" class="ghs-btn ghs-btn--primary" type="button">Clone and track</button></div><p class="ghs-helper">GitHub, GitLab, Codeberg and other public Git URLs are supported. The final owner/repository pair determines the local path.</p></div></div><div class="ghs-toolbar"><span class="ghs-toolbar__count" id="third-count"></span><span class="ghs-toolbar__spacer"></span><button id="btn-third-refresh" class="ghs-btn ghs-btn--secondary ghs-btn--sm" type="button">Refresh</button></div><p id="third-message" class="ghs-helper"></p><div class="ghs-table-wrap ghs-hidden" id="third-wrap"><table class="ghs-table"><thead><tr><th>Repository</th><th>Source</th><th>State</th><th class="ghs-table__action">Actions</th></tr></thead><tbody id="third-body"></tbody></table></div><div id="third-empty" class="ghs-empty"><h3 class="ghs-empty__title">No third-party repositories</h3><p class="ghs-empty__body">Paste a public Git repository URL above to clone and track it.</p></div>';
            reposPanel.parentNode.insertBefore(thirdPanel, reposPanel.nextSibling);
        }
    }
    function thirdMessage(text, bad) { if ($("third-message")) { $("third-message").textContent = text || ""; $("third-message").className = "ghs-helper" + (bad ? " ghs-t-red" : ""); } resize(); }
    function renderThird() {
        var body = $("third-body"); if (!body) return; body.textContent = "";
        $("third-count").textContent = thirdRows.length + (thirdRows.length === 1 ? " repository" : " repositories");
        $("third-wrap").classList.toggle("ghs-hidden", !thirdRows.length); $("third-empty").classList.toggle("ghs-hidden", !!thirdRows.length);
        thirdRows.forEach(function (r) {
            var tr = document.createElement("tr"); tr.innerHTML = '<td class="ghs-repo-name"></td><td class="ghs-mono"></td><td></td><td class="ghs-table__action"></td>';
            tr.children[0].textContent = r.name; tr.children[1].textContent = r.url; tr.children[2].textContent = r.state === "cloned" ? "Cloned" : "Missing";
            var main = document.createElement("button"); main.className = "ghs-btn ghs-btn--secondary ghs-btn--sm"; main.textContent = r.state === "cloned" ? "Pull" : "Clone";
            main.onclick = function () { (r.state === "cloned" ? runCore(["pull", r.name]) : runThird(["add", r.url])).then(refreshThird).then(manager.refreshMainPage).catch(function (e) { thirdMessage(e.message || String(e), true); }); };
            var rm = document.createElement("button"); rm.className = "ghs-btn ghs-btn--secondary ghs-btn--danger-text ghs-btn--sm"; rm.style.marginLeft = ".375rem"; rm.textContent = "Untrack";
            rm.onclick = function () { if (window.confirm("Stop tracking " + r.name + "? The local clone will be kept.")) runThird(["remove", r.name]).then(refreshThird).then(manager.refreshMainPage); };
            tr.children[3].appendChild(main); tr.children[3].appendChild(rm); body.appendChild(tr);
        }); resize();
    }
    function refreshThird() {
        thirdMessage("Loading tracked repositories…");
        return runThird(["list"]).then(function (out) {
            thirdRows = []; out.split("\n").forEach(function (line) { var f = line.split("\t"); if (f[0] === "third-party") thirdRows.push({ name: f[1], url: f[2], state: f[3] || "missing" }); });
            thirdRows.sort(function (a, b) { return a.name.localeCompare(b.name); }); renderThird(); thirdMessage(thirdRows.length ? "Tracked clones are updated by normal Pull and Full sync." : "");
        }).catch(function (e) { thirdMessage("Could not load third-party repositories: " + (e.message || String(e)), true); });
    }
    function selectThird() {
        document.querySelectorAll(".ghs-tab").forEach(function (t) { var on = t === thirdTab; t.classList.toggle("ghs-tab--current", on); t.setAttribute("aria-selected", on ? "true" : "false"); });
        document.querySelectorAll(".ghs-tab-panel").forEach(function (p) { p.classList.add("ghs-hidden"); }); thirdPanel.classList.remove("ghs-hidden"); refreshThird(); resize();
    }
    if (thirdTab) thirdTab.onclick = selectThird;
    if ($("btn-third-refresh")) $("btn-third-refresh").onclick = refreshThird;
    if ($("btn-third-add")) $("btn-third-add").onclick = function () { var u = $("third-url").value.trim(); if (!u) return thirdMessage("Enter a public Git repository URL first.", true); runThird(["add", u]).then(function () { $("third-url").value = ""; }).then(refreshThird).then(manager.refreshMainPage).catch(function (e) { thirdMessage(e.message || String(e), true); }); };
    if ($("third-url")) $("third-url").onkeydown = function (e) { if (e.key === "Enter") $("btn-third-add").click(); };

    if ($("btn-orphans")) $("btn-orphans").onclick = function () {
        var b = $("btn-orphans"); b.disabled = true;
        Promise.all([runCore(["orphans"]), runThird(["list"])]).then(function (o) {
            var tracked = {}; o[1].split("\n").forEach(function (l) { var f = l.split("\t"); if (f[0] === "third-party") tracked[f[1]] = true; });
            var list = []; o[0].split("\n").forEach(function (l) { var f = l.split("\t"); if (f[0] === "orphan" && !tracked[f[1]]) list.push(f[1]); });
            window.alert(list.length ? "Orphaned clones (nothing removed):\n\n" + list.join("\n") : "No orphaned clones. Tracked third-party repositories are managed.");
        }).catch(function (e) { window.alert("Could not check orphans: " + (e.message || String(e))); }).finally(function () { b.disabled = false; });
    };

    if (thirdTab) new MutationObserver(function () { if (!thirdTab.classList.contains("ghs-tab--current")) thirdPanel.classList.add("ghs-hidden"); }).observe(thirdTab, { attributes: true });

    fetch("repo-features.json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("feature manifest"); return r.json(); }).then(function (files) {
        var chain = Promise.resolve(); files.forEach(function (src) { chain = chain.then(function () { return new Promise(function (ok, bad) { var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = bad; document.body.appendChild(s); }); }); }); return chain;
    }).catch(function (e) { console.error("Repository feature loading failed", e); });
    resize();
})();
