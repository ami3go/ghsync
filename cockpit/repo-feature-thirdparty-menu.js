/* Integration: keep third-party repository rows compact with Pull/Clone plus a context menu. */
(function () {
    "use strict";
    var body = document.getElementById("third-body");
    if (!body) return;
    var manager = window.GHSyncRepoManager || {};
    var openMenu = null, openTrigger = null;

    function close() {
        if (openMenu) openMenu.classList.add("ghs-hidden");
        if (openTrigger) openTrigger.setAttribute("aria-expanded", "false");
        openMenu = openTrigger = null;
    }
    function place(menu, trigger, clientX, clientY) {
        if (manager.positionContextMenu) {
            manager.positionContextMenu(menu, trigger, clientX, clientY);
            return;
        }
        var rect = trigger.getBoundingClientRect();
        menu.style.left = Math.max(8, rect.right - menu.offsetWidth) + "px";
        menu.style.top = Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4) + "px";
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

        cell.textContent = ""; cell.dataset.thirdMenu = "yes";
        if (primary) {
            var primaryButton = document.createElement("button");
            primaryButton.type = "button";
            primaryButton.className = "ghs-btn ghs-btn--secondary ghs-btn--sm ghs-primary-pull";
            primaryButton.textContent = primary.label;
            primaryButton.disabled = primary.disabled;
            if (primary.title) primaryButton.title = primary.title;
            primaryButton.onclick = function (event) { event.stopPropagation(); if (!primaryButton.disabled) primary.run(); };
            cell.appendChild(primaryButton);
        }

        if (!overflow.length) return;
        var wrap = document.createElement("div"), trigger = document.createElement("button"), menu = document.createElement("div");
        wrap.className = "ghs-menu-wrap";
        trigger.type = "button"; trigger.className = "ghs-btn ghs-btn--secondary ghs-btn--sm ghs-kebab"; trigger.textContent = "⋮";
        trigger.setAttribute("aria-label", "Third-party repository actions"); trigger.setAttribute("aria-haspopup", "menu"); trigger.setAttribute("aria-expanded", "false");
        menu.className = "ghs-action-menu ghs-hidden"; menu.setAttribute("role", "menu");
        overflow.forEach(function (action) {
            var button = document.createElement("button"); button.type = "button"; button.textContent = action.label; button.disabled = action.disabled;
            button.setAttribute("role", "menuitem");
            if (action.title) button.title = action.title;
            button.onclick = function (event) { event.stopPropagation(); close(); action.run(); };
            menu.appendChild(button);
        });
        trigger.onclick = function (event) {
            event.stopPropagation(); var opening = menu.classList.contains("ghs-hidden"); close();
            if (opening) {
                menu.classList.remove("ghs-hidden"); openMenu = menu; openTrigger = trigger;
                trigger.setAttribute("aria-expanded", "true");
                window.requestAnimationFrame(function () { place(menu, trigger); });
            }
        };
        row.addEventListener("contextmenu", function (event) {
            if (event.target.closest("button,input,select,textarea,a")) return;
            event.preventDefault();
            if (menu.classList.contains("ghs-hidden")) trigger.click();
            window.requestAnimationFrame(function () { place(menu, trigger, event.clientX, event.clientY); });
        });
        wrap.appendChild(trigger); wrap.appendChild(menu); cell.appendChild(wrap);
    }
    function apply() { body.querySelectorAll("tr").forEach(compact); }
    new MutationObserver(function () { setTimeout(apply, 0); }).observe(body, { childList: true });
    document.addEventListener("click", close);
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") close(); });
    apply();
})();
