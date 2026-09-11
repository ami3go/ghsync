/* Feature 20: keep Pull visible and render secondary actions in a body-level context menu. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    var openOverlay = null;
    var openTrigger = null;

    if (!document.getElementById("ghs-context-menu-style")) {
        var style = document.createElement("style");
        style.id = "ghs-context-menu-style";
        style.textContent =
            ".ghs-table__action{white-space:nowrap!important}" +
            ".ghs-row-actions{display:inline-flex!important;align-items:center;justify-content:flex-end;gap:.375rem;flex-wrap:nowrap!important;white-space:nowrap!important;vertical-align:middle}" +
            ".ghs-row-actions>.ghs-btn{display:inline-flex!important;flex:0 0 auto!important}" +
            ".ghs-context-overlay{position:fixed!important;right:auto!important;bottom:auto!important;z-index:2147483000!important;min-width:13rem;max-width:min(22rem,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;background:#fff;border:1px solid #d2d2d2;border-radius:3px;box-shadow:0 4px 12px rgba(0,0,0,.28);padding:.25rem;text-align:left}" +
            ".ghs-context-overlay button{display:block;width:100%;border:0;background:transparent;text-align:left;padding:.45rem .65rem;cursor:pointer}" +
            ".ghs-context-overlay button:hover:not(:disabled),.ghs-context-overlay button:focus:not(:disabled){background:rgba(3,102,214,.08);outline:none}" +
            ".ghs-context-overlay button:disabled{opacity:.5;cursor:not-allowed}" +
            ".ghs-context-overlay .ghs-action-menu__sep{height:1px;background:#d2d2d2;margin:.25rem 0}";
        document.head.appendChild(style);
    }

    function closeOverlay() {
        if (openOverlay) openOverlay.remove();
        if (openTrigger) openTrigger.setAttribute("aria-expanded", "false");
        openOverlay = null;
        openTrigger = null;
    }

    function placeOverlay(menu, trigger, clientX, clientY) {
        var margin = 8;
        var rect = trigger ? trigger.getBoundingClientRect() : null;
        var width = menu.offsetWidth;
        var height = menu.offsetHeight;
        var pointer = typeof clientX === "number" && typeof clientY === "number";
        var left = pointer ? clientX : (rect ? rect.right - width : margin);
        var top = pointer ? clientY : (rect ? rect.bottom + 4 : margin);

        if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
        if (left < margin) left = margin;
        if (top + height > window.innerHeight - margin)
            top = pointer ? clientY - height : (rect ? rect.top - height - 4 : margin);
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
        button.onclick = function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (button.disabled) return;
            closeOverlay();
            run();
        };
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

        var first = menu.querySelector("button:not(:disabled)");
        if (first) first.focus({ preventScroll: true });
    }

    function applyRow(row) {
        var cell = row.querySelector("td.ghs-table__action");
        if (!cell || cell.dataset.contextOverlayReady === "yes") return;
        if (!row._ghsyncBuiltins || !row._ghsyncBuiltins.length) return;

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
            pull.onclick = function (event) {
                event.preventDefault();
                event.stopPropagation();
                closeOverlay();
                if (!pull.disabled) pullAction.run();
            };
            cluster.appendChild(pull);
        }

        var trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "ghs-btn ghs-btn--secondary ghs-btn--sm ghs-kebab";
        trigger.textContent = "⋮";
        trigger.setAttribute("aria-label", "Actions for " + name);
        trigger.setAttribute("aria-haspopup", "menu");
        trigger.setAttribute("aria-expanded", "false");
        trigger.onclick = function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (openTrigger === trigger) closeOverlay();
            else buildOverlay(row, trigger);
        };
        cluster.appendChild(trigger);

        /* Replace the manager's temporary nested menu with one explicit inline group. */
        cell.textContent = "";
        cell.appendChild(cluster);
        cell.dataset.contextOverlayReady = "yes";
        cell.dataset.managerReady = "yes";

        row.addEventListener("contextmenu", function (event) {
            if (event.target.closest("button,input,select,textarea,a")) return;
            event.preventDefault();
            event.stopPropagation();
            buildOverlay(row, trigger, event.clientX, event.clientY);
        });
    }

    function apply() {
        var body = document.getElementById("repos");
        if (!body) return;
        body.querySelectorAll("tr").forEach(applyRow);
    }

    var body = document.getElementById("repos");
    if (body) new MutationObserver(function () { window.requestAnimationFrame(apply); }).observe(body, { childList: true, subtree: true });
    document.addEventListener("click", closeOverlay);
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") closeOverlay(); });
    window.addEventListener("resize", closeOverlay);
    window.addEventListener("scroll", closeOverlay, true);
    apply();
})();
