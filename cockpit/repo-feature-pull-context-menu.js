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
            ".ghs-row-actions{display:inline-flex;align-items:center;justify-content:flex-end;gap:.375rem;flex-wrap:nowrap;white-space:nowrap}" +
            ".ghs-row-actions>.ghs-btn,.ghs-row-actions>.ghs-menu-wrap{flex:0 0 auto}" +
            ".ghs-context-overlay{position:fixed!important;right:auto!important;top:auto!important;z-index:2147483000!important;min-width:13rem;max-height:calc(100vh - 16px);overflow:auto}";
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
        if (top + height > window.innerHeight - margin) {
            top = pointer ? clientY - height : (rect ? rect.top - height - 4 : margin);
        }
        if (top < margin) top = margin;

        menu.style.left = Math.round(left) + "px";
        menu.style.top = Math.round(top) + "px";
    }

    function sourceButton(menu, label) {
        var buttons = menu ? menu.querySelectorAll("button") : [];
        for (var i = 0; i < buttons.length; i += 1) {
            if (buttons[i].textContent.trim() === label) return buttons[i];
        }
        return null;
    }

    function buildOverlay(sourceMenu, trigger, clientX, clientY) {
        closeOverlay();
        if (!sourceMenu) return;

        var overlay = document.createElement("div");
        overlay.className = "ghs-action-menu ghs-context-overlay";
        overlay.setAttribute("role", "menu");

        Array.prototype.slice.call(sourceMenu.children).forEach(function (child) {
            if (child.classList.contains("ghs-action-menu__sep")) {
                overlay.appendChild(child.cloneNode(false));
                return;
            }
            if (child.tagName !== "BUTTON" || child.textContent.trim() === "Pull") return;

            var button = document.createElement("button");
            button.type = "button";
            button.textContent = child.textContent;
            button.disabled = child.disabled;
            button.title = child.title || "";
            button.setAttribute("role", "menuitem");
            button.onclick = function (event) {
                event.stopPropagation();
                closeOverlay();
                if (!button.disabled) child.click();
            };
            overlay.appendChild(button);
        });

        /* Remove separators left at either edge after Pull is omitted. */
        while (overlay.firstElementChild && overlay.firstElementChild.classList.contains("ghs-action-menu__sep"))
            overlay.firstElementChild.remove();
        while (overlay.lastElementChild && overlay.lastElementChild.classList.contains("ghs-action-menu__sep"))
            overlay.lastElementChild.remove();
        if (!overlay.children.length) return;

        document.body.appendChild(overlay);
        openOverlay = overlay;
        openTrigger = trigger;
        trigger.setAttribute("aria-expanded", "true");
        placeOverlay(overlay, trigger, clientX, clientY);

        var first = overlay.querySelector("button:not(:disabled)");
        if (first) first.focus({ preventScroll: true });
    }

    function applyRow(row) {
        var cell = row.querySelector("td.ghs-table__action");
        if (!cell || cell.dataset.contextOverlayReady === "yes") return;
        var wrap = cell.querySelector(".ghs-menu-wrap");
        var trigger = cell.querySelector(".ghs-kebab");
        var sourceMenu = cell.querySelector(".ghs-action-menu");
        if (!wrap || !trigger || !sourceMenu) return;

        var cluster = document.createElement("div");
        cluster.className = "ghs-row-actions";

        var pullSource = sourceButton(sourceMenu, "Pull");
        if (pullSource) {
            var pull = document.createElement("button");
            pull.type = "button";
            pull.className = "ghs-btn ghs-btn--secondary ghs-btn--sm ghs-primary-pull";
            pull.textContent = "Pull";
            pull.disabled = pullSource.disabled;
            if (pullSource.title) pull.title = pullSource.title;
            pull.onclick = function (event) {
                event.stopPropagation();
                closeOverlay();
                if (!pull.disabled) pullSource.click();
            };
            cluster.appendChild(pull);
        }

        cluster.appendChild(wrap);
        cell.appendChild(cluster);
        cell.dataset.contextOverlayReady = "yes";

        /* The original menu remains hidden as the action source only. */
        sourceMenu.classList.add("ghs-hidden");
        trigger.onclick = function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (openTrigger === trigger) closeOverlay();
            else buildOverlay(sourceMenu, trigger);
        };

        row.addEventListener("contextmenu", function (event) {
            if (event.target.closest("button,input,select,textarea,a")) return;
            event.preventDefault();
            event.stopPropagation();
            buildOverlay(sourceMenu, trigger, event.clientX, event.clientY);
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
