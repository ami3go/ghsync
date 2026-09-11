/* GitHub Sync — third-party repository management. */
(function () {
    "use strict";

    var SCRIPT = null;
    var rows = [];
    var tab = document.getElementById("tab-thirdparty");
    var panel = document.getElementById("panel-thirdparty");
    if (!tab || !panel) return;

    function $(id) { return document.getElementById(id); }

    function resize() {
        try { cockpit.transport.control("size-change"); } catch (e) { /* not embedded */ }
    }

    function setBusy(on) {
        ["btn-third-add", "btn-third-refresh"].forEach(function (id) {
            if ($(id)) $(id).disabled = on;
        });
        panel.querySelectorAll("tbody button").forEach(function (button) {
            button.disabled = on;
        });
    }

    function setMessage(text, error) {
        var el = $("third-message");
        el.textContent = text || "";
        el.className = "ghs-helper" + (error ? " ghs-t-red" : "");
        resize();
    }

    function findScript() {
        if (SCRIPT) return Promise.resolve(SCRIPT);
        var probe =
            'for p in "$HOME/.local/bin/ghsync" /usr/local/bin/ghsync /usr/bin/ghsync ' +
            '"$HOME/.local/share/cockpit/ghsync/ghsync" "$HOME/.local/share/cockpit/ghsync/ghsync.sh" ' +
            '/usr/share/cockpit/ghsync/ghsync /usr/share/cockpit/ghsync/ghsync.sh; do ' +
            'if [ -f "$p" ]; then echo "$p"; exit 0; fi; done; exit 1';
        return cockpit.spawn(["sh", "-c", probe], { err: "message" })
            .then(function (out) { SCRIPT = out.trim(); return SCRIPT; });
    }

    function run(args) {
        return findScript().then(function () {
            return cockpit.spawn(["bash", SCRIPT].concat(args).concat(["--porcelain"]),
                                 { err: "message", superuser: null });
        });
    }

    function badge(state) {
        var span = document.createElement("span");
        span.className = "ghs-label-tag " + (state === "cloned" ? "ghs-label-tag--green" : "ghs-label-tag--gold");
        span.textContent = state === "cloned" ? "Cloned" : "Missing";
        return span;
    }

    function actionButton(text, className, handler) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = text;
        button.onclick = handler;
        return button;
    }

    function render() {
        var body = $("third-body");
        body.textContent = "";
        $("third-count").textContent = rows.length + (rows.length === 1 ? " repository" : " repositories");
        $("third-wrap").classList.toggle("ghs-hidden", rows.length === 0);
        $("third-empty").classList.toggle("ghs-hidden", rows.length !== 0);

        rows.forEach(function (row) {
            var tr = document.createElement("tr");

            var name = document.createElement("td");
            name.className = "ghs-repo-name";
            name.textContent = row.name;
            tr.appendChild(name);

            var source = document.createElement("td");
            source.className = "ghs-mono";
            source.textContent = row.url;
            tr.appendChild(source);

            var state = document.createElement("td");
            state.appendChild(badge(row.state));
            tr.appendChild(state);

            var actions = document.createElement("td");
            actions.className = "ghs-table__action";
            var primary = actionButton(row.state === "cloned" ? "Pull" : "Clone",
                "ghs-btn ghs-btn--secondary ghs-btn--sm", function () {
                    if (row.state === "cloned") execute(["pull", row.name], "Updated " + row.name);
                    else execute(["third-party", "add", row.url], "Cloned " + row.name);
                });
            actions.appendChild(primary);

            var remove = actionButton("Untrack",
                "ghs-btn ghs-btn--secondary ghs-btn--danger-text ghs-btn--sm", function () {
                    if (!window.confirm("Stop tracking " + row.name + "? The local clone will be kept.")) return;
                    execute(["third-party", "remove", row.name], "Stopped tracking " + row.name);
                });
            remove.style.marginLeft = "0.375rem";
            actions.appendChild(remove);
            tr.appendChild(actions);
            body.appendChild(tr);
        });
        resize();
    }

    function refresh() {
        setBusy(true);
        setMessage("Loading tracked repositories…", false);
        return run(["third-party", "list"])
            .then(function (out) {
                rows = [];
                out.split("\n").forEach(function (line) {
                    if (!line.trim()) return;
                    var f = line.split("\t");
                    if (f[0] === "third-party")
                        rows.push({ name: f[1], url: f[2], state: f[3] || "missing" });
                });
                rows.sort(function (a, b) { return a.name.localeCompare(b.name); });
                render();
                setMessage(rows.length ? "Tracked repositories are included in normal Pull and Full sync runs." : "", false);
            })
            .catch(function (ex) {
                rows = [];
                render();
                setMessage("Could not load third-party repositories: " + (ex.message || String(ex)), true);
            })
            .finally(function () { setBusy(false); });
    }

    function refreshMainPage() {
        var button = $("btn-refresh");
        if (button && !button.disabled) button.click();
    }

    function execute(args, success) {
        setBusy(true);
        setMessage("Working…", false);
        return run(args)
            .then(function () {
                setMessage(success, false);
                $("third-url").value = args[0] === "third-party" && args[1] === "add" ? "" : $("third-url").value;
                return refresh();
            })
            .then(refreshMainPage)
            .catch(function (ex) {
                setMessage(ex.message || String(ex), true);
            })
            .finally(function () { setBusy(false); });
    }

    function selectThirdParty() {
        document.querySelectorAll(".ghs-tab").forEach(function (item) {
            var on = item === tab;
            item.classList.toggle("ghs-tab--current", on);
            item.setAttribute("aria-selected", on ? "true" : "false");
        });
        document.querySelectorAll(".ghs-tab-panel").forEach(function (item) {
            item.classList.add("ghs-hidden");
        });
        panel.classList.remove("ghs-hidden");
        refresh();
        resize();
    }

    tab.onclick = selectThirdParty;
    $("btn-third-refresh").onclick = refresh;
    $("btn-third-add").onclick = function () {
        var url = $("third-url").value.trim();
        if (!url) {
            setMessage("Enter a public Git repository URL first.", true);
            return;
        }
        execute(["third-party", "add", url], "Repository cloned and tracked.");
    };
    $("third-url").onkeydown = function (event) {
        if (event.key === "Enter") $("btn-third-add").click();
    };

    /* ghsync.js controls the other tabs, including programmatic switches to
       Activity. Watch their selected state so this extra panel never remains
       visible beside another panel. */
    var observer = new MutationObserver(function () {
        if (!tab.classList.contains("ghs-tab--current")) panel.classList.add("ghs-hidden");
    });
    document.querySelectorAll(".ghs-tab").forEach(function (item) {
        observer.observe(item, { attributes: true, attributeFilter: ["class", "aria-selected"] });
    });
})();
