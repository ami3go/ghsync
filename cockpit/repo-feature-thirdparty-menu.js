/* Integration: keep third-party repository rows compact with Pull/Clone plus an anchored action menu. */
(function () {
    "use strict";
    var body = document.getElementById("third-body");
    if (!body) return;

    var openOverlay = null;
    var openTrigger = null;
    var openWrap = null;

    function close() {
        if (openOverlay) openOverlay.remove();
        if (openTrigger && openTrigger.isConnected) openTrigger.setAttribute("aria-expanded", "false");
        if (openWrap) openWrap.classList.remove("ghs-table-wrap--menu-open");
        openOverlay = null;
        openTrigger = null;
        openWrap = null;
    }

    function orient(menu, trigger) {
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

    function open(actions, trigger) {
        close();
        if (!actions.length || !trigger || !trigger.isConnected) return;

        var cluster = trigger.closest(".ghs-row-actions");
        if (!cluster) return;

        var menu = document.createElement("div");
        menu.className = "ghs-action-menu ghs-context-overlay";
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", "Third-party repository actions");

        actions.forEach(function (action) {
            var button = document.createElement("button");
            button.type = "button";
            button.textContent = action.label;
            button.disabled = action.disabled;
            if (action.title) button.title = action.title;
            button.setAttribute("role", "menuitem");
            button.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                if (button.disabled) return;
                close();
                action.run();
            });
            menu.appendChild(button);
        });

        cluster.appendChild(menu);
        openOverlay = menu;
        openTrigger = trigger;
        openWrap = trigger.closest(".ghs-table-wrap");
        if (openWrap) openWrap.classList.add("ghs-table-wrap--menu-open");
        trigger.setAttribute("aria-expanded", "true");
        orient(menu, trigger);
    }

    function toggle(actions, trigger) {
        if (openTrigger === trigger && openOverlay) close();
        else open(actions, trigger);
    }

    function compact(row) {
        var cell = row.querySelector("td.ghs-table__action");
        if (!cell || cell.dataset.thirdMenu === "yes") return;

        var old = Array.prototype.slice.call(cell.querySelectorAll("button"));
        if (!old.length) return;

        var actions = old.map(function (button) {
            return {
                label: button.textContent.trim(),
                disabled: button.disabled,
                title: button.title,
                run: function () { button.click(); }
            };
        });
        var primary = actions.filter(function (action) {
            return action.label === "Pull" || action.label === "Clone";
        })[0] || null;
        var overflow = actions.filter(function (action) { return action !== primary; });

        cell.textContent = "";
        cell.dataset.thirdMenu = "yes";
        var cluster = document.createElement("div");
        cluster.className = "ghs-row-actions";

        if (primary) {
            var primaryButton = document.createElement("button");
            primaryButton.type = "button";
            primaryButton.className = "ghs-btn ghs-btn--secondary ghs-btn--sm ghs-primary-pull";
            primaryButton.textContent = primary.label;
            primaryButton.disabled = primary.disabled;
            if (primary.title) primaryButton.title = primary.title;
            primaryButton.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                close();
                if (!primaryButton.disabled) primary.run();
            });
            cluster.appendChild(primaryButton);
        }

        if (overflow.length) {
            var trigger = document.createElement("button");
            trigger.type = "button";
            trigger.className = "ghs-btn ghs-btn--secondary ghs-btn--sm ghs-kebab";
            trigger.textContent = "⋮";
            trigger.setAttribute("aria-label", "Third-party repository actions");
            trigger.setAttribute("aria-haspopup", "menu");
            trigger.setAttribute("aria-expanded", "false");

            trigger.addEventListener("pointerdown", function (event) {
                if (event.button !== undefined && event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                toggle(overflow, trigger);
            });
            trigger.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                if (typeof window.PointerEvent === "function") return;
                toggle(overflow, trigger);
            });
            trigger.addEventListener("keydown", function (event) {
                if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown") return;
                event.preventDefault();
                event.stopPropagation();
                if (!openOverlay || openTrigger !== trigger) open(overflow, trigger);
                var first = openOverlay && openOverlay.querySelector("button:not(:disabled)");
                if (first) first.focus();
            });
            cluster.appendChild(trigger);

            row.addEventListener("contextmenu", function (event) {
                if (event.target.closest("button,input,select,textarea,a")) return;
                event.preventDefault();
                event.stopPropagation();
                open(overflow, trigger);
            });
        }

        cell.appendChild(cluster);
    }

    function apply() {
        body.querySelectorAll("tr").forEach(compact);
    }

    new MutationObserver(function () { window.setTimeout(apply, 0); }).observe(body, { childList: true });

    document.addEventListener("pointerdown", function (event) {
        if (!openOverlay) return;
        if (openOverlay.contains(event.target)) return;
        if (openTrigger && openTrigger.contains(event.target)) return;
        close();
    }, true);
    document.addEventListener("mousedown", function (event) {
        if (typeof window.PointerEvent === "function" || !openOverlay) return;
        if (openOverlay.contains(event.target)) return;
        if (openTrigger && openTrigger.contains(event.target)) return;
        close();
    }, true);
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") close(); });
    window.addEventListener("resize", close);
    apply();
})();