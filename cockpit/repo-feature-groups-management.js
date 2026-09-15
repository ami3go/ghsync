/* Priority 2: first-class repository groups and group-scoped operations. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.loadMeta || !m.saveMeta || !m.statusSnapshot || !m.mapLimit) return;

    var panel = null, tab = null, busy = false, selectedGroup = "", remoteManifest = null;

    function $(id) { return document.getElementById(id); }
    function uniq(values) {
        var seen = Object.create(null), out = [];
        (values || []).forEach(function (value) {
            value = String(value || "").trim();
            if (!value || seen[value]) return;
            seen[value] = true; out.push(value);
        });
        return out;
    }
    function resize() { try { cockpit.transport.control("size-change"); } catch (e) { /* standalone */ } }
    function message(error) { return error && error.message ? error.message : String(error || "Unknown error"); }
    function notify(variant, title, body, details) {
        if (window.GHSyncNotifications && window.GHSyncNotifications.add) {
            window.GHSyncNotifications.add({ variant: variant, title: title, body: body || "", details: details || [], source: "groups" });
        }
    }
    function setStatus(text, bad) {
        var el = $("groups-status");
        if (el) { el.textContent = text || ""; el.className = "ghs-helper" + (bad ? " ghs-t-red" : ""); }
        resize();
    }
    function setBusy(on) {
        busy = on;
        ["btn-group-new", "btn-group-delete", "btn-group-save", "btn-group-pull", "btn-group-push", "btn-group-sync", "btn-groups-shared-refresh", "btn-groups-shared-push"].forEach(function (id) {
            var button = $(id); if (button) button.disabled = on;
        });
        updateButtons();
    }
    function validGroup(name) { return /^[A-Za-z0-9._-]+$/.test(String(name || "")); }

    function definitions(meta) {
        var names = uniq(meta.groupDefinitions || []);
        Object.keys(meta.groups || {}).forEach(function (repo) {
            var group = String(meta.groups[repo] || "").trim();
            if (group && names.indexOf(group) < 0) names.push(group);
        });
        if (remoteManifest && remoteManifest.groups) Object.keys(remoteManifest.groups).forEach(function (group) {
            if (names.indexOf(group) < 0) names.push(group);
        });
        return names.sort();
    }
    function localMembers(meta, group) {
        return Object.keys(meta.groups || {}).filter(function (repo) { return meta.groups[repo] === group; }).sort();
    }
    function remoteMembers(group) {
        return remoteManifest && remoteManifest.groups && Array.isArray(remoteManifest.groups[group])
            ? uniq(remoteManifest.groups[group]).sort() : [];
    }
    function effectiveMembers(meta, group) { return uniq(localMembers(meta, group).concat(remoteMembers(group))).sort(); }
    function setMembers(meta, group, names) {
        names = uniq(names);
        meta.groups = meta.groups || {};
        meta.groupDefinitions = uniq(meta.groupDefinitions || []);
        if (meta.groupDefinitions.indexOf(group) < 0) meta.groupDefinitions.push(group);
        Object.keys(meta.groups).forEach(function (repo) {
            if (meta.groups[repo] === group && names.indexOf(repo) < 0) delete meta.groups[repo];
        });
        names.forEach(function (repo) { meta.groups[repo] = group; });
        meta.groupDefinitions.sort();
        return meta;
    }
    function sharedGroups(meta) {
        var result = {};
        definitions(meta).forEach(function (group) {
            if (!validGroup(group)) return;
            var members = localMembers(meta, group);
            if (members.length || (meta.groupDefinitions || []).indexOf(group) >= 0) result[group] = members;
        });
        return result;
    }

    function parseCheck(out) {
        var values = {};
        String(out || "").split("\n").forEach(function (line) {
            var f = line.split("\t"); if (f[0] === "check") values[f[1]] = f[2] || "";
        });
        return values;
    }
    function syncForm() {
        var repo = $("sync-source-repo"), branch = $("sync-source-branch"), path = $("sync-source-path"), machine = $("sync-machine");
        if (!repo || !branch || !path || !machine) throw new Error("The Sync tab is not available");
        var current = {
            sourceRepo: repo.value.trim(), branch: branch.value.trim() || "main",
            path: path.value.trim() || "ghsync-repositories.json", machine: machine.value.trim(),
            groups: uniq($("sync-groups") ? $("sync-groups").value.split(/[\s,]+/) : [])
        };
        if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(current.sourceRepo))
            throw new Error("Configure the shared repository in the Sync tab first");
        return current;
    }
    function encodedPath(path) { return String(path || "").split("/").map(function (p) { return encodeURIComponent(p); }).join("/"); }
    function encode64(text) {
        if (typeof TextEncoder !== "undefined") {
            var bytes = new TextEncoder().encode(text), binary = "";
            bytes.forEach(function (b) { binary += String.fromCharCode(b); }); return btoa(binary);
        }
        return btoa(unescape(encodeURIComponent(text)));
    }
    function decode64(text) {
        var binary = atob(String(text || "").replace(/\s/g, ""));
        if (typeof TextDecoder !== "undefined") {
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
            return new TextDecoder().decode(bytes);
        }
        return decodeURIComponent(escape(binary));
    }
    function ghApi(args) {
        return m.runCore(["check"]).then(parseCheck).then(function (check) {
            var command = ["gh", "api"];
            if (check.host) command.push("--hostname", check.host);
            return cockpit.spawn(command.concat(args), { err: "message", superuser: null });
        });
    }
    function endpoint(current, ref) {
        var value = "repos/" + current.sourceRepo + "/contents/" + encodedPath(current.path);
        return ref ? value + "?ref=" + encodeURIComponent(current.branch) : value;
    }
    function fetchSharedManifest() {
        var current = syncForm();
        return ghApi([endpoint(current, true)]).then(function (out) {
            var object = JSON.parse(out || "{}");
            if (!object.content) throw new Error("The configured shared manifest is not initialized");
            var raw = JSON.parse(decode64(object.content));
            var shared = window.GHSyncSharedList;
            var manifest = shared && shared.normalizeManifest ? shared.normalizeManifest(raw) : raw;
            remoteManifest = manifest;
            return { current: current, manifest: manifest, sha: object.sha || "" };
        });
    }
    function writeSharedManifest(current, manifest, sha) {
        var args = ["--method", "PUT", endpoint(current, false),
            "-f", "message=Update ghsync repository groups from " + current.machine,
            "-f", "content=" + encode64(JSON.stringify(manifest, null, 2) + "\n"),
            "-f", "branch=" + current.branch];
        if (sha) args.push("-f", "sha=" + sha);
        return ghApi(args).then(function (out) {
            var result = JSON.parse(out || "{}");
            remoteManifest = manifest;
            return result;
        });
    }
    function cleanOrigin(value) {
        value = String(value || "").trim();
        if (/^https?:\/\//i.test(value)) {
            try { var url = new URL(value); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; value = url.toString(); }
            catch (e) { value = value.replace(/^(https?:\/\/)[^/@]+@/i, "$1").replace(/[?#].*$/, ""); }
        }
        return value;
    }
    function collectLocal() {
        return m.statusSnapshot().then(function (rows) {
            return m.mapLimit(rows, 6, function (row) {
                return m.runGit(row.name, ["remote", "get-url", "origin"]).then(function (origin) {
                    origin = cleanOrigin(origin);
                    return origin ? { name: row.name, url: origin } : null;
                }, function () { return null; });
            });
        }).then(function (entries) { return entries.filter(Boolean); });
    }

    function refreshSharedGroups(showMessage) {
        setBusy(true);
        if (showMessage) setStatus("Loading shared repository groups…");
        return fetchSharedManifest().then(function (remote) {
            render();
            var count = Object.keys(remote.manifest.groups || {}).length;
            if (showMessage) setStatus("Loaded " + count + " shared group" + (count === 1 ? "" : "s") + ".");
            return remote;
        }).catch(function (e) {
            if (showMessage) setStatus("Could not load shared groups: " + message(e), true);
            throw e;
        }).finally(function () { setBusy(false); });
    }
    function publishGroups() {
        var meta;
        setBusy(true); setStatus("Preparing shared group definitions…");
        return m.loadMeta().then(function (value) {
            meta = value;
            var names = definitions(meta).filter(function (name) { return (meta.groupDefinitions || []).indexOf(name) >= 0 || localMembers(meta, name).length; });
            if (!window.confirm("Replace the shared manifest's group definitions with these " + names.length + " local group(s)?\n\n" + (names.join("\n") || "(no groups)")))
                throw { cancelled: true };
            return Promise.all([fetchSharedManifest(), collectLocal()]);
        }).then(function (values) {
            var remote = values[0], entries = values[1], shared = window.GHSyncSharedList;
            var manifest = remote.manifest;
            if (shared && shared.mergeLocal) manifest = shared.mergeLocal(manifest, entries, remote.current);
            manifest.groups = sharedGroups(meta);
            manifest.updatedAt = new Date().toISOString();
            return writeSharedManifest(remote.current, manifest, remote.sha).then(function () { return manifest; });
        }).then(function (manifest) {
            remoteManifest = manifest;
            render();
            setStatus("Shared repository groups published successfully.");
            notify("success", "Repository groups published", Object.keys(manifest.groups || {}).length + " shared groups updated.");
        }).catch(function (e) {
            if (e && e.cancelled) return;
            setStatus("Could not publish groups: " + message(e), true);
            notify("danger", "Could not publish repository groups", message(e));
        }).finally(function () { setBusy(false); });
    }

    function pullGroup(group) {
        var meta, local = [], failures = [];
        setBusy(true); setStatus("Pulling " + group + "…");
        return Promise.all([m.loadMeta(), m.statusSnapshot()]).then(function (values) {
            meta = values[0];
            var wanted = effectiveMembers(meta, group), wantedSet = Object.create(null);
            wanted.forEach(function (name) { wantedSet[name] = true; });
            local = values[1].filter(function (row) { return wantedSet[row.name]; }).map(function (row) { return row.name; });
            if (!local.length) throw new Error("No local repositories are members of " + group);
            return m.mapLimit(local, 4, function (name) {
                return m.runCore(["pull", name]).catch(function (e) { failures.push(name + ": " + message(e)); });
            });
        }).then(function () {
            m.refreshMainPage();
            var summary = "Pulled " + local.length + " repositories in " + group;
            if (failures.length) summary += "; " + failures.length + " failed";
            setStatus(summary, !!failures.length);
            notify(failures.length ? "warning" : "success", "Group pull finished", summary, failures);
        }).catch(function (e) {
            setStatus("Group pull failed: " + message(e), true);
        }).finally(function () { setBusy(false); });
    }
    function pushGroup(group) {
        var pending = [], skipped = [], failures = [];
        setBusy(true); setStatus("Checking " + group + " for commits to push…");
        return Promise.all([m.loadMeta(), m.statusSnapshot()]).then(function (values) {
            var wanted = effectiveMembers(values[0], group), wantedSet = Object.create(null);
            wanted.forEach(function (name) { wantedSet[name] = true; });
            pending = values[1].filter(function (row) { return wantedSet[row.name] && row.ahead > 0 && row.branch !== "mirror" && row.branch !== "detached"; });
            if (!pending.length) throw new Error("No repositories in " + group + " are ahead of their upstream");
            if (!window.confirm("Push " + pending.length + " repositories in " + group + "?\n\n" + pending.map(function (row) { return row.name; }).join("\n")))
                throw { cancelled: true };
            return m.mapLimit(pending, 4, function (row) {
                return m.runGit(row.name, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
                    .then(function () { return m.runGit(row.name, ["push"]); })
                    .catch(function (e) {
                        var text = message(e);
                        if (/upstream|no upstream|no tracking/i.test(text)) skipped.push(row.name + ": no upstream");
                        else failures.push(row.name + ": " + text);
                    });
            });
        }).then(function () {
            m.refreshMainPage();
            var summary = "Push finished for " + group + ": " + (pending.length - failures.length - skipped.length) + " pushed";
            if (skipped.length) summary += ", " + skipped.length + " skipped";
            if (failures.length) summary += ", " + failures.length + " failed";
            setStatus(summary, !!failures.length);
            notify(failures.length ? "warning" : "success", "Group push finished", summary, skipped.concat(failures));
        }).catch(function (e) {
            if (e && e.cancelled) return;
            setStatus("Group push failed: " + message(e), true);
        }).finally(function () { setBusy(false); });
    }

    function localExists(path) {
        return cockpit.spawn(["test", "-e", path], { err: "ignore", superuser: null }).then(function () { return true; }, function () { return false; });
    }
    function cloneEntry(root, check, entry) {
        var base = root.replace(/\/$/, "") + "/" + entry.name, mirror = check.mirror === "true", dest = mirror ? base + ".git" : base;
        return Promise.all([localExists(base + "/.git"), localExists(base + ".git")]).then(function (present) {
            if (present[0] || present[1]) return { state: "exists", name: entry.name };
            var args = ["clone"];
            if (mirror) args.push("--mirror", "--quiet");
            else {
                args.push("--recurse-submodules", "--quiet");
                if (check.filter === "blob:none" || check.filter === "tree:0") args.push("--filter=" + check.filter);
                else if (/^depth:[1-9][0-9]*$/.test(check.filter || "")) args.push("--depth", check.filter.slice(6), "--no-single-branch");
            }
            args.push("--", entry.url, dest);
            return cockpit.spawn(["mkdir", "-p", dest.slice(0, dest.lastIndexOf("/"))], { err: "message", superuser: null })
                .then(function () { return cockpit.spawn(["git"].concat(args), { err: "message", superuser: null }); })
                .then(function () { return { state: "cloned", name: entry.name }; }, function (e) { return { state: "failed", name: entry.name, error: message(e) }; });
        });
    }
    function syncGroup(group) {
        var meta, entries = [], cloneResults = [], pullFailures = [];
        setBusy(true); setStatus("Synchronizing shared group " + group + "…");
        return Promise.all([m.loadMeta(), fetchSharedManifest(), m.runCore(["check"]).then(parseCheck), m.repositoryRoot()]).then(function (values) {
            meta = values[0]; var remote = values[1], check = values[2], root = values[3];
            var names = uniq((remote.manifest.groups || {})[group] || []), wanted = Object.create(null);
            names.forEach(function (name) { wanted[name] = true; });
            if (!names.length) throw new Error("Group " + group + " is not stored in the shared manifest or has no repositories");
            entries = (remote.manifest.repositories || []).filter(function (entry) { return wanted[entry.name]; });
            if (!entries.length) throw new Error("Shared group " + group + " has no repository definitions with clone URLs");
            var jobs = Math.max(1, Math.min(8, parseInt(check.jobs, 10) || 4));
            return m.mapLimit(entries, jobs, function (entry) { return cloneEntry(root, check, entry); });
        }).then(function (results) {
            cloneResults = results;
            var usable = results.filter(function (item) { return item.state !== "failed"; });
            return m.mapLimit(usable, 4, function (item) {
                return m.runCore(["pull", item.name]).catch(function (e) { pullFailures.push(item.name + ": " + message(e)); });
            });
        }).then(function () {
            entries.forEach(function (entry) { meta.groups[entry.name] = group; });
            if (meta.groupDefinitions.indexOf(group) < 0) meta.groupDefinitions.push(group);
            return m.saveMeta();
        }).then(function () {
            if (m.refreshGroups) m.refreshGroups();
            m.refreshMainPage();
            var cloned = cloneResults.filter(function (r) { return r.state === "cloned"; }).length;
            var failed = cloneResults.filter(function (r) { return r.state === "failed"; });
            var summary = "Synced " + group + ": " + cloned + " cloned, " + (cloneResults.length - cloned - failed.length) + " already present";
            if (failed.length) summary += ", " + failed.length + " clone failures";
            if (pullFailures.length) summary += ", " + pullFailures.length + " pull failures";
            setStatus(summary, !!(failed.length || pullFailures.length));
            notify((failed.length || pullFailures.length) ? "warning" : "success", "Group sync finished", summary,
                failed.map(function (r) { return r.name + ": " + r.error; }).concat(pullFailures));
            render();
        }).catch(function (e) {
            setStatus("Group sync failed: " + message(e), true);
            notify("danger", "Group sync failed", message(e));
        }).finally(function () { setBusy(false); });
    }

    function updateButtons() {
        var has = !!selectedGroup;
        ["btn-group-delete", "btn-group-save", "btn-group-pull", "btn-group-push", "btn-group-sync"].forEach(function (id) {
            var button = $(id); if (button) button.disabled = busy || !has;
        });
    }
    function render() {
        if (!panel) return;
        Promise.all([m.loadMeta(), m.statusSnapshot()]).then(function (values) {
            var meta = values[0], rows = values[1], groups = definitions(meta), select = $("groups-select");
            if (!select) return;
            if (!selectedGroup || groups.indexOf(selectedGroup) < 0) selectedGroup = groups[0] || "";
            select.textContent = "";
            if (!groups.length) {
                var none = document.createElement("option"); none.value = ""; none.textContent = "No groups yet"; select.appendChild(none);
            } else groups.forEach(function (name) {
                var option = document.createElement("option"); option.value = name; option.textContent = name; select.appendChild(option);
            });
            select.value = selectedGroup;
            var local = localMembers(meta, selectedGroup), remote = remoteMembers(selectedGroup);
            $("groups-summary").textContent = selectedGroup
                ? local.length + " local member" + (local.length === 1 ? "" : "s") + (remoteManifest ? " · " + remote.length + " shared" : "")
                : "Create a group to organize repositories.";

            var body = $("groups-members-body"); body.textContent = "";
            rows.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (row) {
                var tr = document.createElement("tr"), member = meta.groups[row.name] === selectedGroup;
                var checkCell = document.createElement("td"), cb = document.createElement("input");
                cb.type = "checkbox"; cb.className = "group-member-check"; cb.dataset.repo = row.name; cb.checked = member; cb.disabled = !selectedGroup;
                checkCell.appendChild(cb); tr.appendChild(checkCell);
                var name = document.createElement("td"); name.textContent = row.name; tr.appendChild(name);
                var current = document.createElement("td"); current.textContent = meta.groups[row.name] || "—"; tr.appendChild(current);
                var shared = document.createElement("td"); shared.textContent = remote.indexOf(row.name) >= 0 ? "Yes" : "—"; tr.appendChild(shared);
                body.appendChild(tr);
            });
            $("groups-empty").classList.toggle("ghs-hidden", rows.length > 0);
            updateButtons(); resize();
        }).catch(function (e) { setStatus("Could not render groups: " + message(e), true); });
    }

    function createGroup() {
        var name = window.prompt("New repository group name:", "");
        if (name === null) return;
        name = name.trim();
        if (!validGroup(name)) { setStatus("Group names may contain letters, numbers, dot, underscore and dash only.", true); return; }
        m.loadMeta().then(function (meta) {
            if (definitions(meta).indexOf(name) >= 0) throw new Error("Group " + name + " already exists");
            meta.groupDefinitions = uniq((meta.groupDefinitions || []).concat([name])).sort();
            return m.saveMeta();
        }).then(function () {
            selectedGroup = name;
            if (m.refreshGroups) m.refreshGroups();
            render(); setStatus("Created group " + name + ".");
        }).catch(function (e) { setStatus("Could not create group: " + message(e), true); });
    }
    function deleteGroup() {
        if (!selectedGroup) return;
        var name = selectedGroup;
        if (!window.confirm("Delete group " + name + " locally?\n\nRepositories will not be deleted. Push shared groups afterwards if you also want to remove it from the shared manifest.")) return;
        m.loadMeta().then(function (meta) {
            Object.keys(meta.groups || {}).forEach(function (repo) { if (meta.groups[repo] === name) delete meta.groups[repo]; });
            meta.groupDefinitions = (meta.groupDefinitions || []).filter(function (group) { return group !== name; });
            return m.saveMeta();
        }).then(function () {
            selectedGroup = ""; if (m.refreshGroups) m.refreshGroups(); render(); setStatus("Deleted local group " + name + ".");
        }).catch(function (e) { setStatus("Could not delete group: " + message(e), true); });
    }
    function saveMembership() {
        if (!selectedGroup) return;
        var names = Array.prototype.slice.call(document.querySelectorAll("#groups-members-body .group-member-check:checked"))
            .map(function (cb) { return cb.dataset.repo; });
        m.loadMeta().then(function (meta) { setMembers(meta, selectedGroup, names); return m.saveMeta(); }).then(function () {
            if (m.refreshGroups) m.refreshGroups();
            render(); setStatus("Saved membership for " + selectedGroup + ".");
        }).catch(function (e) { setStatus("Could not save group membership: " + message(e), true); });
    }

    function openPanel() {
        document.querySelectorAll(".ghs-tab").forEach(function (item) {
            var on = item === tab; item.classList.toggle("ghs-tab--current", on); item.setAttribute("aria-selected", on ? "true" : "false");
        });
        document.querySelectorAll(".ghs-tab-panel").forEach(function (item) { item.classList.add("ghs-hidden"); });
        panel.classList.remove("ghs-hidden"); render(); resize();
    }
    function createUi() {
        if ($("panel-groups")) return;
        var tabs = document.querySelector(".ghs-tabs"), settingsTab = document.querySelector('.ghs-tab[data-tab="settings"]'), settingsPanel = $("panel-settings");
        if (!tabs || !settingsPanel || !settingsPanel.parentNode) return;
        tab = document.createElement("button"); tab.type = "button"; tab.className = "ghs-tab"; tab.dataset.tab = "groups";
        tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", "false"); tab.textContent = "Groups";
        tabs.insertBefore(tab, settingsTab || null);
        panel = document.createElement("section"); panel.id = "panel-groups"; panel.className = "ghs-tab-panel ghs-hidden"; panel.setAttribute("role", "tabpanel");
        panel.innerHTML =
            '<div class="ghs-form">' +
            '<div class="ghs-form-group"><span class="ghs-label">Repository groups</span><p class="ghs-helper">Organize repositories into named groups and run safe group-scoped operations. Group membership is local until you explicitly publish it to the shared manifest.</p></div>' +
            '<div class="ghs-toolbar"><select id="groups-select" class="ghs-input ghs-input--narrow" aria-label="Repository group"></select>' +
            '<button id="btn-group-new" class="ghs-btn ghs-btn--secondary ghs-btn--sm" type="button">New group</button>' +
            '<button id="btn-group-delete" class="ghs-btn ghs-btn--link ghs-btn--sm" type="button">Delete group</button>' +
            '<span class="ghs-toolbar__spacer"></span>' +
            '<button id="btn-groups-shared-refresh" class="ghs-btn ghs-btn--secondary ghs-btn--sm" type="button">Refresh shared groups</button>' +
            '<button id="btn-groups-shared-push" class="ghs-btn ghs-btn--secondary ghs-btn--sm" type="button">Push groups to shared manifest</button></div>' +
            '<p id="groups-summary" class="ghs-helper"></p>' +
            '<div class="ghs-form-actions"><button id="btn-group-pull" class="ghs-btn ghs-btn--secondary" type="button">Pull group</button>' +
            '<button id="btn-group-push" class="ghs-btn ghs-btn--secondary" type="button">Push group</button>' +
            '<button id="btn-group-sync" class="ghs-btn ghs-btn--primary" type="button">Sync group</button></div>' +
            '<p class="ghs-helper">Sync group uses the shared manifest to clone missing group repositories, then performs the same safe fast-forward pull used by ghsync. Nothing is deleted locally.</p>' +
            '<div class="ghs-table-wrap"><table class="ghs-table"><thead><tr><th>Member</th><th>Repository</th><th>Local group</th><th>Shared member</th></tr></thead><tbody id="groups-members-body"></tbody></table></div>' +
            '<div id="groups-empty" class="ghs-empty ghs-hidden"><h3 class="ghs-empty__title">No local repositories</h3><p class="ghs-empty__body">Clone or sync repositories before assigning local group membership.</p></div>' +
            '<div class="ghs-form-actions"><button id="btn-group-save" class="ghs-btn ghs-btn--primary" type="button">Save membership</button></div>' +
            '<p id="groups-status" class="ghs-helper"></p></div>';
        settingsPanel.parentNode.insertBefore(panel, settingsPanel);
        tab.onclick = openPanel;
        new MutationObserver(function () {
            var current = tabs.querySelector('.ghs-tab--current:not([data-tab="groups"])');
            if (current && !panel.classList.contains("ghs-hidden")) {
                panel.classList.add("ghs-hidden"); tab.classList.remove("ghs-tab--current"); tab.setAttribute("aria-selected", "false");
            }
        }).observe(tabs, { subtree: true, attributes: true, attributeFilter: ["class", "aria-selected"] });
        $("groups-select").onchange = function () { selectedGroup = this.value; render(); };
        $("btn-group-new").onclick = createGroup;
        $("btn-group-delete").onclick = deleteGroup;
        $("btn-group-save").onclick = saveMembership;
        $("btn-group-pull").onclick = function () { if (selectedGroup) pullGroup(selectedGroup); };
        $("btn-group-push").onclick = function () { if (selectedGroup) pushGroup(selectedGroup); };
        $("btn-group-sync").onclick = function () { if (selectedGroup) syncGroup(selectedGroup); };
        $("btn-groups-shared-refresh").onclick = function () { refreshSharedGroups(true).catch(function () {}); };
        $("btn-groups-shared-push").onclick = publishGroups;
        render();
    }

    window.GHSyncGroups = {
        definitions: definitions,
        localMembers: localMembers,
        effectiveMembers: effectiveMembers,
        setMembers: setMembers,
        sharedGroups: sharedGroups
    };
    createUi();
})();
