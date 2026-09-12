/* Feature 20: keep Pull visible and render secondary actions in a body-level context menu. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    var openOverlay = null;
    var openTrigger = null;

    if (!document.getElementById("ghs-context-menu-style-v2")) {
        var style = document.createElement("style");
        style.id = "ghs-context-menu-style-v2";
        style.textContent =
            ".ghs-table__action{white-space:nowrap!important}" +
            ".ghs-row-actions{display:inline-flex!important;align-items:center;justify-content:flex-end;gap:.375rem;flex-wrap:nowrap!important;white-space:nowrap!important;vertical-align:middle}" +
            ".ghs-row-actions>.ghs-btn{display:inline-flex!important;flex:0 0 auto!important}" +
            ".ghs-context-overlay{position:fixed!important;right:auto!important;bottom:auto!important;z-index:2147483000!important;min-width:13rem;max-width:min(22rem,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;background:var(--ghs-surface,#fff);color:var(--ghs-text,#151515);border:1px solid var(--ghs-border,#d2d2d2);border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,.28);padding:.25rem;text-align:left}" +
            ".ghs-context-overlay button{display:block;width:100%;border:0;background:transparent;color:inherit;text-align:left;padding:.45rem .65rem;cursor:pointer;font:inherit}" +
            ".ghs-context-overlay button:hover:not(:disabled),.ghs-context-overlay button:focus-visible:not(:disabled){background:var(--ghs-surface-alt,#f5f5f5);outline:none}" +
            ".ghs-context-overlay button:disabled{opacity:.5;cursor:not-allowed}" +
            ".ghs-context-overlay .ghs-action-menu__sep{height:1px;background:var(--ghs-border,#d2d2d2);margin:.25rem 0}";
        document.head.appendChild(style);
    }

    function closeOverlay() {
        if (openOverlay) openOverlay.remove();
        if (openTrigger && openTrigger.isConnected) openTrigger.setAttribute("aria-expanded", "false");
        openOverlay = null;
        openTrigger = null;
    }

    function placeOverlay(menu, trigger, clientX, clientY) {
        var margin = 8;
        var rect = trigger.getBoundingClientRect();
        var width = menu.offsetWidth || 208;
        var height = menu.offsetHeight || 40;
        var pointer = typeof clientX === "number" && typeof clientY === "number";
        var left = pointer ? clientX : rect.right - width;
        var top = pointer ? clientY : rect.bottom + 4;

        if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
        if (left < margin) left = margin;
        if (top + height > window.innerHeight - margin)
            top = pointer ? clientY - height : rect.top - height - 4;
        if (top < margin) top = margin;

        menu.style.left = Math.round(left) + "px";
        menu.style.top = Math.round(top) + "px";
    }

    function rowName(row) {
        if (m.rowName) return m.rowName(row);
        if (row.dataset.repoName) return row.dataset.repoName;
        var cell = row.querySelector(".ghs-repo-name");
        return cell ? cell.textContent.trim() : "";
    }

    function builtinActions(row) {
        return (row._ghsyncBuiltins || []).slice();
    }

    function findBuiltin(row, label) {
        var actions = builtinActions(row);
        for (var i = 0; i < actions.length; i += 1) {
            if (actions[i].label === label) return actions[i];
        }
        return null;
    }

    function addMenuButton(menu, label, run, state) {
        state = state || {};
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.disabled = !!state.disabled;
        if (state.title) button.title = state.title;
        button.setAttribute("role", "menuitem");
        button.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (button.disabled) return;
            closeOverlay();
            run();
        });
        menu.appendChild(button);
    }

    function addSeparator(menu) {
        if (!menu.children.length) return;
        var sep = document.createElement("div");
        sep.className = "ghs-action-menu__sep";
        sep.setAttribute("role", "separator");
        menu.appendChild(sep);
    }

    function buildOverlay(row, trigger, clientX, clientY) {
        closeOverlay();
        if (!trigger || !trigger.isConnected) return;

        var name = rowName(row);
        var menu = document.createElement("div");
        menu.className = "ghs-context-overlay";
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", "Actions for " + name);

        builtinActions(row).forEach(function (action) {
            if (action.label === "Pull") return;
            addMenuButton(menu, action.label, action.run, action.state);
        });

        if (m.actions && m.actions.length) {
            addSeparator(menu);
            m.actions.forEach(function (action) {
                var state = action.state ? action.state(name, row) : {};
                addMenuButton(menu, action.label, function () { action.run(name, row); }, state);
            });
        }

        while (menu.lastElementChild && menu.lastElementChild.classList.contains("ghs-action-menu__sep"))
            menu.lastElementChild.remove();
        if (!menu.children.length) return;

        document.body.appendChild(menu);
        openOverlay = menu;
        openTrigger = trigger;
        trigger.setAttribute("aria-expanded", "true");
        placeOverlay(menu, trigger, clientX, clientY);
    }

    function toggleOverlay(row, trigger) {
        if (openTrigger === trigger && openOverlay) closeOverlay();
        else buildOverlay(row, trigger);
    }

    function isConverted(cell) {
        if (!cell || cell.dataset.contextOverlayReady !== "v2") return false;
        var cluster = cell.querySelector(".ghs-row-actions");
        return !!(cluster && cluster.querySelector(".ghs-kebab"));
    }

    function applyRow(row) {
        var cell = row.querySelector("td.ghs-table__action");
        if (!cell || isConverted(cell)) return;
        if (!row._ghsyncBuiltins || !row._ghsyncBuiltins.length) return;

        if (openTrigger && cell.contains(openTrigger)) closeOverlay();

        var name = rowName(row);
        var pullAction = findBuiltin(row, "Pull");
        var cluster = document.createElement("div");
        cluster.className = "ghs-row-actions";

        if (pullAction) {
            var pull = document.createElement("button");
            pull.type = "button";
            pull.className = "ghs-btn ghs-btn--secondary ghs-btn--sm ghs-primary-pull";
            pull.textContent = "Pull";
            pull.disabled = !!(pullAction.state && pullAction.state.disabled);
            if (pullAction.state && pullAction.state.title) pull.title = pullAction.state.title;
            pull.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                closeOverlay();
                if (!pull.disabled) pullAction.run();
            });
            cluster.appendChild(pull);
        }

        var trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "ghs-btn ghs-btn--secondary ghs-btn--sm ghs-kebab";
        trigger.textContent = "⋮";
        trigger.setAttribute("aria-label", "Actions for " + name);
        trigger.setAttribute("aria-haspopup", "menu");
        trigger.setAttribute("aria-expanded", "false");

        /* Pointer-down opens the menu before any synthetic click/outside-click logic can race it. */
        trigger.addEventListener("pointerdown", function (event) {
            if (event.button !== undefined && event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            toggleOverlay(row, trigger);
        });
        /* Keep click as a fallback for browsers/environments without Pointer Events. */
        trigger.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof window.PointerEvent === "function") return;
            toggleOverlay(row, trigger);
        });
        trigger.addEventListener("keydown", function (event) {
            if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown") return;
            event.preventDefault();
            event.stopPropagation();
            if (!openOverlay || openTrigger !== trigger) buildOverlay(row, trigger);
            var first = openOverlay && openOverlay.querySelector("button:not(:disabled)");
            if (first) first.focus();
        });
        cluster.appendChild(trigger);

        cell.textContent = "";
        cell.appendChild(cluster);
        cell.dataset.contextOverlayReady = "v2";
        cell.dataset.managerReady = "yes";
        row._ghsyncContextTrigger = trigger;

        if (!row._ghsyncContextMenuBoundV2) {
            row.addEventListener("contextmenu", function (event) {
                if (event.target.closest("button,input,select,textarea,a")) return;
                var activeTrigger = row._ghsyncContextTrigger;
                if (!activeTrigger || !activeTrigger.isConnected) return;
                event.preventDefault();
                event.stopPropagation();
                buildOverlay(row, activeTrigger, event.clientX, event.clientY);
            });
            row._ghsyncContextMenuBoundV2 = true;
        }
    }

    function apply() {
        var body = document.getElementById("repos");
        if (!body) return;
        body.querySelectorAll("tr").forEach(applyRow);
    }

    function scheduleApply() {
        window.setTimeout(apply, 0);
    }

    var body = document.getElementById("repos");
    if (body) new MutationObserver(scheduleApply).observe(body, { childList: true, subtree: true });

    /* Close only for a real interaction outside both trigger and menu. Scrolling no longer destroys the menu. */
    document.addEventListener("pointerdown", function (event) {
        if (!openOverlay) return;
        if (openOverlay.contains(event.target)) return;
        if (openTrigger && openTrigger.contains(event.target)) return;
        closeOverlay();
    }, true);
    document.addEventListener("mousedown", function (event) {
        if (typeof window.PointerEvent === "function" || !openOverlay) return;
        if (openOverlay.contains(event.target)) return;
        if (openTrigger && openTrigger.contains(event.target)) return;
        closeOverlay();
    }, true);
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") closeOverlay(); });
    window.addEventListener("resize", closeOverlay);
    apply();
})();
