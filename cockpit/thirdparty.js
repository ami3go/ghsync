/* GitHub Sync — third-party and repository-manager extensions. */
(function () {
    "use strict";

    function $(id) { return document.getElementById(id); }

    /* ------------------------------------------------ repository action menu */

    var repoActions = [];
    var openMenu = null;
    var openTrigger = null;

    function installManagerStyles() {
        if ($("ghs-manager-style")) return;
        var style = document.createElement("style");
        style.id = "ghs-manager-style";
        style.textContent =
            ".ghs-menu-wrap{position:relative;display:inline-block}" +
            ".ghs-kebab{min-width:2rem;padding:.25rem .55rem;font-size:1.15rem;line-height:1}" +
            ".ghs-action-menu{position:absolute;right:0;top:calc(100% + .25rem);z-index:50;min-width:12rem;padding:.25rem;" +
                "background:var(--pf-v5-global--BackgroundColor--100,#fff);border:1px solid var(--pf-v5-global--BorderColor--100,#d2d2d2);" +
                "border-radius:3px;box-shadow:0 4px 12px rgba(0,0,0,.18);text-align:left}" +
            ".ghs-action-menu button{display:block;width:100%;border:0;background:transparent;text-align:left;padding:.45rem .65rem;cursor:pointer}" +
            ".ghs-action-menu button:hover:not(:disabled){background:rgba(3,102,214,.08)}" +
            ".ghs-action-menu button:disabled{opacity:.5;cursor:not-allowed}" +
            ".ghs-action-menu__sep{height:1px;background:#d2d2d2;margin:.25rem 0}";
        document.head.appendChild(style);
    }

    function closeActionMenu() {
        if (openMenu) openMenu.classList.add("ghs-hidden");
        if (openTrigger) openTrigger.setAttribute("aria-expanded", "false");
        openMenu = null;
        openTrigger = null;
    }

    function menuButton(label, handler, disabled, title) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.disabled = !!disabled;
        if (title) button.title = title;
        button.onclick = function (event) {
            event.stopPropagation();
            if (button.disabled) return;
            closeActionMenu();
            handler();
        };
        return button;
    }

    function compactRepositoryRow(row) {
        var actionCell = row.querySelector("td.ghs-table__action");
        if (!actionCell || actionCell.dataset.managerReady === "yes") return;
        var builtins = row._ghsyncBuiltins;
        if (!builtins) {
            var original = Array.prototype.slice.call(actionCell.querySelectorAll("button"));
            if (!original.length) return;
            builtins = original.map(function (button) {
                return {
                    label: button.textContent.trim(),
                    disabled: button.disabled,
                    title: button.title,
                    run: function () { button.click(); }
                };
            });
            row._ghsyncBuiltins = builtins;
        }

        var nameCell = row.querySelector("td.ghs-repo-name");
        var repoName = nameCell ? nameCell.textContent.trim() : "";

        actionCell.textContent = "";
        actionCell.dataset.managerReady = "yes";

        var wrap = document.createElement("div");
        wrap.className = "ghs-menu-wrap";
        var trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "ghs-btn ghs-btn--secondary ghs-btn--sm ghs-kebab";
        trigger.textContent = "⋮";
        trigger.setAttribute("aria-label", "Actions for " + repoName);
        trigger.setAttribute("aria-haspopup", "menu");
        trigger.setAttribute("aria-expanded", "false");

        var menu = document.createElement("div");
        menu.className = "ghs-action-menu ghs-hidden";
        menu.setAttribute("role", "menu");

        builtins.forEach(function (action) {
            menu.appendChild(menuButton(action.label, action.run, action.disabled, action.title));
        });

        if (repoActions.length) {
            var sep = document.createElement("div");
            sep.className = "ghs-action-menu__sep";
            menu.appendChild(sep);
            repoActions.forEach(function (action) {
                var state = action.state ? action.state(repoName, row) : {};
                menu.appendChild(menuButton(action.label, function () { action.run(repoName, row); },
                    state && state.disabled, state && state.title));
            });
        }

        trigger.onclick = function (event) {
            event.stopPropagation();
            var opening = menu.classList.contains("ghs-hidden");
            closeActionMenu();
            if (opening) {
                menu.classList.remove("ghs-hidden");
                openMenu = menu;
                openTrigger = trigger;
                trigger.setAttribute("aria-expanded", "true");
            }
        };
        wrap.appendChild(trigger);
        wrap.appendChild(menu);
        actionCell.appendChild(wrap);
    }

    function compactRepositoryActions() {
        var body = $("repos");
        if (!body) return;
        body.querySelectorAll("tr").forEach(compactRepositoryRow);
    }

    window.GHSyncRepoManager = {
        registerAction: function (action) {
            repoActions.push(action);
            var body = $("repos");
            if (body) {
                body.querySelectorAll("tr").forEach(function (row) {
                    var cell = row.querySelector("td.ghs-table__action");
                    if (cell) cell.removeAttribute("data-manager-ready");
                });
            }
            compactRepositoryActions();
        },
        refreshMenus: compactRepositoryActions
    };

    installManagerStyles();
    document.addEventListener("click", closeActionMenu);
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") closeActionMenu();
    });
    if ($("repos")) {
        new MutationObserver(compactRepositoryActions).observe($("repos"), { childList: true, subtree: true });
        compactRepositoryActions();
    }

    /* --------------------------------------------- third-party repositories */

    var tabs = document.querySelector(".ghs-tabs");
    var reposPanel = $("panel-repos");
    if (!tabs || !reposPanel) return;

    var tab = $("tab-thirdparty");
    if (!tab) {
        tab = document.createElement("button");
        tab.id = "tab-thirdparty";
        tab.className = "ghs-tab";
        tab.type = "button";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", "false");
        tab.dataset.tab = "thirdparty";
        tab.textContent = "3rd party repositories";
        var statsTab = tabs.querySelector('[data-tab="stats"]');
        tabs.insertBefore(tab, statsTab || null);
    }

    var panel = $("panel-thirdparty");
    if (!panel) {
        panel = document.createElement("section");
        panel.id = "panel-thirdparty";
        panel.className = "ghs-tab-panel ghs-hidden";
        panel.setAttribute("role", "tabpanel");
        panel.innerHTML =
            '<div class="ghs-form" style="margin-bottom:1rem">' +
                '<div class="ghs-form-group">' +
                    '<label class="ghs-label" for="third-url">Public Git repository URL</label>' +
                    '<div class="ghs-form-actions">' +
                        '<input id="third-url" class="ghs-input" type="text" placeholder="https://github.com/owner/repository.git" autocomplete="off">' +
                        '<button id="btn-third-add" class="ghs-btn ghs-btn--primary" type="button">Clone and track</button>' +
                    '</div>' +
                    '<p class="ghs-helper">GitHub, GitLab, Codeberg and other public Git URLs are supported. The final owner/repository pair determines the local path.</p>' +
                '</div>' +
            '</div>' +
            '<div class="ghs-toolbar">' +
                '<span class="ghs-toolbar__count" id="third-count"></span>' +
                '<span class="ghs-toolbar__spacer"></span>' +
                '<button id="btn-third-refresh" class="ghs-btn ghs-btn--secondary ghs-btn--sm" type="button">Refresh</button>' +
            '</div>' +
            '<p id="third-message" class="ghs-helper"></p>' +
            '<div class="ghs-table-wrap ghs-hidden" id="third-wrap">' +
                '<table class="ghs-table">' +
                    '<thead><tr><th scope="col">Repository</th><th scope="col">Source</th><th scope="col">State</th><th scope="col" class="ghs-table__action"><span class="ghs-sr">Actions</span></th></tr></thead>' +
                    '<tbody id="third-body"></tbody>' +
                '</table>' +
            '</div>' +
            '<div id="third-empty" class="ghs-empty">' +
                '<svg class="ghs-empty__icon" aria-hidden="true"><use href="#i-repo"/></svg>' +
                '<h3 class="ghs-empty__title">No third-party repositories</h3>' +
                '<p class="ghs-empty__body">Paste a public Git repository URL above to clone and track it.</p>' +
            '</div>';
        reposPanel.parentNode.insertBefore(panel, reposPanel.nextSibling);
    }

    var CORE = null;
    var THIRD = null;
    var rows = [];

    function resize() {
        try { cockpit.transport.control("size-change"); } catch (e) { /* not embedded */ }
    }

    function setBusy(on) {
        ["btn-third-add", "btn-third-refresh"].forEach(function (id) {
            if ($(id)) $(id).disabled = on;
        });
        panel.querySelectorAll("tbody button").forEach(function (button) {
            button.disabled = on;
        });
    }

    function setMessage(text, error) {
        var el = $("third-message");
        el.textContent = text || "";
        el.className = "ghs-helper" + (error ? " ghs-t-red" : "");
        resize();
    }

    function findScripts() {
        if (CORE && THIRD) return Promise.resolve();
        var coreProbe =
            'for p in "$HOME/.local/bin/ghsync" /usr/local/bin/ghsync /usr/bin/ghsync ' +
            '"$HOME/.local/share/cockpit/ghsync/ghsync" /usr/share/cockpit/ghsync/ghsync; do ' +
            'if [ -f "$p" ]; then echo "$p"; exit 0; fi; done; exit 1';
        var thirdProbe =
            'for p in "$HOME/.local/bin/ghsync-thirdparty" /usr/local/bin/ghsync-thirdparty /usr/bin/ghsync-thirdparty ' +
            '"$HOME/.local/share/cockpit/ghsync/ghsync-thirdparty" /usr/share/cockpit/ghsync/ghsync-thirdparty; do ' +
            'if [ -f "$p" ]; then echo "$p"; exit 0; fi; done; exit 1';
        return Promise.all([
            cockpit.spawn(["sh", "-c", coreProbe], { err: "message" }),
            cockpit.spawn(["sh", "-c", thirdProbe], { err: "message" })
        ]).then(function (paths) {
            CORE = paths[0].trim();
            THIRD = paths[1].trim();
        });
    }

    function runCore(args) {
        return findScripts().then(function () {
            return cockpit.spawn(["bash", CORE].concat(args).concat(["--porcelain"]),
                                 { err: "message", superuser: null });
        });
    }

    function runThird(args) {
        return findScripts().then(function () {
            return cockpit.spawn(["bash", THIRD].concat(args).concat(["--porcelain"]),
                                 { err: "message", superuser: null });
        });
    }

    function badge(state) {
        var span = document.createElement("span");
        span.className = "ghs-label-tag " + (state === "cloned" ? "ghs-label-tag--green" : "ghs-label-tag--gold");
        span.textContent = state === "cloned" ? "Cloned" : "Missing";
        return span;
    }

    function actionButton(text, className, handler) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = text;
        button.onclick = handler;
        return button;
    }

    function render() {
        var body = $("third-body");
        body.textContent = "";
        $("third-count").textContent = rows.length + (rows.length === 1 ? " repository" : " repositories");
        $("third-wrap").classList.toggle("ghs-hidden", rows.length === 0);
        $("third-empty").classList.toggle("ghs-hidden", rows.length !== 0);

        rows.forEach(function (row) {
            var tr = document.createElement("tr");

            var name = document.createElement("td");
            name.className = "ghs-repo-name";
            name.textContent = row.name;
            tr.appendChild(name);

            var source = document.createElement("td");
            source.className = "ghs-mono";
            source.textContent = row.url;
            tr.appendChild(source);

            var state = document.createElement("td");
            state.appendChild(badge(row.state));
            tr.appendChild(state);

            var actions = document.createElement("td");
            actions.className = "ghs-table__action";
            var primary = actionButton(row.state === "cloned" ? "Pull" : "Clone",
                "ghs-btn ghs-btn--secondary ghs-btn--sm", function () {
                    if (row.state === "cloned") executeCore(["pull", row.name], "Updated " + row.name);
                    else executeThird(["add", row.url], "Cloned " + row.name);
                });
            actions.appendChild(primary);

            var remove = actionButton("Untrack",
                "ghs-btn ghs-btn--secondary ghs-btn--danger-text ghs-btn--sm", function () {
                    if (!window.confirm("Stop tracking " + row.name + "? The local clone will be kept.")) return;
                    executeThird(["remove", row.name], "Stopped tracking " + row.name);
                });
            remove.style.marginLeft = "0.375rem";
            actions.appendChild(remove);
            tr.appendChild(actions);
            body.appendChild(tr);
        });
        resize();
    }

    function refresh() {
        setBusy(true);
        setMessage("Loading tracked repositories…", false);
        return runThird(["list"])
            .then(function (out) {
                rows = [];
                out.split("\n").forEach(function (line) {
                    if (!line.trim()) return;
                    var f = line.split("\t");
                    if (f[0] === "third-party")
                        rows.push({ name: f[1], url: f[2], state: f[3] || "missing" });
                });
                rows.sort(function (a, b) { return a.name.localeCompare(b.name); });
                render();
                setMessage(rows.length ? "Tracked clones are updated by the normal Pull and Full sync actions." : "", false);
            })
            .catch(function (ex) {
                rows = [];
                render();
                setMessage("Could not load third-party repositories: " + (ex.message || String(ex)), true);
            })
            .finally(function () { setBusy(false); });
    }

    function refreshMainPage() {
        var button = $("btn-refresh");
        if (button && !button.disabled) button.click();
    }

    function finishOperation(promise, success, clearUrl) {
        setBusy(true);
        setMessage("Working…", false);
        return promise
            .then(function () {
                setMessage(success, false);
                if (clearUrl) $("third-url").value = "";
                return refresh();
            })
            .then(refreshMainPage)
            .catch(function (ex) {
                setMessage(ex.message || String(ex), true);
            })
            .finally(function () { setBusy(false); });
    }

    function executeThird(args, success) {
        return finishOperation(runThird(args), success, args[0] === "add");
    }

    function executeCore(args, success) {
        return finishOperation(runCore(args), success, false);
    }

    function findManagedOrphans() {
        var button = $("btn-orphans");
        if (button) button.disabled = true;
        return Promise.all([runCore(["orphans"]), runThird(["list"])])
            .then(function (outputs) {
                var tracked = {};
                outputs[1].split("\n").forEach(function (line) {
                    var f = line.split("\t");
                    if (f[0] === "third-party" && f[1]) tracked[f[1]] = true;
                });
                var orphans = [];
                outputs[0].split("\n").forEach(function (line) {
                    var f = line.split("\t");
                    if (f[0] === "orphan" && f[1] && !tracked[f[1]]) orphans.push(f[1]);
                });
                if (!orphans.length) {
                    window.alert("No orphaned clones. Tracked third-party repositories are treated as managed.");
                } else {
                    window.alert("Orphaned clones (nothing was removed):\n\n" + orphans.join("\n"));
                }
            })
            .catch(function (ex) {
                window.alert("Could not check orphaned clones: " + (ex.message || String(ex)));
            })
            .finally(function () { if (button) button.disabled = false; });
    }

    function selectThirdParty() {
        document.querySelectorAll(".ghs-tab").forEach(function (item) {
            var on = item === tab;
            item.classList.toggle("ghs-tab--current", on);
            item.setAttribute("aria-selected", on ? "true" : "false");
        });
        document.querySelectorAll(".ghs-tab-panel").forEach(function (item) {
            item.classList.add("ghs-hidden");
        });
        panel.classList.remove("ghs-hidden");
        refresh();
        resize();
    }

    if ($("btn-orphans")) $("btn-orphans").onclick = findManagedOrphans;
    tab.onclick = selectThirdParty;
    $("btn-third-refresh").onclick = refresh;
    $("btn-third-add").onclick = function () {
        var url = $("third-url").value.trim();
        if (!url) {
            setMessage("Enter a public Git repository URL first.", true);
            return;
        }
        executeThird(["add", url], "Repository cloned and tracked.");
    };
    $("third-url").onkeydown = function (event) {
        if (event.key === "Enter") $("btn-third-add").click();
    };

    /* ghsync.js owns the normal tabs and can switch to Activity from an action.
       Hide this injected panel whenever another tab becomes current. */
    var observer = new MutationObserver(function () {
        if (!tab.classList.contains("ghs-tab--current")) panel.classList.add("ghs-hidden");
    });
    document.querySelectorAll(".ghs-tab").forEach(function (item) {
        observer.observe(item, { attributes: true, attributeFilter: ["class", "aria-selected"] });
    });
    resize();
})();
