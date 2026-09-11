/* Feature 20: keep Pull visible and make the overflow menu behave like a context menu. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    if (!document.getElementById("ghs-context-menu-style")) {
        var style = document.createElement("style");
        style.id = "ghs-context-menu-style";
        style.textContent =
            ".ghs-table__action{white-space:nowrap}" +
            ".ghs-primary-pull{margin-right:.375rem}" +
            ".ghs-action-menu{position:fixed!important;right:auto!important;top:auto!important;z-index:10000;max-height:calc(100vh - 16px);overflow:auto}";
        document.head.appendChild(style);
    }

    function placeMenu(menu, trigger, clientX, clientY) {
        if (!menu || menu.classList.contains("ghs-hidden")) return;
        var margin = 8, rect = trigger ? trigger.getBoundingClientRect() : null;
        menu.style.left = "0px";
        menu.style.top = "0px";
        var width = menu.offsetWidth, height = menu.offsetHeight;
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
    m.positionContextMenu = placeMenu;

    function primaryPull(row) {
        var builtins = row._ghsyncBuiltins || [];
        for (var i = 0; i < builtins.length; i += 1) {
            if (builtins[i].label === "Pull") return builtins[i];
        }
        return null;
    }

    function applyRow(row) {
        var cell = row.querySelector("td.ghs-table__action");
        var trigger = cell && cell.querySelector(".ghs-kebab");
        var menu = cell && cell.querySelector(".ghs-action-menu");
        if (!cell || !trigger || !menu) return;

        var pull = primaryPull(row);
        if (pull && !cell.querySelector(".ghs-primary-pull")) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = "ghs-btn ghs-btn--secondary ghs-btn--sm ghs-primary-pull";
            button.textContent = "Pull";
            button.disabled = !!(pull.state && pull.state.disabled);
            if (pull.state && pull.state.title) button.title = pull.state.title;
            button.onclick = function (event) { event.stopPropagation(); if (!button.disabled) pull.run(); };
            cell.insertBefore(button, cell.firstChild);
        }

        Array.prototype.slice.call(menu.querySelectorAll("button")).forEach(function (button) {
            if (button.textContent.trim() === "Pull") button.remove();
        });

        if (!trigger.dataset.contextPositioned) {
            trigger.dataset.contextPositioned = "yes";
            trigger.addEventListener("click", function () {
                window.requestAnimationFrame(function () { placeMenu(menu, trigger); });
            });
        }

        if (!row.dataset.contextMenuReady) {
            row.dataset.contextMenuReady = "yes";
            row.addEventListener("contextmenu", function (event) {
                if (event.target.closest("button,input,select,textarea,a")) return;
                var currentTrigger = row.querySelector(".ghs-kebab");
                var currentMenu = row.querySelector(".ghs-action-menu");
                if (!currentTrigger || !currentMenu) return;
                event.preventDefault();
                if (currentMenu.classList.contains("ghs-hidden")) currentTrigger.click();
                window.requestAnimationFrame(function () {
                    placeMenu(currentMenu, currentTrigger, event.clientX, event.clientY);
                });
            });
        }
    }

    function apply() {
        var body = document.getElementById("repos");
        if (!body) return;
        body.querySelectorAll("tr").forEach(applyRow);
    }

    var body = document.getElementById("repos");
    if (body) new MutationObserver(function () { window.requestAnimationFrame(apply); }).observe(body, { childList: true, subtree: true });
    apply();
})();
