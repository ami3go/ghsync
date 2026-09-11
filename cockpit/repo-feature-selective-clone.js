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
    function ghOptions(cfg) {
        return cfg.host ? { err: "message", environ: ["GH_HOST=" + cfg.host] } : { err: "message" };
    }
    function listAvailable(cfg) {
        var owners = (cfg.owners || "").split(/\s+/).filter(Boolean);
        if (!owners.length) owners = [""];
        var limit = String(parseInt(cfg.limit, 10) || 1000);
        return Promise.all(owners.map(function (owner) {
            var args = ["gh", "repo", "list"];
            if (owner) args.push(owner);
            args.push("--limit", limit, "--json", "nameWithOwner", "--jq", ".[].nameWithOwner");
            return cockpit.spawn(args, ghOptions(cfg));
        })).then(function (parts) {
            var seen = {}, names = [];
            parts.join("\n").split("\n").filter(Boolean).forEach(function (name) {
                if (!seen[name]) { seen[name] = true; names.push(name); }
            });
            return names.sort();
        });
    }

    button.onclick = function () {
        button.disabled = true;
        Promise.all([m.runCore(["check"]), m.statusSnapshot(), m.repositoryRoot()])
            .then(function (values) {
                var cfg = checkValues(values[0]), local = {}, root = values[2].replace(/\/$/, "");
                values[1].forEach(function (repo) { local[repo.name] = true; });
                return listAvailable(cfg).then(function (available) {
                    available = available.filter(function (name) { return !local[name]; });
                    if (!available.length) throw new Error("All repositories returned by GitHub are already cloned");
                    var preview = available.slice(0, 60).join("\n") + (available.length > 60 ? "\n… and " + (available.length - 60) + " more" : "");
                    var name = window.prompt("Enter owner/repository to clone. Available repositories include:\n\n" + preview, available[0]);
                    if (name === null) throw { cancelled: true };
                    name = name.trim();
                    if (available.indexOf(name) < 0) throw new Error("Repository was not in the configured GitHub repository list");
                    return { name: name, cfg: cfg, root: root };
                });
            })
            .then(function (v) {
                var protocol = v.cfg.proto === "https" ? "url" : "sshUrl";
                return cockpit.spawn(["gh", "repo", "view", v.name, "--json", protocol, "--jq", "." + protocol], ghOptions(v.cfg))
                    .then(function (url) {
                        var mirror = v.cfg.mirror === "true";
                        var dest = v.root + "/" + v.name + (mirror ? ".git" : "");
                        var args = mirror ? ["clone", "--mirror", "--quiet"] : ["clone", "--recurse-submodules", "--quiet"];
                        var filter = v.cfg.filter || "blob:none";
                        if (!mirror) {
                            if (filter === "blob:none" || filter === "tree:0") args.push("--filter=" + filter);
                            else if (/^depth:[0-9]+$/.test(filter)) args.push("--depth", filter.slice(6), "--no-single-branch");
                        }
                        return cockpit.spawn(["mkdir", "-p", dest.slice(0, dest.lastIndexOf("/"))], { err: "message" })
                            .then(function () { return cockpit.spawn(["git"].concat(args, [url.trim(), dest]), { err: "message" }); });
                    });
            })
            .then(function () { m.refreshMainPage(); window.alert("Repository cloned successfully."); })
            .catch(function (e) { if (!(e && e.cancelled)) window.alert("Clone failed: " + (e.message || String(e))); })
            .finally(function () { button.disabled = false; });
    };
})();
