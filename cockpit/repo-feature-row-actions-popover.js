/* Feature 20: keep Pull visible and render secondary actions beside each row. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    var openOverlay = null;
    var openTrigger = null;
    var openWrap = null;

    if (!document.getElementById("ghs-row-actions-popover-css")) {
        var link = document.createElement("link");
        link.id = "ghs-row-actions-popover-css";
        link.rel = "stylesheet";
        link.href = "repo-feature-row-actions-popover.css";
        document.head.appendChild(link);
        link.addEventListener("load", function () {
            if (openOverlay && openTrigger) orientOverlay(openOverlay, openTrigger);
        });
    }

    function closeOverlay() {
        if (openOverlay) openOverlay.remove();
        if (openTrigger && openTrigger.isConnected) openTrigger.setAttribute("aria-expanded", "false");
        if (openWrap) openWrap.classList.remove("ghs-table-wrap--menu-open");
        openOverlay = null;
        openTrigger = null;
        openWrap = null;
    }

    function orientOverlay(menu, trigger) {
        if (!menu || !trigger || !menu.isConnected || !trigger.isConnected) return;

        var margin = 8;
        menu.classList.remove("ghs-context-overlay--up", "ghs-context-overlay--align-left");

        var menuRect = menu.getBoundingClientRect();
        var triggerRect = trigger.getBoundingClientRect();

        if (menuRect.bottom > window.innerHeight - margin && triggerRect.top > menuRect.height + margin) {
            menu.classList.add("ghs-context-overlay--up");
            menuRect = menu.getBoundingClientRect();
        }

        if (menuRect.left < margin) menu.classList.add("ghs-context-overlay--align-left");
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

    function buildOverlay(row, trigger) {
        closeOverlay();
        if (!trigger || !trigger.isConnected) return;

        var cluster = trigger.closest(".ghs-row-actions");
        if (!cluster) return;

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

        cluster.appendChild(menu);
        openOverlay = menu;
        openTrigger = trigger;
        openWrap = trigger.closest(".ghs-table-wrap");
        if (openWrap) openWrap.classList.add("ghs-table-wrap--menu-open");
        trigger.setAttribute("aria-expanded", "true");
        orientOverlay(menu, trigger);
        if (typeof window.requestAnimationFrame === "function") {
            window.requestAnimationFrame(function () {
                if (openOverlay === menu) orientOverlay(menu, trigger);
            });
        }
    }

    function toggleOverlay(row, trigger) {
        if (openTrigger === trigger && openOverlay) closeOverlay();
        else buildOverlay(row, trigger);
    }

    function isConverted(cell) {
        if (!cell || cell.dataset.contextOverlayReady !== "v3") return false;
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

        trigger.addEventListener("pointerdown", function (event) {
            if (event.button !== undefined && event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            toggleOverlay(row, trigger);
        });
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
        cell.dataset.contextOverlayReady = "v3";
        cell.dataset.managerReady = "yes";
        row._ghsyncContextTrigger = trigger;

        if (!row._ghsyncContextMenuBoundV3) {
            row.addEventListener("contextmenu", function (event) {
                if (event.target.closest("button,input,select,textarea,a")) return;
                var activeTrigger = row._ghsyncContextTrigger;
                if (!activeTrigger || !activeTrigger.isConnected) return;
                event.preventDefault();
                event.stopPropagation();
                buildOverlay(row, activeTrigger);
            });
            row._ghsyncContextMenuBoundV3 = true;
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
