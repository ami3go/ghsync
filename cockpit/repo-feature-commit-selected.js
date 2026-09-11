/* Feature 14: choose files for a local commit. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    function state(name, row) {
        var branch = row.children[1] ? row.children[1].textContent.trim() : "";
        var dirty = row.children[3] ? parseInt(row.children[3].textContent, 10) || 0 : 0;
        if (branch === "mirror") return { disabled: true, title: "Bare mirrors have no working tree" };
        if (branch === "detached") return { disabled: true, title: "Switch to a branch before committing" };
        if (!dirty) return { disabled: true, title: "No uncommitted changes" };
        return {};
    }
    function nulList(text) {
        return (text || "").split("\0").filter(function (path) { return path !== ""; });
    }
    function unique(paths) {
        var seen = Object.create(null), out = [];
        paths.forEach(function (path) {
            if (!Object.prototype.hasOwnProperty.call(seen, path)) {
                seen[path] = true;
                out.push(path);
            }
        });
        return out;
    }
    function displayPath(path) {
        return JSON.stringify(path);
    }
    function commitSelected(name) {
        Promise.all([
            m.runGit(name, ["diff", "--name-only", "--no-renames", "-z"]),
            m.runGit(name, ["diff", "--cached", "--name-only", "--no-renames", "-z"]),
            m.runGit(name, ["ls-files", "--others", "--exclude-standard", "-z"])
        ]).then(function (values) {
            var files = unique(nulList(values[0]).concat(nulList(values[1]), nulList(values[2])));
            if (!files.length) throw new Error("No changed files were found");
            var display = files.map(function (path, i) { return (i + 1) + ". " + displayPath(path); }).join("\n");
            var choice = window.prompt("Changed files in " + name + ":\n\n" + display + "\n\nEnter ALL or comma-separated file numbers to commit:", "ALL");
            if (choice === null) throw { cancelled: true };
            choice = choice.trim();
            var selected;
            if (choice.toUpperCase() === "ALL") selected = files;
            else {
                var indexes = choice.split(",").map(function (v) { return Number(v.trim()); });
                if (!indexes.length || indexes.some(function (n) { return !Number.isInteger(n) || n < 1 || n > files.length; }))
                    throw new Error("Invalid file selection");
                selected = unique(indexes.map(function (n) { return files[n - 1]; }));
            }
            var message = window.prompt("Commit message for " + selected.length + " selected file(s) in " + name + ":");
            if (message === null) throw { cancelled: true };
            message = message.trim();
            if (!message) throw new Error("Commit message is required");
            return m.runGit(name, ["add", "--"].concat(selected))
                .then(function () { return m.runGit(name, ["commit", "--only", "-m", message, "--"].concat(selected)); });
        }).then(function () {
            window.alert("Selected files committed locally in " + name + ". Nothing was pushed.");
            m.refreshMainPage();
        }).catch(function (e) {
            if (e && e.cancelled) return;
            window.alert("Commit failed for " + name + ": " + (e.message || String(e)));
        });
    }
    m.registerAction({ label: "Commit selected…", state: state, run: commitSelected });
})();
