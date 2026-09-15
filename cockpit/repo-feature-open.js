/* Feature 5: open repositories in a browser tab and make GitHub names clickable. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    var githubBasePromise = null;

    function cleanHttpRemote(remote) {
        try {
            var url = new URL(remote);
            url.username = "";
            url.password = "";
            url.search = "";
            url.hash = "";
            return url.toString().replace(/\/$/, "").replace(/\.git$/, "");
        } catch (e) {
            return "";
        }
    }

    function webUrl(remote) {
        remote = (remote || "").trim();
        var match;
        if (/^https?:\/\//i.test(remote)) return cleanHttpRemote(remote);
        remote = remote.replace(/\.git$/, "");
        if ((match = remote.match(/^git@([^:]+):(.+)$/))) return "https://" + match[1] + "/" + match[2];
        if ((match = remote.match(/^ssh:\/\/(?:[^@]+@)?([^/]+)\/(.+)$/))) return "https://" + match[1] + "/" + match[2];
        if ((match = remote.match(/^git:\/\/([^/]+)\/(.+)$/))) return "https://" + match[1] + "/" + match[2];
        return "";
    }

    function configuredGithubBase() {
        if (githubBasePromise) return githubBasePromise;
        githubBasePromise = m.runCore(["check"]).then(function (out) {
            var host = "github.com";
            out.split("\n").some(function (line) {
                var f = line.split("\t");
                if (f[0] === "check" && f[1] === "host") {
                    host = (f[2] || "github.com").trim();
                    return true;
                }
                return false;
            });
            if (!/^https?:\/\//i.test(host)) host = "https://" + host;
            try {
                var parsed = new URL(host);
                return parsed.origin + parsed.pathname.replace(/\/$/, "");
            } catch (e) {
                return "https://github.com";
            }
        }).catch(function () {
            return "https://github.com";
        });
        return githubBasePromise;
    }

    function githubUrl(base, name) {
        var parts = (name || "").split("/");
        if (parts.length !== 2 || !parts[0] || !parts[1]) return "";
        return base + "/" + encodeURIComponent(parts[0]) + "/" + encodeURIComponent(parts[1]);
    }

    function installLinkStyles() {
        if (document.getElementById("ghs-repo-link-style")) return;
        var style = document.createElement("style");
        style.id = "ghs-repo-link-style";
        style.textContent =
            ".ghs-repo-link{color:var(--ghs-link,#06c);text-decoration:none;font:inherit}" +
            ".ghs-repo-link:hover{text-decoration:underline}" +
            ".ghs-repo-link:focus-visible{outline:2px solid var(--ghs-primary,#06c);outline-offset:2px;border-radius:2px}";
        document.head.appendChild(style);
    }

    function decorateRepositoryNames() {
        var body = document.getElementById("repos");
        if (!body) return;
        configuredGithubBase().then(function (base) {
            body.querySelectorAll("tr").forEach(function (row) {
                var cell = row.querySelector("td.ghs-repo-name");
                if (!cell || cell.querySelector("a.ghs-repo-link")) return;
                var name = (row.dataset.repoName || cell.textContent || "").trim();
                var href = githubUrl(base, name);
                if (!href) return;
                row.dataset.repoName = name;
                var link = document.createElement("a");
                link.className = "ghs-repo-link";
                link.href = href;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.textContent = name;
                link.title = "Open " + name + " on " + new URL(base).host;
                cell.textContent = "";
                cell.appendChild(link);
            });
        });
    }

    function openRemote(name) {
        m.runGit(name, ["remote", "get-url", "origin"]).then(function (out) {
            var url = webUrl(out);
            if (!url) throw new Error("origin is not a web-hosted Git remote");
            var opened = window.open(url, "_blank", "noopener,noreferrer");
            if (opened) opened.opener = null;
        }).catch(function (e) { window.alert("Could not open remote for " + name + ": " + (e.message || String(e))); });
    }

    installLinkStyles();
    decorateRepositoryNames();
    var repos = document.getElementById("repos");
    if (repos) new MutationObserver(decorateRepositoryNames).observe(repos, { childList: true, subtree: true });

    m.registerAction({ label: "Open remote", run: openRemote });
})();
