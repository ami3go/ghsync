/* GitHub Sync — Cockpit front-end.
 *
 * All work happens in the ghsync shell script on the server. This page spawns
 * it as the logged-in user (never root) and renders its --porcelain output. */
(function () {
    "use strict";

    var SCRIPT = null;        /* resolved path to the ghsync script */
    var CONFIG_PATH = null;
    var LOG_PATH = null;
    var current = null;       /* running cockpit.spawn process */
    var repos = [];           /* last status snapshot */
    var settings = {};        /* last values read from the backend */

    function $(id) { return document.getElementById(id); }

    /* How each porcelain tag is presented. */
    var TAGS = {
        cloned:        { tone: "green", icon: "i-check", text: "Cloned" },
        updated:       { tone: "green", icon: "i-check", text: "Updated" },
        "up-to-date":  { tone: "muted", icon: "i-check", text: "Up to date" },
        exists:        { tone: "muted", icon: "i-check", text: "Already cloned" },
        clean:         { tone: "muted", icon: "i-check", text: "Clean" },
        dirty:         { tone: "gold",  icon: "i-warn",  text: "Uncommitted changes" },
        diverged:      { tone: "gold",  icon: "i-warn",  text: "Diverged" },
        detached:      { tone: "gold",  icon: "i-warn",  text: "Detached HEAD" },
        "no-upstream": { tone: "gold",  icon: "i-warn",  text: "No upstream" },
        skipped:       { tone: "muted", icon: "i-info",  text: "Skipped" },
        failed:        { tone: "red",   icon: "i-error", text: "Failed" },
        error:         { tone: "red",   icon: "i-error", text: "Error" },
        info:          { tone: "blue",  icon: "i-info",  text: "Info" }
    };
    function tagInfo(tag) {
        return TAGS[tag] || { tone: "muted", icon: "i-info", text: tag };
    }

    function icon(id, cls) {
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#" + id);
        svg.appendChild(use);
        if (cls) svg.setAttribute("class", cls);
        svg.setAttribute("aria-hidden", "true");
        return svg;
    }

    function labelTag(tag, text) {
        var info = tagInfo(tag);
        var span = document.createElement("span");
        span.className = "ghs-label-tag" + (info.tone === "muted" ? "" : " ghs-label-tag--" + info.tone);
        span.appendChild(icon(info.icon));
        span.appendChild(document.createTextNode(text || info.text));
        return span;
    }

    /* ------------------------------------------------------------- alerts */

    /* source groups an alert so a background refresh only clears its own
       messages and never wipes a confirmation the user just triggered. */
    function alert(variant, title, body, source) {
        var box = document.createElement("div");
        box.className = "ghs-alert ghs-alert--" + variant;
        box.dataset.source = source || "action";
        box.setAttribute("role", variant === "danger" ? "alert" : "status");

        var ico = { danger: "i-error", warning: "i-warn", success: "i-check", info: "i-info" }[variant];
        box.appendChild(icon(ico, "ghs-alert__icon"));

        var content = document.createElement("div");
        var h = document.createElement("h4");
        h.className = "ghs-alert__title";
        h.textContent = title;
        content.appendChild(h);
        if (body) {
            var p = document.createElement("p");
            p.className = "ghs-alert__body";
            p.textContent = body;
            content.appendChild(p);
        }
        box.appendChild(content);

        var close = document.createElement("button");
        close.className = "ghs-alert__close";
        close.type = "button";
        close.setAttribute("aria-label", "Close alert");
        close.textContent = "✕";
        close.onclick = function () { box.remove(); resize(); };
        box.appendChild(close);

        $("alerts").appendChild(box);
        resize();
    }
    function clearAlerts(source) {
        var sel = source ? '[data-source="' + source + '"]' : ".ghs-alert";
        $("alerts").querySelectorAll(sel).forEach(function (el) { el.remove(); });
    }

    function resize() {
        try { cockpit.transport.control("size-change"); } catch (e) { /* not embedded */ }
    }

    /* ---------------------------------------------------------- activity log */

    function logLine(tag, name, detail) {
        var pre = $("console");
        var info = tagInfo(tag);

        var t = document.createElement("span");
        t.className = "ghs-log__tag ghs-t-" + info.tone;
        t.textContent = tag;
        pre.appendChild(t);

        if (name) {
            var n = document.createElement("span");
            n.className = "ghs-log__name";
            n.textContent = " " + name;
            pre.appendChild(n);
        }
        if (detail) {
            var d = document.createElement("span");
            d.className = "ghs-log__detail";
            d.textContent = " — " + detail;
            pre.appendChild(d);
        }
        pre.appendChild(document.createTextNode("\n"));
        pre.scrollTop = pre.scrollHeight;
    }
    function clearLog(message) {
        $("console").textContent = "";
        if (message) logLine("info", message);
    }

    function setBusy(on) {
        $("busy").classList.toggle("ghs-hidden", !on);
        $("btn-cancel").classList.toggle("ghs-hidden", !on);
        ["btn-clone", "btn-pull", "btn-sync", "btn-refresh", "btn-save", "btn-reset",
         "btn-empty-clone", "btn-cron-install", "btn-cron-remove"].forEach(function (id) {
            $(id).disabled = on;
        });
    }

    /* ------------------------------------------------------ backend plumbing */

    function findScript() {
        var probe =
            'for p in "$HOME/.local/bin/ghsync" /usr/local/bin/ghsync /usr/bin/ghsync ' +
            '"$HOME/.local/share/cockpit/ghsync/ghsync" "$HOME/.local/share/cockpit/ghsync/ghsync.sh" ' +
            '/usr/share/cockpit/ghsync/ghsync /usr/share/cockpit/ghsync/ghsync.sh; do ' +
            'if [ -f "$p" ]; then echo "$p"; exit 0; fi; done; exit 1';
        return cockpit.spawn(["sh", "-c", probe], { err: "message" })
            .then(function (out) { SCRIPT = out.trim(); return SCRIPT; });
    }

    /* Run ghsync and deliver tab-separated rows as they arrive. */
    function run(args, onRow) {
        var buffer = "";
        var proc = cockpit.spawn(["bash", SCRIPT].concat(args).concat(["--porcelain"]),
                                 { err: "message", superuser: null });
        current = proc;

        function flush(chunk, final) {
            buffer += chunk || "";
            var idx;
            while ((idx = buffer.indexOf("\n")) >= 0) {
                var line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                if (line.trim()) onRow(line.split("\t"));
            }
            if (final && buffer.trim()) onRow(buffer.split("\t"));
        }

        proc.stream(function (data) { flush(data, false); });
        return proc.then(function () { flush("", true); })
                   .finally(function () { current = null; });
    }

    /* ---------------------------------------------------------- overview */

    function describeCron(line) {
        if (!line) return null;
        var fields = line.trim().split(/\s+/).slice(0, 5).join(" ");
        var known = {
            "0 * * * *": "Every hour",
            "0 */6 * * *": "Every 6 hours",
            "0 3 * * *": "Every day at 03:00",
            "0 9 * * 1": "Every Monday at 09:00"
        };
        return { expr: fields, text: known[fields] || fields };
    }

    function refreshOverview() {
        var v = {};
        return run(["check"], function (f) { if (f[0] === "check") v[f[1]] = f[2] || ""; })
            .then(function () {
                settings = v;
                CONFIG_PATH = v.config || null;
                LOG_PATH = v.log || null;
                clearAlerts("env");

                setField("v-gh", v.gh ? labelTag("cloned", "Version " + v.gh) : labelTag("failed", "Not installed"));
                setField("v-user", v.auth === "yes"
                    ? labelTag("cloned", v.user || "Signed in")
                    : labelTag("failed", "Not authenticated"));
                $("v-root").textContent = v.root || "—";
                $("v-local").textContent = v.local === "1" ? "1 repository" : (v.local || "0") + " repositories";

                var cron = describeCron(v.cron);
                setField("v-cron", cron ? labelTag("cloned", cron.text) : labelTag("skipped", "Not scheduled"));
                $("cron-line").textContent = v.cron ? v.cron : "No scheduled updates.";
                if (cron) {
                    var select = $("f-sched");
                    var match = Array.prototype.some.call(select.options, function (o) { return o.value === cron.expr; });
                    select.value = match ? cron.expr : "custom";
                    $("f-custom").value = cron.expr;
                    toggleCustom();
                }

                fillSettingsForm();

                if (!v.gh)
                    alert("warning", "The GitHub CLI is not installed",
                          "Install gh from cli.github.com on this host, then reload this page.", "env");
                else if (v.auth !== "yes")
                    alert("warning", "gh is not authenticated for this user",
                          "Open the Cockpit terminal and run: gh auth login", "env");
            })
            .catch(function (ex) {
                alert("danger", "Could not query ghsync", ex.message || String(ex), "env");
            });
    }

    function setField(id, node) {
        var el = $(id);
        el.textContent = "";
        el.appendChild(node);
    }

    function fillSettingsForm() {
        $("f-root").value = settings.root || "";
        $("f-owners").value = settings.owners || "";
        $("f-proto").value = settings.proto || "ssh";
        $("f-jobs").value = settings.jobs || 4;
        $("f-limit").value = settings.limit || 1000;
        $("f-forks").checked = settings.forks === "true";
        $("f-archived").checked = settings.archived === "true";
    }

    /* ------------------------------------------------------ repository table */

    function repoState(r) {
        if (Number(r.dirty) > 0) return "dirty";
        if (r.branch === "detached") return "detached";
        if (Number(r.ahead) > 0) return "diverged";
        if (Number(r.behind) > 0) return "no-upstream";
        return "clean";
    }
    function repoStateText(r) {
        if (Number(r.dirty) > 0) return "Uncommitted changes";
        if (r.branch === "detached") return "Detached HEAD";
        if (Number(r.ahead) > 0) return "Unpushed commits";
        if (Number(r.behind) > 0) return "Behind remote";
        return "Clean";
    }

    function renderRepos() {
        var needle = $("filter").value.trim().toLowerCase();
        var tbody = $("repos");
        var shown = repos.filter(function (r) {
            return !needle || r.name.toLowerCase().indexOf(needle) >= 0;
        });

        tbody.textContent = "";
        $("repos-empty").classList.toggle("ghs-hidden", shown.length > 0);
        document.querySelector(".ghs-table-wrap").classList.toggle("ghs-hidden", shown.length === 0);

        if (!shown.length) {
            $("repos-empty-body").textContent = repos.length
                ? "No repository matches the filter."
                : "Nothing has been cloned into " + (settings.root || "the repository root") + " yet.";
            $("btn-empty-clone").classList.toggle("ghs-hidden", repos.length > 0);
            $("repo-count").textContent = "";
            resize();
            return;
        }

        $("repo-count").textContent = shown.length === repos.length
            ? repos.length + (repos.length === 1 ? " repository" : " repositories")
            : shown.length + " of " + repos.length + " repositories";

        shown.forEach(function (r) {
            var tr = document.createElement("tr");

            var name = document.createElement("td");
            name.className = "ghs-repo-name";
            name.textContent = r.name;
            tr.appendChild(name);

            var branch = document.createElement("td");
            branch.textContent = r.branch;
            tr.appendChild(branch);

            var state = document.createElement("td");
            state.appendChild(labelTag(repoState(r), repoStateText(r)));
            tr.appendChild(state);

            [r.dirty, r.ahead, r.behind].forEach(function (n) {
                var td = document.createElement("td");
                td.className = "ghs-num" + (Number(n) === 0 ? " ghs-zero" : "");
                td.textContent = n;
                tr.appendChild(td);
            });

            var act = document.createElement("td");
            act.className = "ghs-table__action";
            var btn = document.createElement("button");
            btn.className = "ghs-btn ghs-btn--secondary ghs-btn--sm";
            btn.type = "button";
            btn.textContent = "Pull";
            btn.onclick = function () { action(["pull", r.name], "Pulling " + r.name); };
            act.appendChild(btn);
            tr.appendChild(act);

            tbody.appendChild(tr);
        });
        resize();
    }

    function refreshStatus() {
        var found = [];
        return run(["status"], function (f) {
            if (f[0] === "repo")
                found.push({ name: f[1], branch: f[2], dirty: f[3], ahead: f[4], behind: f[5] });
        }).catch(function () { /* no clones yet — an empty table is the right answer */ })
          .then(function () {
              repos = found.sort(function (a, b) { return a.name.localeCompare(b.name); });
              var attention = repos.filter(function (r) { return repoState(r) !== "clean"; }).length;
              setField("v-attention", attention
                  ? labelTag("dirty", attention + (attention === 1 ? " repository" : " repositories"))
                  : labelTag("clean", "None"));
              renderRepos();
          });
    }

    /* ---------------------------------------------------------------- actions */

    function action(args, title) {
        clearAlerts("action");
        setBusy(true);
        selectTab("activity");
        clearLog(title);
        var counts = {};
        $("counters").textContent = "";

        return run(args, function (f) {
            var tag = f[0];
            if (tag === "repo") return;
            if (tag === "summary") return;
            counts[tag] = (counts[tag] || 0) + 1;
            logLine(tag, f[1], f[2]);
            renderCounters(counts);
        })
        .then(function () { return refreshStatus(); })
        .then(function () { return refreshOverview(); })
        .then(function () {
            if (counts.failed)
                alert("danger", counts.failed + " repository operation(s) failed",
                      "See the Activity tab for details.");
        })
        .catch(function (ex) {
            if (ex.problem === "cancelled" || /cancel/i.test(ex.message || "")) {
                logLine("info", "Cancelled.");
            } else {
                logLine("error", ex.message || String(ex));
                alert("danger", "ghsync failed", ex.message || String(ex));
            }
        })
        .finally(function () { setBusy(false); resize(); });
    }

    function renderCounters(counts) {
        var box = $("counters");
        box.textContent = "";
        Object.keys(counts).sort().forEach(function (tag) {
            box.appendChild(labelTag(tag, counts[tag] + " " + tagInfo(tag).text.toLowerCase()));
        });
    }

    /* --------------------------------------------------------------- settings */

    function saveSettings() {
        if (!CONFIG_PATH) { alert("danger", "Cannot save", "The config path is unknown."); return; }
        var text =
            "# ghsync configuration — written by the Cockpit page\n" +
            'ROOT="' + $("f-root").value.trim() + '"\n' +
            'OWNERS="' + $("f-owners").value.trim() + '"\n' +
            'PROTOCOL="' + $("f-proto").value + '"\n' +
            "INCLUDE_FORKS=" + ($("f-forks").checked ? "true" : "false") + "\n" +
            "INCLUDE_ARCHIVED=" + ($("f-archived").checked ? "true" : "false") + "\n" +
            "JOBS=" + (parseInt($("f-jobs").value, 10) || 4) + "\n" +
            "LIMIT=" + (parseInt($("f-limit").value, 10) || 1000) + "\n" +
            "GIT_TIMEOUT=600\n";

        setBusy(true);
        cockpit.spawn(["mkdir", "-p", CONFIG_PATH.replace(/\/[^/]*$/, "")], { err: "message" })
            .then(function () { return cockpit.file(CONFIG_PATH).replace(text); })
            .then(function () {
                clearAlerts("action");
                alert("success", "Settings saved", CONFIG_PATH);
                return refreshOverview();
            })
            .then(refreshStatus)
            .catch(function (ex) { alert("danger", "Could not save settings", ex.message || String(ex)); })
            .finally(function () { setBusy(false); });
    }

    /* --------------------------------------------------------------- schedule */

    function scheduleExpression() {
        var v = $("f-sched").value;
        return v === "custom" ? $("f-custom").value.trim() : v;
    }
    function toggleCustom() {
        $("g-custom").classList.toggle("ghs-hidden", $("f-sched").value !== "custom");
    }

    function cron(args, title) {
        setBusy(true);
        cockpit.spawn(["bash", SCRIPT].concat(args), { err: "message", superuser: null })
            .then(function () { clearAlerts("action"); alert("success", title); return refreshOverview(); })
            .catch(function (ex) { alert("danger", "Could not change the schedule", ex.message || String(ex)); })
            .finally(function () { setBusy(false); });
    }

    function loadLogFile() {
        if (!LOG_PATH) return;
        cockpit.spawn(["sh", "-c", 'tail -n 200 "' + LOG_PATH + '" 2>/dev/null || true'], { err: "message" })
            .then(function (out) {
                $("console").textContent = out.trim() || "The log file is still empty.";
                resize();
            })
            .catch(function (ex) { alert("danger", "Could not read the log", ex.message || String(ex)); });
    }

    /* ------------------------------------------------------------------- tabs */

    function selectTab(name) {
        document.querySelectorAll(".ghs-tab").forEach(function (t) {
            var on = t.dataset.tab === name;
            t.classList.toggle("ghs-tab--current", on);
            t.setAttribute("aria-selected", on ? "true" : "false");
        });
        ["repos", "activity", "settings", "schedule"].forEach(function (n) {
            $("panel-" + n).classList.toggle("ghs-hidden", n !== name);
        });
        resize();
    }

    /* ------------------------------------------------------------------- wire */

    document.querySelectorAll(".ghs-tab").forEach(function (t) {
        t.onclick = function () { selectTab(t.dataset.tab); };
    });

    $("btn-clone").onclick = function () { action(["clone"], "Cloning missing repositories"); };
    $("btn-empty-clone").onclick = function () { action(["clone"], "Cloning missing repositories"); };
    $("btn-pull").onclick = function () { action(["pull"], "Pulling updates"); };
    $("btn-sync").onclick = function () { action(["sync"], "Full sync"); };
    $("btn-refresh").onclick = function () {
        setBusy(true);
        refreshStatus().then(refreshOverview).finally(function () { setBusy(false); });
    };
    $("btn-cancel").onclick = function () { if (current) current.close("cancelled"); };
    $("filter").oninput = renderRepos;
    $("btn-save").onclick = saveSettings;
    $("btn-reset").onclick = fillSettingsForm;
    $("btn-log").onclick = loadLogFile;
    $("f-sched").onchange = toggleCustom;
    $("btn-cron-install").onclick = function () {
        var expr = scheduleExpression();
        if (!/^\S+(\s+\S+){4}$/.test(expr)) {
            alert("warning", "That is not a valid cron expression", "Five fields are required, for example 0 */6 * * *");
            return;
        }
        cron(["cron", "install", expr], "Schedule saved");
    };
    $("btn-cron-remove").onclick = function () { cron(["cron", "remove"], "Schedule removed"); };

    /* ---------------------------------------------------------------- startup */

    clearLog("Starting up");
    findScript()
        .then(function () {
            clearLog("Using " + SCRIPT);
            return refreshOverview();
        })
        .then(refreshStatus)
        .then(resize)
        .catch(function () {
            clearLog();
            logLine("error", "ghsync not found");
            alert("danger", "The ghsync script was not found",
                  "Run ./install.sh from the ghsync repository as this user, then reload the page.");
            document.querySelector(".ghs-table-wrap").classList.add("ghs-hidden");
            $("repos-empty").classList.add("ghs-hidden");
        });
})();
