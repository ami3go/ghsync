/* Integration: keep third-party repository rows compact with Pull/Clone plus a body-level context menu. */
(function () {
    "use strict";
    var body = document.getElementById("third-body");
    if (!body) return;
    var openOverlay = null, openTrigger = null;

    function close() {
        if (openOverlay) openOverlay.remove();
        if (openTrigger) openTrigger.setAttribute("aria-expanded", "false");
        openOverlay = openTrigger = null;
    }

    function place(menu, trigger, clientX, clientY) {
        var margin = 8, rect = trigger.getBoundingClientRect();
        var width = menu.offsetWidth, height = menu.offsetHeight;
        var pointer = typeof clientX === "number" && typeof clientY === "number";
        var left = pointer ? clientX : rect.right - width;
        var top = pointer ? clientY : rect.bottom + 4;
        if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
        if (left < margin) left = margin;
        if (top + height > window.innerHeight - margin) top = pointer ? clientY - height : rect.top - height - 4;
        if (top < margin) top = margin;
        menu.style.left = Math.round(left) + "px";
        menu.style.top = Math.round(top) + "px";
    }

    function open(actions, trigger, clientX, clientY) {
        close();
        if (!actions.length) return;
        var menu = document.createElement("div");
        menu.className = "ghs-action-menu ghs-context-overlay";
        menu.setAttribute("role", "menu");
        actions.forEach(function (action) {
            var button = document.createElement("button");
            button.type = "button";
            button.textContent = action.label;
            button.disabled = action.disabled;
            if (action.title) button.title = action.title;
            button.setAttribute("role", "menuitem");
            button.onclick = function (event) {
                event.stopPropagation();
                close();
                if (!button.disabled) action.run();
            };
            menu.appendChild(button);
        });
        document.body.appendChild(menu);
        openOverlay = menu;
        openTrigger = trigger;
        trigger.setAttribute("aria-expanded", "true");
        place(menu, trigger, clientX, clientY);
        var first = menu.querySelector("button:not(:disabled)");
        if (first) first.focus({ preventScroll: true });
    }

    function compact(row) {
        var cell = row.querySelector("td.ghs-table__action");
        if (!cell || cell.dataset.thirdMenu === "yes") return;
        var old = Array.prototype.slice.call(cell.querySelectorAll("button"));
        if (!old.length) return;
        var actions = old.map(function (button) {
            return { label: button.textContent.trim(), disabled: button.disabled, title: button.title, run: function () { button.click(); } };
        });
        var primary = actions.filter(function (action) { return action.label === "Pull" || action.label === "Clone"; })[0] || null;
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
            primaryButton.onclick = function (event) {
                event.stopPropagation();
                close();
                if (!primaryButton.disabled) primary.run();
            };
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
            trigger.onclick = function (event) {
                event.preventDefault();
                event.stopPropagation();
                if (openTrigger === trigger) close();
                else open(overflow, trigger);
            };
            cluster.appendChild(trigger);

            row.addEventListener("contextmenu", function (event) {
                if (event.target.closest("button,input,select,textarea,a")) return;
                event.preventDefault();
                event.stopPropagation();
                open(overflow, trigger, event.clientX, event.clientY);
            });
        }

        cell.appendChild(cluster);
    }

    function apply() { body.querySelectorAll("tr").forEach(compact); }
    new MutationObserver(function () { setTimeout(apply, 0); }).observe(body, { childList: true });
    document.addEventListener("click", close);
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") close(); });
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    apply();
})();
