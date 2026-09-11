/* Feature 11: clone one selected GitHub repository. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;
    var anchor = document.getElementById("btn-check-updates") || document.getElementById("btn-orphans");
    if (!anchor || document.getElementById("btn-clone-one")) return;

    var button = document.createElement("button");
    button.id = "btn-clone-one"; button.type = "button"; button.className = "ghs-btn ghs-btn--secondary ghs-btn--sm"; button.textContent = "Clone repository…";
    anchor.parentNode.insertBefore(button, anchor);

    function checkValues(out) {
        var v = {};
        out.split("\n").forEach(function (line) { var f = line.split("\t"); if (f[0] === "check") v[f[1]] = f[2] || ""; });
        return v;
    }
    button.onclick = function () {
        button.disabled = true;
        cockpit.spawn(["gh", "repo", "list", "--limit", "1000", "--json", "nameWithOwner", "--jq", ".[].nameWithOwner"], { err: "message" })
            .then(function (out) {
                var available = out.trim().split("\n").filter(Boolean), local = {};
                document.querySelectorAll("#repos tr").forEach(function (row) { var name = m.rowName ? m.rowName(row) : ""; if (name) local[name] = true; });
                available = available.filter(function (name) { return !local[name]; });
                if (!available.length) throw new Error("All repositories returned by GitHub are already cloned");
                var preview = available.slice(0, 60).join("\n") + (available.length > 60 ? "\n… and " + (available.length - 60) + " more" : "");
                var name = window.prompt("Enter owner/repository to clone. Available repositories include:\n\n" + preview, available[0]);
                if (name === null) throw { cancelled: true };
                name = name.trim();
                if (available.indexOf(name) < 0) throw new Error("Repository was not in the GitHub repository list");
                return Promise.all([Promise.resolve(name), m.runCore(["check"]), m.repositoryRoot()]);
            })
            .then(function (v) {
                var name = v[0], cfg = checkValues(v[1]), root = v[2].replace(/\/$/, ""), dest = root + "/" + name;
                var protocol = cfg.proto === "https" ? "url" : "sshUrl";
                return cockpit.spawn(["gh", "repo", "view", name, "--json", protocol, "--jq", "." + protocol], { err: "message" })
                    .then(function (url) {
                        var args = ["clone", "--recurse-submodules", "--quiet"], filter = cfg.filter || "blob:none";
                        if (filter === "blob:none" || filter === "tree:0") args.push("--filter=" + filter);
                        else if (/^depth:[0-9]+$/.test(filter)) args.push("--depth", filter.slice(6), "--no-single-branch");
                        return cockpit.spawn(["mkdir", "-p", dest.slice(0, dest.lastIndexOf("/"))], { err: "message" })
                            .then(function () { return cockpit.spawn(["git"].concat(args, [url.trim(), dest]), { err: "message" }); });
                    });
            })
            .then(function () { m.refreshMainPage(); window.alert("Repository cloned successfully."); })
            .catch(function (e) { if (!(e && e.cancelled)) window.alert("Clone failed: " + (e.message || String(e))); })
            .finally(function () { button.disabled = false; });
    };
})();
