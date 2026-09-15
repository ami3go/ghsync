/* Feature 17: notification center for application and sync events. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    var LAST_RUN_KEY = "ghsync:last-notified-run";
    var STORE_KEY = "ghsync:notifications:v1";
    var MAX_ITEMS = 100;
    var history = loadHistory();
    var tabButton = null;
    var panel = null;
    var list = null;
    var badge = null;

    function resize() {
        try { cockpit.transport.control("size-change"); } catch (e) { /* not embedded */ }
    }

    function loadHistory() {
        try {
            var value = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
            if (!Array.isArray(value)) return [];
            return value.filter(function (item) {
                return item && item.title && item.createdAt;
            }).slice(0, MAX_ITEMS);
        } catch (e) {
            return [];
        }
    }

    function saveHistory() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(history.slice(0, MAX_ITEMS))); }
        catch (e) { /* storage is optional */ }
    }

    function notificationId() {
        return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
    }

    function isOpen() {
        return panel && !panel.classList.contains("ghs-hidden");
    }

    function sourceText(source) {
        return {
            env: "Environment",
            action: "Action",
            sync: "Sync",
            schedule: "Schedule"
        }[source] || (source ? source.charAt(0).toUpperCase() + source.slice(1) : "Application");
    }

    function iconFor(variant) {
        return {
            danger: "i-error",
            warning: "i-warn",
            success: "i-check",
            info: "i-info"
        }[variant] || "i-info";
    }

    function makeIcon(variant) {
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        svg.setAttribute("class", "ghs-notification__icon");
        svg.setAttribute("aria-hidden", "true");
        use.setAttribute("href", "#" + iconFor(variant));
        svg.appendChild(use);
        return svg;
    }

    function relativeTime(ms) {
        var seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
        if (seconds < 60) return "just now";
        var units = [
            ["minute", 60], ["hour", 3600], ["day", 86400],
            ["month", 2629800], ["year", 31557600]
        ];
        var chosen = units[0];
        units.forEach(function (u) { if (seconds >= u[1]) chosen = u; });
        var n = Math.floor(seconds / chosen[1]);
        return n + " " + chosen[0] + (n === 1 ? "" : "s") + " ago";
    }

    function unreadCount() {
        return history.filter(function (item) { return !item.read; }).length;
    }

    function updateBadge() {
        if (!badge || !tabButton) return;
        var unread = unreadCount();
        badge.textContent = unread > 99 ? "99+" : String(unread);
        badge.classList.toggle("ghs-hidden", unread === 0);
        tabButton.setAttribute("aria-label", unread
            ? "Notifications, " + unread + " unread"
            : "Notifications, no unread items");
    }

    function renderHistory() {
        if (!list) return;
        list.textContent = "";
        var empty = document.getElementById("notifications-empty");
        if (empty) empty.classList.toggle("ghs-hidden", history.length !== 0);

        history.forEach(function (item) {
            var row = document.createElement("article");
            row.className = "ghs-notification ghs-notification--" + item.variant + (item.read ? "" : " ghs-notification--unread");
            row.dataset.notificationId = item.id;

            row.appendChild(makeIcon(item.variant));

            var content = document.createElement("div");
            content.className = "ghs-notification__content";

            var head = document.createElement("div");
            head.className = "ghs-notification__header";
            var title = document.createElement("h3");
            title.className = "ghs-notification__title";
            title.textContent = item.title;
            var time = document.createElement("time");
            time.className = "ghs-notification__time";
            time.dateTime = new Date(item.createdAt).toISOString();
            time.title = new Date(item.createdAt).toLocaleString();
            time.textContent = relativeTime(item.createdAt) + " · " + new Date(item.createdAt).toLocaleString();
            head.appendChild(title);
            head.appendChild(time);
            content.appendChild(head);

            if (item.body) {
                var body = document.createElement("p");
                body.className = "ghs-notification__body";
                body.textContent = item.body;
                content.appendChild(body);
            }

            var meta = document.createElement("div");
            meta.className = "ghs-notification__meta";
            meta.textContent = sourceText(item.source);
            if (!item.read) {
                var unread = document.createElement("span");
                unread.className = "ghs-notification__unread";
                unread.textContent = "Unread";
                meta.appendChild(document.createTextNode(" · "));
                meta.appendChild(unread);
            }
            content.appendChild(meta);

            if (item.details && item.details.length) {
                var details = document.createElement("details");
                details.className = "ghs-notification__details";
                var summary = document.createElement("summary");
                summary.textContent = "Details (" + item.details.length + ")";
                var pre = document.createElement("pre");
                pre.textContent = item.details.join("\n");
                details.appendChild(summary);
                details.appendChild(pre);
                content.appendChild(details);
            }

            row.appendChild(content);
            list.appendChild(row);
        });
        updateBadge();
        resize();
    }

    function addNotification(options) {
        options = options || {};
        var source = options.source || "action";
        var details = options.details || [];
        if (!Array.isArray(details)) details = [String(details)];

        if (options.externalId) {
            var existingExternal = history.some(function (item) { return item.externalId === options.externalId; });
            if (existingExternal) return;
        }

        /* Environment warnings can be rediscovered on every refresh. Keep one
           history item for the same condition instead of producing noise. */
        if (source === "env") {
            var duplicate = history.find(function (item) {
                return item.source === source && item.title === options.title && item.body === (options.body || "");
            });
            if (duplicate) {
                duplicate.createdAt = Date.now();
                if (details.length) duplicate.details = details;
                saveHistory();
                renderHistory();
                return duplicate;
            }
        }

        var item = {
            id: notificationId(),
            externalId: options.externalId || "",
            createdAt: options.createdAt || Date.now(),
            variant: options.variant || "info",
            title: options.title || "GitHub Sync",
            body: options.body || "",
            details: details,
            source: source,
            read: isOpen()
        };
        history.unshift(item);
        history = history.slice(0, MAX_ITEMS);
        saveHistory();
        renderHistory();
        return item;
    }

    function markAllRead() {
        var changed = false;
        history.forEach(function (item) {
            if (!item.read) { item.read = true; changed = true; }
        });
        if (changed) saveHistory();
        renderHistory();
    }

    function clearHistory() {
        history = [];
        saveHistory();
        renderHistory();
    }

    function openCenter() {
        document.querySelectorAll(".ghs-tab").forEach(function (t) {
            var on = t === tabButton;
            t.classList.toggle("ghs-tab--current", on);
            t.setAttribute("aria-selected", on ? "true" : "false");
        });
        ["repos", "stats", "activity", "settings", "schedule"].forEach(function (name) {
            var known = document.getElementById("panel-" + name);
            if (known) known.classList.add("ghs-hidden");
        });
        panel.classList.remove("ghs-hidden");
        markAllRead();
        resize();
    }

    function createCenter() {
        if (document.getElementById("panel-notifications")) return;

        if (!document.getElementById("ghs-notification-center-css")) {
            var css = document.createElement("link");
            css.id = "ghs-notification-center-css";
            css.rel = "stylesheet";
            css.href = "repo-feature-notifications.css";
            document.head.appendChild(css);
        }

        var tabs = document.querySelector(".ghs-tabs");
        var settingsTab = document.querySelector('.ghs-tab[data-tab="settings"]');
        if (!tabs) return;

        tabButton = document.createElement("button");
        tabButton.className = "ghs-tab ghs-notification-tab";
        tabButton.type = "button";
        tabButton.dataset.tab = "notifications";
        tabButton.setAttribute("role", "tab");
        tabButton.setAttribute("aria-selected", "false");
        tabButton.appendChild(document.createTextNode("Notifications"));
        badge = document.createElement("span");
        badge.id = "notification-unread-count";
        badge.className = "ghs-notification-badge ghs-hidden";
        tabButton.appendChild(badge);
        tabs.insertBefore(tabButton, settingsTab || null);

        panel = document.createElement("section");
        panel.id = "panel-notifications";
        panel.className = "ghs-tab-panel ghs-hidden";
        panel.setAttribute("role", "tabpanel");

        var toolbar = document.createElement("div");
        toolbar.className = "ghs-toolbar ghs-notification-toolbar";
        var intro = document.createElement("p");
        intro.className = "ghs-helper ghs-notification-intro";
        intro.textContent = "Application events and sync results are kept here. Opening this tab marks them as read.";
        var spacer = document.createElement("span");
        spacer.className = "ghs-toolbar__spacer";
        var mark = document.createElement("button");
        mark.id = "btn-notifications-read";
        mark.type = "button";
        mark.className = "ghs-btn ghs-btn--secondary ghs-btn--sm";
        mark.textContent = "Mark all read";
        mark.onclick = markAllRead;
        var clear = document.createElement("button");
        clear.id = "btn-notifications-clear";
        clear.type = "button";
        clear.className = "ghs-btn ghs-btn--link ghs-btn--sm";
        clear.textContent = "Clear history";
        clear.onclick = clearHistory;
        toolbar.appendChild(intro);
        toolbar.appendChild(spacer);
        toolbar.appendChild(mark);
        toolbar.appendChild(clear);
        panel.appendChild(toolbar);

        list = document.createElement("div");
        list.id = "notification-list";
        list.className = "ghs-notification-list";
        panel.appendChild(list);

        var empty = document.createElement("div");
        empty.id = "notifications-empty";
        empty.className = "ghs-empty";
        var emptyTitle = document.createElement("h3");
        emptyTitle.className = "ghs-empty__title";
        emptyTitle.textContent = "No notifications";
        var emptyBody = document.createElement("p");
        emptyBody.className = "ghs-empty__body";
        emptyBody.textContent = "Sync results, warnings, confirmations and failures will appear here.";
        empty.appendChild(emptyTitle);
        empty.appendChild(emptyBody);
        panel.appendChild(empty);

        var settingsPanel = document.getElementById("panel-settings");
        if (settingsPanel && settingsPanel.parentNode) settingsPanel.parentNode.insertBefore(panel, settingsPanel);
        else tabs.parentNode.appendChild(panel);

        tabButton.onclick = openCenter;

        /* Core tab selection knows about its original panels. When it selects
           one programmatically, make sure our dynamically-added panel closes. */
        var tabObserver = new MutationObserver(function () {
            var current = tabs.querySelector('.ghs-tab--current:not([data-tab="notifications"])');
            if (current && panel && !panel.classList.contains("ghs-hidden")) {
                panel.classList.add("ghs-hidden");
                tabButton.classList.remove("ghs-tab--current");
                tabButton.setAttribute("aria-selected", "false");
            }
        });
        tabObserver.observe(tabs, { subtree: true, attributes: true, attributeFilter: ["class", "aria-selected"] });

        renderHistory();
    }

    function captureAlertBox(box) {
        if (!box || !box.classList || !box.classList.contains("ghs-alert")) return;
        var variant = "info";
        ["danger", "warning", "success", "info"].some(function (name) {
            if (box.classList.contains("ghs-alert--" + name)) { variant = name; return true; }
            return false;
        });
        var title = box.querySelector(".ghs-alert__title");
        var body = box.querySelector(".ghs-alert__body");
        addNotification({
            variant: variant,
            title: title ? title.textContent.trim() : "GitHub Sync",
            body: body ? body.textContent.trim() : "",
            source: box.dataset.source || "action"
        });
        box.remove();
        resize();
    }

    function captureCoreAlerts() {
        var alerts = document.getElementById("alerts");
        if (!alerts) return;
        Array.prototype.slice.call(alerts.querySelectorAll(".ghs-alert")).forEach(captureAlertBox);
        var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                Array.prototype.slice.call(mutation.addedNodes).forEach(function (node) {
                    if (node.nodeType === 1) captureAlertBox(node);
                });
            });
        });
        observer.observe(alerts, { childList: true });
    }

    function parseCheck(out) {
        var values = {};
        out.split("\n").forEach(function (line) {
            var f = line.split("\t");
            if (f[0] === "check") values[f[1]] = f[2] || "";
        });
        return values;
    }

    function latestCompletedRun(text) {
        var lines = text.split("\n"), summaries = [];
        lines.forEach(function (line, i) { if (/\s+summary\s+/.test(line)) summaries.push(i); });
        if (!summaries.length) return null;
        var end = summaries[summaries.length - 1];
        var start = summaries.length > 1 ? summaries[summaries.length - 2] + 1 : 0;
        var run = lines.slice(start, end + 1).filter(Boolean);

        for (var i = end + 1; i < lines.length; i += 1) {
            var line = lines[i];
            if (!line.trim()) continue;
            if (/\s+local-only\s+\S+\/\S+/.test(line)) { run.push(line); continue; }
            break;
        }

        var important = run.filter(function (line) {
            return /\s+(updated|failed|diverged|local-only|dirty|no-upstream|detached)\s+/.test(line);
        });
        if (!important.length) return null;
        var counts = { updated: 0, failed: 0, diverged: 0, localOnly: 0, dirty: 0, other: 0 };
        important.forEach(function (line) {
            if (/\s+updated\s+/.test(line)) counts.updated += 1;
            else if (/\s+failed\s+/.test(line)) counts.failed += 1;
            else if (/\s+diverged\s+/.test(line)) counts.diverged += 1;
            else if (/\s+local-only\s+/.test(line)) counts.localOnly += 1;
            else if (/\s+dirty\s+/.test(line)) counts.dirty += 1;
            else counts.other += 1;
        });
        var summaryLine = lines[end];
        return { id: summaryLine + "|" + important.join("|"), counts: counts, lines: important };
    }

    function summaryText(run) {
        var parts = [], c = run.counts;
        if (c.updated) parts.push(c.updated + " updated");
        if (c.failed) parts.push(c.failed + " failed");
        if (c.diverged) parts.push(c.diverged + " diverged");
        if (c.localOnly) parts.push(c.localOnly + " local-only");
        if (c.dirty) parts.push(c.dirty + " dirty");
        if (c.other) parts.push(c.other + " need attention");
        return parts.join(", ");
    }

    function showCockpitNotice(run) {
        addNotification({
            externalId: run.id,
            variant: run.counts.failed > 0 ? "danger" : "warning",
            title: "Latest sync needs attention",
            body: summaryText(run) + ".",
            source: "sync",
            details: run.lines
        });
    }

    function showDesktopNotice(run) {
        if (!("Notification" in window) || Notification.permission !== "granted") return;
        try { new Notification("GitHub Sync", { body: summaryText(run) }); } catch (e) { /* optional */ }
    }

    function checkLatest() {
        return m.runCore(["check"]).then(function (out) {
            var log = parseCheck(out).log;
            if (!log) return null;
            return cockpit.spawn(["tail", "-n", "300", log], { err: "ignore" });
        }).then(function (text) {
            if (!text) return;
            var run = latestCompletedRun(text);
            if (!run) return;
            var previous = "";
            try { previous = sessionStorage.getItem(LAST_RUN_KEY) || ""; } catch (e) { /* unavailable */ }
            if (previous === run.id) return;
            showCockpitNotice(run);
            showDesktopNotice(run);
            try { sessionStorage.setItem(LAST_RUN_KEY, run.id); } catch (e2) { /* unavailable */ }
        }).catch(function () { /* notifications must never break the page */ });
    }

    function addNotificationSetting() {
        var settingsPanel = document.getElementById("panel-settings");
        if (!settingsPanel || document.getElementById("btn-enable-notifications") || !("Notification" in window)) return;
        var group = document.createElement("div"), button = document.createElement("button"), helper = document.createElement("p");
        group.className = "ghs-form-group";
        button.id = "btn-enable-notifications";
        button.type = "button";
        button.className = "ghs-btn ghs-btn--secondary";
        button.textContent = Notification.permission === "granted" ? "Desktop notifications enabled" : "Enable desktop notifications";
        button.disabled = Notification.permission === "granted";
        helper.className = "ghs-helper";
        helper.textContent = "Application events are stored in the Notifications tab. Desktop notifications are optional.";
        button.onclick = function () {
            Notification.requestPermission().then(function (permission) {
                button.textContent = permission === "granted" ? "Desktop notifications enabled" : "Desktop notifications not enabled";
                button.disabled = permission === "granted";
            });
        };
        group.appendChild(button);
        group.appendChild(helper);
        var form = settingsPanel.querySelector(".ghs-form") || settingsPanel;
        form.appendChild(group);
    }

    createCenter();
    window.GHSyncNotifications = {
        add: addNotification,
        markAllRead: markAllRead,
        clear: clearHistory
    };
    captureCoreAlerts();
    addNotificationSetting();
    setTimeout(checkLatest, 500);
    var refresh = document.getElementById("btn-refresh");
    if (refresh) refresh.addEventListener("click", function () { setTimeout(checkLatest, 1200); });
})();
