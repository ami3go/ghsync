/* Feature 12: discover existing local third-party clones and register them. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    var add = document.getElementById("btn-third-add-inline");
    var toolbar = document.querySelector("#panel-repos .ghs-toolbar");
    if ((!add && !toolbar) || document.getElementById("btn-third-discover")) return;

    var button = document.createElement("button");
    button.id = "btn-third-discover"; button.type = "button";
    button.className = "ghs-btn ghs-btn--secondary ghs-btn--sm"; button.textContent = "Discover local";
    button.title = "Find existing local clones that are not yet tracked as third-party repositories";
    if (add && add.parentNode) add.parentNode.insertBefore(button, add.nextSibling);
    else {
        var anchor = document.getElementById("btn-orphans") || document.getElementById("repo-count");
        toolbar.insertBefore(button, anchor || null);
    }

    function checks(out) {
        var v = {};
        out.split("\n").forEach(function (line) { var f = line.split("\t"); if (f[0] === "check") v[f[1]] = f[2] || ""; });
        return v;
    }
    function remoteHost(url) {
        var value = (url || "").trim(), match = value.match(/^(?:https?|git|ssh):\/\/(?:[^@]+@)?([^/:]+)/);
        if (match) return match[1].toLowerCase();
        match = value.match(/^[^@]+@([^:]+):/);
        return match ? match[1].toLowerCase() : "";
    }
    function containsHttpSecret(url) {
        url = (url || "").trim();
        if (!/^https?:\/\//i.test(url)) return false;
        try {
            var parsed = new URL(url);
            return !!(parsed.username || parsed.password || parsed.search || parsed.hash);
        } catch (e) {
            return /^(?:https?):\/\/[^/]*@/i.test(url) || /[?#]/.test(url);
        }
    }

    button.onclick = function () {
        button.disabled = true; button.textContent = "Scanning…";
        Promise.all([m.runCore(["check"]), m.runThird(["list"]), m.statusSnapshot()]).then(function (values) {
            var cfg = checks(values[0]), tracked = {}, managed = {}, githubHost = (cfg.host || "github.com").toLowerCase();
            values[1].split("\n").forEach(function (line) {
                var f = line.split("\t"); if (f[0] === "third-party" && f[1]) tracked[f[1]] = true;
            });
            (cfg.owners || cfg.user || "").split(/\s+/).filter(Boolean).forEach(function (owner) { managed[owner.toLowerCase()] = true; });
            var repos = values[2].filter(function (repo) { return !tracked[repo.name]; });
            return m.mapLimit(repos, 8, function (repo) {
                return m.runGit(repo.name, ["remote", "get-url", "origin"]).then(function (url) {
                    url = url.trim();
                    if (containsHttpSecret(url)) return null;
                    var owner = repo.name.split("/")[0].toLowerCase(), host = remoteHost(url);
                    return (!managed[owner] || (host && host !== githubHost)) ? { name: repo.name, url: url } : null;
                }).catch(function () { return null; });
            });
        }).then(function (items) {
            items = items.filter(Boolean);
            if (!items.length) { window.alert("No untracked public third-party clones were found."); return; }
            var text = items.map(function (item) { return item.name + "  ←  " + item.url; }).join("\n");
            var choice = window.prompt("Discovered local repositories:\n\n" + text + "\n\nEnter owner/repository to track, or ALL to track every discovered repository:", items[0].name);
            if (choice === null) return;
            choice = choice.trim();
            var selected = choice.toUpperCase() === "ALL" ? items : items.filter(function (item) { return item.name === choice; });
            if (!selected.length) throw new Error("No discovered repository matched " + choice);
            return m.mapLimit(selected, 2, function (item) { return m.runThird(["add", item.url]); }).then(function () {
                if (m.refreshThirdParty) return m.refreshThirdParty();
            }).then(function () { m.refreshMainPage(); });
        }).catch(function (e) {
            window.alert("Discovery failed: " + (e.message || String(e)));
        }).finally(function () {
            button.disabled = false; button.textContent = "Discover local";
        });
    };
})();
