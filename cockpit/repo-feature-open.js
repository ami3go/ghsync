/* Feature 5: open the origin repository in a browser tab. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

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

    function openRemote(name) {
        m.runGit(name, ["remote", "get-url", "origin"]).then(function (out) {
            var url = webUrl(out);
            if (!url) throw new Error("origin is not a web-hosted Git remote");
            var opened = window.open(url, "_blank", "noopener,noreferrer");
            if (opened) opened.opener = null;
        }).catch(function (e) { window.alert("Could not open remote for " + name + ": " + (e.message || String(e))); });
    }
    m.registerAction({ label: "Open remote", run: openRemote });
})();
