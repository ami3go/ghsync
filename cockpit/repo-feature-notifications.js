/* Feature 17: meaningful sync notifications without duplicate noise. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;
    var KEY = "ghsync:last-notified-run";

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
        var alerts = document.getElementById("alerts");
        if (!alerts || document.getElementById("ghs-sync-notice")) return;
        var danger = run.counts.failed > 0;
        var box = document.createElement("div");
        box.id = "ghs-sync-notice";
        box.className = "ghs-alert ghs-alert--" + (danger ? "danger" : "warning");
        box.setAttribute("role", danger ? "alert" : "status");
        var content = document.createElement("div");
        var title = document.createElement("h4"), body = document.createElement("p"), close = document.createElement("button");
        title.className = "ghs-alert__title"; title.textContent = "Latest sync needs attention";
        body.className = "ghs-alert__body"; body.textContent = summaryText(run) + ". Open Activity for details.";
        close.className = "ghs-alert__close"; close.type = "button"; close.textContent = "✕"; close.setAttribute("aria-label", "Close alert");
        close.onclick = function () { box.remove(); };
        content.appendChild(title); content.appendChild(body); box.appendChild(content); box.appendChild(close); alerts.appendChild(box);
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
            try { previous = sessionStorage.getItem(KEY) || ""; } catch (e) { /* unavailable */ }
            if (previous === run.id) return;
            showCockpitNotice(run); showDesktopNotice(run);
            try { sessionStorage.setItem(KEY, run.id); } catch (e2) { /* unavailable */ }
        }).catch(function () { /* notifications must never break the page */ });
    }

    function addNotificationSetting() {
        var panel = document.getElementById("panel-settings");
        if (!panel || document.getElementById("btn-enable-notifications") || !("Notification" in window)) return;
        var group = document.createElement("div"), button = document.createElement("button"), helper = document.createElement("p");
        group.className = "ghs-form-group";
        button.id = "btn-enable-notifications"; button.type = "button"; button.className = "ghs-btn ghs-btn--secondary";
        button.textContent = Notification.permission === "granted" ? "Desktop notifications enabled" : "Enable desktop notifications";
        button.disabled = Notification.permission === "granted";
        helper.className = "ghs-helper"; helper.textContent = "Cockpit alerts are always shown for meaningful sync events. Desktop notifications are optional.";
        button.onclick = function () {
            Notification.requestPermission().then(function (permission) {
                button.textContent = permission === "granted" ? "Desktop notifications enabled" : "Desktop notifications not enabled";
                button.disabled = permission === "granted";
            });
        };
        group.appendChild(button); group.appendChild(helper);
        var form = panel.querySelector(".ghs-form") || panel;
        form.appendChild(group);
    }

    addNotificationSetting();
    setTimeout(checkLatest, 500);
    var refresh = document.getElementById("btn-refresh");
    if (refresh) refresh.addEventListener("click", function () { setTimeout(checkLatest, 1200); });
})();
