/* Priority 1: repositories that require attention and safe remediation. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.statusSnapshot || !m.mapLimit) return;

    function $(id) { return document.getElementById(id); }
    function resize() { try { cockpit.transport.control("size-change"); } catch (e) { /* standalone */ } }
    function safe(promise, fallback) { return promise.catch(function () { return fallback; }); }

    var tab = null, panel = null, lastRows = [], scanning = false;

    function parseCheck(out) {
        var values = {};
        String(out || "").split("\n").forEach(function (line) {
            var f = line.split("\t");
            if (f[0] === "check") values[f[1]] = f[2] || "";
        });
        return values;
    }

    function parseLatestFailures(text) {
        var lines = String(text || "").split(/\r?\n/), summaries = [], failures = {};
        lines.forEach(function (line, index) {
            if (/(^|\s)summary(\s|$)/.test(line.replace(/\t/g, " "))) summaries.push(index);
        });
        if (!summaries.length) return failures;
        var end = summaries[summaries.length - 1];
        var start = summaries.length > 1 ? summaries[summaries.length - 2] + 1 : 0;
        for (var i = start; i < end; i += 1) {
            var fields = lines[i].trim().split(/\s+/), pos = fields.indexOf("failed");
            if (pos < 0) continue;
            var name = fields[pos + 1] || "";
            if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name)) continue;
            failures[name] = {
                line: lines[i].trim(),
                detail: fields.slice(pos + 2).join(" ") || "The latest sync operation failed"
            };
        }
        return failures;
    }

    function latestFailures() {
        return m.runCore(["check"]).then(function (out) {
            var log = parseCheck(out).log;
            if (!log) return {};
            return cockpit.spawn(["tail", "-n", "500", log], { err: "ignore", superuser: null })
                .then(parseLatestFailures, function () { return {}; });
        }, function () { return {}; });
    }

    function gitMeta(row) {
        if (row.branch === "mirror") return Promise.resolve({ detached: false, upstream: true, upstreamName: "mirror" });
        return Promise.all([
            safe(m.runGit(row.name, ["symbolic-ref", "--quiet", "--short", "HEAD"]), ""),
            safe(m.runGit(row.name, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]), "")
        ]).then(function (values) {
            var branch = String(values[0] || "").trim(), upstream = String(values[1] || "").trim();
            return {
                detached: row.branch === "detached" || !branch,
                upstream: !!upstream,
                upstreamName: upstream
            };
        });
    }

    function issue(key, severity, title, detail) {
        return { key: key, severity: severity, title: title, detail: detail || "" };
    }

    function buildIssues(row, meta, failures) {
        var issues = [], failure = failures && failures[row.name];
        var detached = row.branch !== "mirror" && (row.branch === "detached" || meta.detached);
        if (detached) issues.push(issue("detached", "danger", "Detached HEAD", "Switch to a branch before normal pull or push operations."));
        if (row.ahead > 0 && row.behind > 0) {
            issues.push(issue("diverged", "danger", "Branch diverged", row.ahead + " ahead and " + row.behind + " behind upstream; manual review is required."));
        } else {
            if (row.behind > 0) issues.push(issue("behind", "warning", "Behind upstream", row.behind + " commit" + (row.behind === 1 ? "" : "s") + " behind."));
            if (row.ahead > 0) issues.push(issue("ahead", "warning", "Local commits not pushed", row.ahead + " commit" + (row.ahead === 1 ? "" : "s") + " ahead."));
        }
        if (row.dirty > 0) issues.push(issue("dirty", "warning", "Uncommitted changes", row.dirty + " changed path" + (row.dirty === 1 ? "" : "s") + " in the working tree."));
        if (row.branch !== "mirror" && !detached && !meta.upstream) {
            issues.push(issue("no-upstream", "warning", "No upstream branch", "The current branch is not tracking a remote branch."));
        }
        if (failure) issues.push(issue("failed", "danger", "Latest sync failed", failure.detail));
        return issues;
    }

    function severityFor(issues) {
        return issues.some(function (item) { return item.severity === "danger"; }) ? "danger" : "warning";
    }

    function actionNames(row, meta, issues) {
        var keys = {};
        issues.forEach(function (item) { keys[item.key] = true; });
        var actions = [];
        if (keys.dirty && row.branch !== "mirror" && !meta.detached) actions.push("Stash changes");
        if (keys.behind && !keys.diverged && !keys.dirty && !meta.detached && meta.upstream) actions.push("Pull");
        if (keys.ahead && !keys.diverged && !meta.detached) actions.push("Push");
        if (keys["no-upstream"] && !meta.detached && actions.indexOf("Push") < 0) actions.push("Push");
        if (keys.detached) actions.push("Branches…");
        if (keys.failed) actions.push("Notifications");
        actions.push("Details…");
        return actions;
    }

    function registeredAction(label) {
        return (m.actions || []).find(function (action) { return action.label === label; });
    }

    function notify(variant, title, body, details) {
        if (window.GHSyncNotifications && window.GHSyncNotifications.add) {
            window.GHSyncNotifications.add({ variant: variant, title: title, body: body || "", details: details || [], source: "action" });
        }
    }

    function pullRepository(name) {
        return m.runCore(["pull", name]).then(function (out) {
            var failed = null;
            String(out || "").split("\n").some(function (line) {
                var f = line.split("\t");
                if (f[0] === "failed" && f[1] === name) { failed = f.slice(2).join(" ") || "pull failed"; return true; }
                return false;
            });
            if (failed) throw new Error(failed);
            notify("success", "Repository pulled", name + " was updated successfully.");
            m.refreshMainPage();
        }).catch(function (e) {
            notify("danger", "Pull failed for " + name, e.message || String(e));
            window.alert("Pull failed for " + name + ": " + (e.message || String(e)));
        });
    }

    function openNotifications() {
        var notifications = document.querySelector('.ghs-tab[data-tab="notifications"]');
        if (notifications) notifications.click();
    }

    function runAction(label, name) {
        if (label === "Pull") {
            pullRepository(name).then(function () { setTimeout(refresh, 300); });
            return;
        }
        if (label === "Notifications") { openNotifications(); return; }
        var action = registeredAction(label);
        if (!action) {
            window.alert(label + " is not available for this repository.");
            return;
        }
        try {
            Promise.resolve(action.run(name)).catch(function () {}).then(function () { setTimeout(refresh, 700); });
        } catch (e) {
            window.alert(label + " failed for " + name + ": " + (e.message || String(e)));
        }
    }

    function makeActionButton(label, name) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "ghs-btn " + (label === "Pull" || label === "Push" ? "ghs-btn--primary" : "ghs-btn--secondary") + " ghs-btn--sm";
        button.textContent = label;
        button.onclick = function () { runAction(label, name); };
        return button;
    }

    function render() {
        var body = $("attention-body"), wrap = $("attention-wrap"), empty = $("attention-empty");
        if (!body || !wrap || !empty) return;
        body.textContent = "";
        var query = ($("attention-filter") ? $("attention-filter").value : "").trim().toLowerCase();
        var visible = lastRows.filter(function (entry) {
            if (!query) return true;
            return (entry.row.name + " " + entry.issues.map(function (i) { return i.title + " " + i.detail; }).join(" ")).toLowerCase().indexOf(query) >= 0;
        });
        visible.forEach(function (entry) {
            var tr = document.createElement("tr");
            tr.className = "ghs-attention-row ghs-attention-row--" + entry.severity;
            var repo = document.createElement("td"), state = document.createElement("td"), problems = document.createElement("td"), actions = document.createElement("td");
            repo.className = "ghs-repo-name"; repo.textContent = entry.row.name;
            var badge = document.createElement("span");
            badge.className = "ghs-attention-state ghs-attention-state--" + entry.severity;
            badge.textContent = entry.severity === "danger" ? "Problem" : "Attention";
            state.appendChild(badge);
            var list = document.createElement("ul"); list.className = "ghs-attention-problems";
            entry.issues.forEach(function (problem) {
                var li = document.createElement("li"), strong = document.createElement("strong"), detail = document.createElement("span");
                strong.textContent = problem.title; detail.textContent = problem.detail ? " — " + problem.detail : "";
                li.appendChild(strong); li.appendChild(detail); list.appendChild(li);
            });
            problems.appendChild(list);
            var actionBox = document.createElement("div"); actionBox.className = "ghs-attention-actions";
            entry.actions.forEach(function (label) { actionBox.appendChild(makeActionButton(label, entry.row.name)); });
            actions.appendChild(actionBox);
            tr.appendChild(repo); tr.appendChild(state); tr.appendChild(problems); tr.appendChild(actions); body.appendChild(tr);
        });
        wrap.classList.toggle("ghs-hidden", visible.length === 0);
        empty.classList.toggle("ghs-hidden", visible.length !== 0 || (!!query && lastRows.length !== 0));
        if ($("attention-no-match")) $("attention-no-match").classList.toggle("ghs-hidden", visible.length !== 0 || !query || lastRows.length === 0);
        if ($("attention-summary")) {
            $("attention-summary").textContent = lastRows.length
                ? lastRows.length + " repositor" + (lastRows.length === 1 ? "y" : "ies") + " need attention"
                : "All repositories look healthy";
        }
        if ($("attention-count")) {
            $("attention-count").textContent = lastRows.length > 99 ? "99+" : String(lastRows.length);
            $("attention-count").classList.toggle("ghs-hidden", lastRows.length === 0);
        }
        if (tab) tab.setAttribute("aria-label", lastRows.length ? "Attention, " + lastRows.length + " repositories need action" : "Attention, no problems detected");
        resize();
    }

    function setScanning(on) {
        scanning = on;
        if ($("btn-attention-refresh")) $("btn-attention-refresh").disabled = on;
        if ($("attention-summary") && on) $("attention-summary").textContent = "Checking repositories…";
    }

    function refresh() {
        if (scanning) return Promise.resolve(lastRows);
        setScanning(true);
        return Promise.all([m.statusSnapshot(), latestFailures()]).then(function (values) {
            var rows = values[0], failures = values[1];
            return m.mapLimit(rows, 8, function (row) {
                return gitMeta(row).then(function (meta) {
                    var issues = buildIssues(row, meta, failures);
                    return issues.length ? { row: row, meta: meta, issues: issues, severity: severityFor(issues), actions: actionNames(row, meta, issues) } : null;
                });
            });
        }).then(function (entries) {
            lastRows = entries.filter(Boolean).sort(function (a, b) {
                if (a.severity !== b.severity) return a.severity === "danger" ? -1 : 1;
                return a.row.name.localeCompare(b.row.name);
            });
            render(); return lastRows;
        }).catch(function (e) {
            if ($("attention-summary")) $("attention-summary").textContent = "Could not check repositories: " + (e.message || String(e));
            return lastRows;
        }).finally(function () { setScanning(false); resize(); });
    }

    function createUi() {
        if ($("panel-attention")) return;
        if (!$("ghs-attention-css")) {
            var css = document.createElement("link"); css.id = "ghs-attention-css"; css.rel = "stylesheet"; css.href = "repo-feature-attention.css"; document.head.appendChild(css);
        }
        var tabs = document.querySelector(".ghs-tabs"), reposTab = document.querySelector('.ghs-tab[data-tab="repos"]'), reposPanel = $("panel-repos");
        if (!tabs || !reposPanel || !reposPanel.parentNode) return;
        tab = document.createElement("button"); tab.type = "button"; tab.className = "ghs-tab ghs-attention-tab"; tab.dataset.tab = "attention";
        tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", "false"); tab.appendChild(document.createTextNode("Attention"));
        var count = document.createElement("span"); count.id = "attention-count"; count.className = "ghs-attention-count ghs-hidden"; count.textContent = "0"; tab.appendChild(count);
        if (reposTab && reposTab.nextSibling) tabs.insertBefore(tab, reposTab.nextSibling); else tabs.appendChild(tab);

        panel = document.createElement("section"); panel.id = "panel-attention"; panel.className = "ghs-tab-panel ghs-hidden"; panel.setAttribute("role", "tabpanel");
        panel.innerHTML =
            '<div class="ghs-toolbar ghs-attention-toolbar">' +
            '<strong id="attention-summary">Checking repositories…</strong><span class="ghs-toolbar__spacer"></span>' +
            '<input id="attention-filter" class="ghs-input ghs-attention-filter" type="search" placeholder="Filter attention items" aria-label="Filter attention items">' +
            '<button id="btn-attention-refresh" class="ghs-btn ghs-btn--secondary ghs-btn--sm" type="button">Refresh</button></div>' +
            '<p class="ghs-helper">Live Git state is authoritative. Failed-operation context comes from the latest completed sync. Safe actions are offered only when they do not hide divergence or discard local work.</p>' +
            '<div id="attention-wrap" class="ghs-table-wrap ghs-hidden"><table class="ghs-table ghs-attention-table"><thead><tr>' +
            '<th>Repository</th><th>State</th><th>Problems</th><th>Recommended actions</th></tr></thead><tbody id="attention-body"></tbody></table></div>' +
            '<div id="attention-empty" class="ghs-empty"><h3 class="ghs-empty__title">Everything looks healthy</h3><p class="ghs-empty__body">No dirty, behind, ahead, diverged, detached, missing-upstream or latest-sync failures were detected.</p></div>' +
            '<div id="attention-no-match" class="ghs-empty ghs-hidden"><h3 class="ghs-empty__title">No matching attention items</h3><p class="ghs-empty__body">Clear the filter to see all repositories that need action.</p></div>';
        reposPanel.parentNode.insertBefore(panel, reposPanel.nextSibling);

        tab.onclick = function () {
            document.querySelectorAll(".ghs-tab").forEach(function (item) {
                var on = item === tab; item.classList.toggle("ghs-tab--current", on); item.setAttribute("aria-selected", on ? "true" : "false");
            });
            document.querySelectorAll(".ghs-tab-panel").forEach(function (item) { item.classList.add("ghs-hidden"); });
            panel.classList.remove("ghs-hidden"); refresh(); resize();
        };
        new MutationObserver(function () {
            var current = tabs.querySelector('.ghs-tab--current:not([data-tab="attention"])');
            if (current && panel && !panel.classList.contains("ghs-hidden")) {
                panel.classList.add("ghs-hidden"); tab.classList.remove("ghs-tab--current"); tab.setAttribute("aria-selected", "false");
            }
        }).observe(tabs, { subtree: true, attributes: true, attributeFilter: ["class", "aria-selected"] });
        $("btn-attention-refresh").onclick = refresh;
        $("attention-filter").oninput = render;
        var mainRefresh = $("btn-refresh");
        if (mainRefresh) mainRefresh.addEventListener("click", function () {
            if (panel && !panel.classList.contains("ghs-hidden")) setTimeout(refresh, 350);
        });
    }

    createUi();
    window.GHSyncAttention = {
        parseLatestFailures: parseLatestFailures,
        buildIssues: buildIssues,
        actionNames: actionNames,
        refresh: refresh
    };
    setTimeout(refresh, 150);
})();
