/* Shared repository-list synchronization across multiple PCs. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.statusSnapshot || !m.mapLimit) return;

    function $(id) { return document.getElementById(id); }

    var cfg = {
        sourceRepo: "",
        branch: "main",
        path: "ghsync-repositories.json",
        machine: "",
        groups: [],
        autoPull: false,
        lastSyncAt: "",
        lastStatus: "",
        lastRevision: ""
    };
    var configPath = "", cachePath = "", check = null, busy = false;
    var tab = null, panel = null;

    function resize() { try { cockpit.transport.control("size-change"); } catch (e) { /* standalone */ } }
    function uniq(values) {
        var seen = Object.create(null), out = [];
        (values || []).forEach(function (value) {
            value = String(value || "").trim();
            if (!value || seen[value]) return;
            seen[value] = true; out.push(value);
        });
        return out;
    }
    function groups(value) { return uniq(String(value || "").split(/[\s,]+/)); }
    function dirname(path) { return (path || "").replace(/\/[^/]*$/, "") || "."; }
    function status(text, bad) {
        var el = $("sync-status");
        if (el) { el.textContent = text || ""; el.className = "ghs-helper" + (bad ? " ghs-t-red" : ""); }
        resize();
    }
    function notify(variant, title, body, details) {
        if (window.GHSyncNotifications && window.GHSyncNotifications.add) {
            window.GHSyncNotifications.add({ variant: variant, title: title, body: body || "", details: details || [], source: "sync" });
        }
    }
    function setBusy(on) {
        busy = on;
        ["btn-sync-config-save", "btn-shared-pull", "btn-shared-push", "btn-shared-reconcile"].forEach(function (id) {
            if ($(id)) $(id).disabled = on;
        });
    }
    function safeConfig(value) {
        value = value && typeof value === "object" ? value : {};
        return {
            sourceRepo: String(value.sourceRepo || ""), branch: String(value.branch || "main"),
            path: String(value.path || "ghsync-repositories.json"), machine: String(value.machine || ""),
            groups: uniq(Array.isArray(value.groups) ? value.groups : []), autoPull: value.autoPull === true,
            lastSyncAt: String(value.lastSyncAt || ""), lastStatus: String(value.lastStatus || ""),
            lastRevision: String(value.lastRevision || "")
        };
    }
    function readCheck(force) {
        if (check && !force) return Promise.resolve(check);
        var values = {};
        return m.runCore(["check"]).then(function (out) {
            out.split("\n").forEach(function (line) {
                var f = line.split("\t"); if (f[0] === "check") values[f[1]] = f[2] || "";
            });
            check = values;
            if (values.config) {
                var base = dirname(values.config);
                configPath = base + "/repository-sync.json";
                cachePath = base + "/repository-sync-cache.json";
            }
            return values;
        });
    }
    function readText(path) {
        if (!path) return Promise.resolve("");
        return cockpit.spawn(["cat", "--", path], { err: "ignore", superuser: null }).catch(function () { return ""; });
    }
    function writeText(path, text) {
        if (!path) return Promise.reject(new Error("The sync configuration path is unknown"));
        return cockpit.spawn(["mkdir", "-p", "--", dirname(path)], { err: "message", superuser: null })
            .then(function () { return cockpit.file(path).replace(text); });
    }
    function fromForm() {
        var next = safeConfig({
            sourceRepo: $("sync-source-repo").value.trim(), branch: $("sync-source-branch").value.trim() || "main",
            path: $("sync-source-path").value.trim() || "ghsync-repositories.json", machine: $("sync-machine").value.trim(),
            groups: groups($("sync-groups").value), autoPull: $("sync-auto-pull").checked,
            lastSyncAt: cfg.lastSyncAt, lastStatus: cfg.lastStatus, lastRevision: cfg.lastRevision
        });
        if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(next.sourceRepo)) throw new Error("Configuration repository must be owner/repository");
        if (!next.machine || /[\r\n\t]/.test(next.machine)) throw new Error("Machine ID is required");
        if (!next.branch || /[\r\n\t]/.test(next.branch)) throw new Error("Branch is required");
        if (!next.path || next.path.charAt(0) === "/" || /(^|\/)\.\.(\/|$)/.test(next.path) || !/^[A-Za-z0-9._/-]+$/.test(next.path))
            throw new Error("Manifest path must be a safe repository-relative path");
        return next;
    }
    function fillForm() {
        if (!$("sync-source-repo")) return;
        $("sync-source-repo").value = cfg.sourceRepo; $("sync-source-branch").value = cfg.branch;
        $("sync-source-path").value = cfg.path; $("sync-machine").value = cfg.machine;
        $("sync-groups").value = cfg.groups.join(" "); $("sync-auto-pull").checked = cfg.autoPull;
        renderLast();
    }
    function renderLast() {
        if (!$("sync-last-time")) return;
        if (!cfg.lastSyncAt) $("sync-last-time").textContent = "Never";
        else {
            var d = new Date(cfg.lastSyncAt);
            $("sync-last-time").textContent = isNaN(d.getTime()) ? cfg.lastSyncAt : d.toLocaleString();
            $("sync-last-time").title = cfg.lastSyncAt;
        }
        $("sync-last-result").textContent = cfg.lastStatus || "No shared-list operation has run yet.";
        $("sync-last-revision").textContent = cfg.lastRevision || "—";
    }
    function saveConfig(message) {
        cfg = fromForm();
        return writeText(configPath, JSON.stringify(cfg, null, 2) + "\n").then(function () {
            if (message) status(message); renderLast(); return cfg;
        });
    }
    function markLast(message, revision) {
        cfg.lastSyncAt = new Date().toISOString(); cfg.lastStatus = message || "";
        if (revision !== undefined) cfg.lastRevision = revision || "";
        fillForm();
        return writeText(configPath, JSON.stringify(cfg, null, 2) + "\n");
    }
    function loadConfig() {
        return Promise.all([
            readCheck(),
            cockpit.spawn(["hostname", "-s"], { err: "ignore", superuser: null }).catch(function () { return ""; })
        ]).then(function (values) {
            return readText(configPath).then(function (text) {
                if (text.trim()) { try { cfg = safeConfig(JSON.parse(text)); } catch (e) { status("Could not parse sync configuration: " + e.message, true); } }
                if (!cfg.machine) cfg.machine = values[1].trim() || "this-machine";
                fillForm(); return cfg;
            });
        });
    }

    function cleanOrigin(value) {
        value = String(value || "").trim();
        if (!value) return "";
        if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
            try {
                var url = new URL(value); if (/^https?:$/i.test(url.protocol)) url.username = "";
                url.password = ""; url.search = ""; url.hash = ""; value = url.toString();
            } catch (e) { value = value.replace(/^(https?:\/\/)[^/@]+@/i, "$1").replace(/[?#].*$/, ""); }
        }
        return value;
    }
    function validEntry(name, url) {
        return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name) && !!url && url.charAt(0) !== "-" && !/[\r\n\t]/.test(url);
    }
    function collectLocal() {
        return m.statusSnapshot().then(function (rows) {
            return m.mapLimit(rows, 6, function (row) {
                return m.runGit(row.name, ["remote", "get-url", "origin"]).then(function (origin) {
                    origin = cleanOrigin(origin); return validEntry(row.name, origin) ? { name: row.name, url: origin } : null;
                }, function () { return null; });
            });
        }).then(function (entries) { return entries.filter(Boolean).sort(function (a, b) { return a.name.localeCompare(b.name); }); });
    }
    function blankManifest() { return { version: 1, repositories: [], groups: {}, machines: {} }; }
    function normalizeManifest(raw) {
        if (!raw || typeof raw !== "object") throw new Error("Shared manifest is not a JSON object");
        if (Number(raw.version || 1) !== 1) throw new Error("Unsupported shared manifest version");
        var out = blankManifest(), positions = Object.create(null);
        if (raw.groups && typeof raw.groups === "object" && !Array.isArray(raw.groups)) {
            Object.keys(raw.groups).forEach(function (name) {
                if (!/^[A-Za-z0-9._-]+$/.test(name) || !Array.isArray(raw.groups[name])) return;
                out.groups[name] = uniq(raw.groups[name]).filter(function (repo) { return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo); });
            });
        }
        if (raw.machines && typeof raw.machines === "object" && !Array.isArray(raw.machines)) {
            Object.keys(raw.machines).forEach(function (name) {
                var machine = raw.machines[name]; if (!machine || typeof machine !== "object" || Array.isArray(machine)) machine = {};
                out.machines[name] = { groups: uniq(Array.isArray(machine.groups) ? machine.groups : []) };
            });
        }
        (Array.isArray(raw.repositories) ? raw.repositories : []).forEach(function (item) {
            if (!item || typeof item !== "object") return;
            var name = String(item.name || "").trim(), url = cleanOrigin(item.url || "");
            if (!validEntry(name, url)) return;
            var entry = { name: name, url: url, machines: item.machines === "all" ? "all" : uniq(Array.isArray(item.machines) ? item.machines : []) };
            if (Array.isArray(item.groups)) entry.groups = uniq(item.groups);
            if (Object.prototype.hasOwnProperty.call(positions, name)) out.repositories[positions[name]] = entry;
            else { positions[name] = out.repositories.length; out.repositories.push(entry); }
        });
        out.repositories.sort(function (a, b) { return a.name.localeCompare(b.name); });
        if (raw.updatedAt) out.updatedAt = String(raw.updatedAt);
        return out;
    }
    function assignmentContext(manifest, machine, localGroups) {
        var selected = [];
        if (manifest.machines[machine] && Array.isArray(manifest.machines[machine].groups)) selected = selected.concat(manifest.machines[machine].groups);
        selected = uniq(selected.concat(localGroups || []));
        var repos = Object.create(null);
        selected.forEach(function (group) { (manifest.groups[group] || []).forEach(function (name) { repos[name] = true; }); });
        return { groups: selected, repositories: repos };
    }
    function assigned(manifest, machine, localGroups) {
        var context = assignmentContext(manifest, machine, localGroups);
        return manifest.repositories.filter(function (entry) {
            return entry.machines === "all" ||
                (Array.isArray(entry.machines) && entry.machines.indexOf(machine) >= 0) ||
                context.repositories[entry.name] ||
                (Array.isArray(entry.groups) && entry.groups.some(function (group) { return context.groups.indexOf(group) >= 0; }));
        });
    }
    function groupReferences(manifest) {
        var refs = Object.create(null);
        Object.keys(manifest.groups).forEach(function (group) { manifest.groups[group].forEach(function (name) { refs[name] = true; }); });
        manifest.repositories.forEach(function (entry) { if (Array.isArray(entry.groups) && entry.groups.length) refs[entry.name] = true; });
        return refs;
    }
    function mergeLocal(manifest, entries, current) {
        manifest = normalizeManifest(manifest);
        var local = Object.create(null), seen = Object.create(null);
        entries.forEach(function (entry) { local[entry.name] = entry; });
        manifest.machines[current.machine] = manifest.machines[current.machine] || { groups: [] };
        manifest.machines[current.machine].groups = uniq(current.groups || []);
        var grouped = assignmentContext(manifest, current.machine, current.groups).repositories;
        manifest.repositories.forEach(function (entry) {
            seen[entry.name] = true;
            if (local[entry.name]) entry.url = local[entry.name].url;
            if (entry.machines === "all") return;
            var machines = uniq(Array.isArray(entry.machines) ? entry.machines : []), pos = machines.indexOf(current.machine);
            if (local[entry.name]) { if (pos < 0 && !grouped[entry.name]) machines.push(current.machine); }
            else if (pos >= 0) machines.splice(pos, 1);
            entry.machines = machines;
        });
        entries.forEach(function (entry) {
            if (!seen[entry.name]) manifest.repositories.push({ name: entry.name, url: entry.url, machines: [current.machine] });
        });
        var refs = groupReferences(manifest);
        manifest.repositories = manifest.repositories.filter(function (entry) {
            return entry.machines === "all" || (Array.isArray(entry.machines) && entry.machines.length) || refs[entry.name];
        }).sort(function (a, b) { return a.name.localeCompare(b.name); });
        manifest.updatedAt = new Date().toISOString();
        return manifest;
    }
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
    function encodedPath(path) { return path.split("/").map(function (part) { return encodeURIComponent(part); }).join("/"); }
    function endpoint(current, ref) {
        var value = "repos/" + current.sourceRepo + "/contents/" + encodedPath(current.path);
        return ref ? value + "?ref=" + encodeURIComponent(current.branch) : value;
    }
    function ghApi(args) {
        var command = ["gh", "api"];
        if (check && check.host) command.push("--hostname", check.host);
        return cockpit.spawn(command.concat(args), { err: "message", superuser: null });
    }
    function fetchRemote(current, allowMissing) {
        return ghApi([endpoint(current, true)]).then(function (out) {
            var object = JSON.parse(out);
            if (!object || object.type !== "file" || !object.content) throw new Error("Shared manifest path is not a readable file");
            return { manifest: normalizeManifest(JSON.parse(decode64(object.content))), sha: object.sha || "" };
        }).catch(function (e) {
            if (allowMissing && /404|Not Found/i.test(e.message || String(e))) return { manifest: blankManifest(), sha: "" };
            throw e;
        });
    }
    function writeRemote(current, manifest, sha) {
        manifest = normalizeManifest(manifest);
        var args = ["--method", "PUT", endpoint(current, false),
            "-f", "message=Update ghsync repository list from " + current.machine,
            "-f", "content=" + encode64(JSON.stringify(manifest, null, 2) + "\n"),
            "-f", "branch=" + current.branch];
        if (sha) args.push("-f", "sha=" + sha);
        return ghApi(args).then(function (out) {
            var result = JSON.parse(out);
            return { manifest: manifest, sha: result && result.content ? (result.content.sha || "") : "" };
        });
    }
    function cache(manifest) {
        return cachePath ? writeText(cachePath, JSON.stringify(normalizeManifest(manifest), null, 2) + "\n") : Promise.resolve();
    }
    function localExists(path) {
        return cockpit.spawn(["test", "-e", path], { err: "ignore", superuser: null }).then(function () { return true; }, function () { return false; });
    }
    function cloneOne(root, values, entry) {
        var base = root.replace(/\/$/, "") + "/" + entry.name, mirror = values.mirror === "true", dest = mirror ? base + ".git" : base;
        return Promise.all([localExists(base + "/.git"), localExists(base + ".git")]).then(function (present) {
            if (present[0] || present[1]) return { state: "exists", name: entry.name };
            var args = ["clone"];
            if (mirror) args.push("--mirror", "--quiet");
            else {
                args.push("--recurse-submodules", "--quiet");
                if (values.filter === "blob:none" || values.filter === "tree:0") args.push("--filter=" + values.filter);
                else if (/^depth:[1-9][0-9]*$/.test(values.filter || "")) args.push("--depth", values.filter.slice(6), "--no-single-branch");
            }
            args.push("--", entry.url, dest);
            return cockpit.spawn(["mkdir", "-p", "--", dirname(dest)], { err: "message", superuser: null })
                .then(function () { return cockpit.spawn(["git"].concat(args), { err: "message", superuser: null }); })
                .then(function () { return { state: "cloned", name: entry.name }; }, function (e) {
                    return { state: "failed", name: entry.name, error: e.message || String(e) };
                });
        });
    }
    function reconcile(manifest, current) {
        var wanted = assigned(manifest, current.machine, current.groups);
        return Promise.all([m.repositoryRoot(), readCheck(), m.statusSnapshot()]).then(function (values) {
            var root = values[0], localConfig = values[1], rows = values[2], wantedSet = Object.create(null);
            wanted.forEach(function (entry) { wantedSet[entry.name] = true; });
            var extras = rows.filter(function (row) { return !wantedSet[row.name]; }).length;
            var jobs = Math.max(1, Math.min(16, parseInt(localConfig.jobs, 10) || 4));
            return m.mapLimit(wanted, jobs, function (entry) { return cloneOne(root, localConfig, entry); }).then(function (results) {
                var result = { cloned: 0, existing: 0, failed: [], extra: extras, assigned: wanted.length };
                results.forEach(function (item) {
                    if (item.state === "cloned") result.cloned += 1;
                    else if (item.state === "exists") result.existing += 1;
                    else result.failed.push(item);
                });
                return result;
            });
        });
    }
    function pullList() {
        var current;
        try { current = fromForm(); cfg = current; } catch (e) { return Promise.reject(e); }
        setBusy(true); status("Pulling shared repository list…");
        return saveConfig().then(function () { return fetchRemote(current, false); }).then(function (remote) {
            var count = assigned(remote.manifest, current.machine, current.groups).length;
            var names = Object.keys(remote.manifest.groups).sort();
            var summary = "Pulled " + remote.manifest.repositories.length + " shared repositories; " + count + " assigned to " + current.machine;
            if (names.length) summary += ". Groups: " + names.join(", ");
            return cache(remote.manifest).then(function () { return markLast(summary, remote.sha); }).then(function () {
                status(summary); notify("success", "Shared repository list pulled", summary); return remote;
            });
        }).catch(function (e) {
            status("Pull failed: " + (e.message || String(e)), true); notify("danger", "Could not pull shared repository list", e.message || String(e)); throw e;
        }).finally(function () { setBusy(false); });
    }
    function pushList() {
        var current;
        try { current = fromForm(); cfg = current; } catch (e) { return Promise.reject(e); }
        setBusy(true); status("Reading local repositories…");
        return saveConfig().then(collectLocal).then(function (entries) {
            if (!entries.length) throw new Error("No local repositories with usable origins were found");
            status("Loading current shared manifest…");
            return fetchRemote(current, true).then(function (remote) { return writeRemote(current, mergeLocal(remote.manifest, entries, current), remote.sha); });
        }).then(function (written) {
            var count = assigned(written.manifest, current.machine, current.groups).length;
            var summary = "Pushed repository list; " + count + " repositories assigned to " + current.machine;
            return cache(written.manifest).then(function () { return markLast(summary, written.sha); }).then(function () {
                status(summary); notify("success", "Shared repository list pushed", summary); return written;
            });
        }).catch(function (e) {
            status("Push failed: " + (e.message || String(e)), true); notify("danger", "Could not push shared repository list", e.message || String(e)); throw e;
        }).finally(function () { setBusy(false); });
    }
    function syncNow(options) {
        options = options || {};
        var current;
        try { current = fromForm(); cfg = current; } catch (e) { return Promise.reject(e); }
        setBusy(true); status("Synchronizing shared repository list…");
        return saveConfig().then(function () { return fetchRemote(current, false); }).then(function (remote) {
            return cache(remote.manifest).then(function () { return reconcile(remote.manifest, current); }).then(function (result) {
                var summary = result.cloned + " cloned, " + result.existing + " already present";
                if (result.extra) summary += ", " + result.extra + " local not assigned (kept)";
                if (result.failed.length) summary += ", " + result.failed.length + " failed";
                return markLast(summary, remote.sha).then(function () {
                    status(summary, !!result.failed.length);
                    if (!options.silent || result.failed.length) notify(result.failed.length ? "danger" : "success",
                        result.failed.length ? "Repository-list sync incomplete" : "Repository list synchronized", summary,
                        result.failed.map(function (r) { return r.name + ": " + r.error; }).slice(0, 20));
                    m.refreshMainPage();
                    if (result.failed.length) throw new Error(summary);
                    return result;
                });
            });
        }).catch(function (e) {
            if (!/^\d+ cloned,/.test(e.message || "")) {
                status("Sync failed: " + (e.message || String(e)), true); notify("danger", "Could not synchronize repository list", e.message || String(e));
            }
            throw e;
        }).finally(function () { setBusy(false); });
    }
    function createUi() {
        if ($("panel-sync")) return;
        var tabs = document.querySelector(".ghs-tabs"), settingsTab = document.querySelector('.ghs-tab[data-tab="settings"]'), settingsPanel = $("panel-settings");
        if (!tabs || !settingsPanel || !settingsPanel.parentNode) return;

        tab = document.createElement("button");
        tab.className = "ghs-tab"; tab.type = "button"; tab.dataset.tab = "sync"; tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", "false"); tab.textContent = "Sync";
        tabs.insertBefore(tab, settingsTab || null);

        panel = document.createElement("section"); panel.id = "panel-sync"; panel.className = "ghs-tab-panel ghs-hidden"; panel.setAttribute("role", "tabpanel");
        panel.innerHTML =
            '<div class="ghs-form">' +
            '<div class="ghs-form-group"><span class="ghs-label">Shared repository list</span>' +
            '<p class="ghs-helper">Use a GitHub repository as the source of truth for repository membership across PCs. Private repositories are supported through the existing gh login.</p></div>' +
            '<div class="ghs-form-group"><label class="ghs-label" for="sync-source-repo">Configuration repository</label>' +
            '<input id="sync-source-repo" class="ghs-input" type="text" placeholder="owner/repository">' +
            '<p class="ghs-helper">Repository that stores the shared manifest.</p></div>' +
            '<div class="ghs-form-row">' +
            '<div class="ghs-form-group"><label class="ghs-label" for="sync-source-branch">Branch</label><input id="sync-source-branch" class="ghs-input" type="text" placeholder="main"></div>' +
            '<div class="ghs-form-group"><label class="ghs-label" for="sync-source-path">Manifest path</label><input id="sync-source-path" class="ghs-input" type="text" placeholder="ghsync-repositories.json"></div>' +
            '<div class="ghs-form-group"><label class="ghs-label" for="sync-machine">Machine ID</label><input id="sync-machine" class="ghs-input" type="text" placeholder="workshop-mini-pc"></div>' +
            '<div class="ghs-form-group"><label class="ghs-label" for="sync-groups">Machine groups</label><input id="sync-groups" class="ghs-input" type="text" placeholder="development"></div>' +
            '</div>' +
            '<div class="ghs-form-group"><span class="ghs-label">Behaviour</span><label class="ghs-switch">' +
            '<input id="sync-auto-pull" type="checkbox"><span class="ghs-switch__track"><span class="ghs-switch__thumb"></span></span>' +
            '<span class="ghs-switch__text">Pull and reconcile the shared list before Full sync from this Cockpit page</span></label></div>' +
            '<div class="ghs-form-actions"><button id="btn-sync-config-save" class="ghs-btn ghs-btn--primary" type="button">Save sync settings</button></div>' +
            '<div class="ghs-form-group"><span class="ghs-label">Shared-list actions</span><div class="ghs-form-actions">' +
            '<button id="btn-shared-pull" class="ghs-btn ghs-btn--secondary" type="button">Pull list</button>' +
            '<button id="btn-shared-push" class="ghs-btn ghs-btn--secondary" type="button">Push list</button>' +
            '<button id="btn-shared-reconcile" class="ghs-btn ghs-btn--primary" type="button">Sync now</button></div>' +
            '<p class="ghs-helper">Sync now pulls the manifest and clones assigned repositories that are missing. Repositories no longer assigned to this machine are kept on disk.</p></div>' +
            '<div class="ghs-form-group"><span class="ghs-label">Last shared-list operation</span><dl class="ghs-dl">' +
            '<div class="ghs-dl__group"><dt class="ghs-dl__term">Time</dt><dd class="ghs-dl__desc" id="sync-last-time">Never</dd></div>' +
            '<div class="ghs-dl__group"><dt class="ghs-dl__term">Result</dt><dd class="ghs-dl__desc" id="sync-last-result">No shared-list operation has run yet.</dd></div>' +
            '<div class="ghs-dl__group"><dt class="ghs-dl__term">Revision</dt><dd class="ghs-dl__desc ghs-mono" id="sync-last-revision">—</dd></div>' +
            '</dl></div><p id="sync-status" class="ghs-helper"></p></div>';
        settingsPanel.parentNode.insertBefore(panel, settingsPanel);

        tab.onclick = function () {
            document.querySelectorAll(".ghs-tab").forEach(function (item) {
                var on = item === tab; item.classList.toggle("ghs-tab--current", on); item.setAttribute("aria-selected", on ? "true" : "false");
            });
            document.querySelectorAll(".ghs-tab-panel").forEach(function (item) { item.classList.add("ghs-hidden"); });
            panel.classList.remove("ghs-hidden"); renderLast(); resize();
        };
        new MutationObserver(function () {
            var current = tabs.querySelector('.ghs-tab--current:not([data-tab="sync"])');
            if (current && !panel.classList.contains("ghs-hidden")) {
                panel.classList.add("ghs-hidden"); tab.classList.remove("ghs-tab--current"); tab.setAttribute("aria-selected", "false");
            }
        }).observe(tabs, { subtree: true, attributes: true, attributeFilter: ["class", "aria-selected"] });

        $("btn-sync-config-save").onclick = function () {
            saveConfig("Sync settings saved").catch(function (e) { status("Could not save sync settings: " + (e.message || String(e)), true); });
        };
        $("btn-shared-pull").onclick = function () { pullList().catch(function () {}); };
        $("btn-shared-push").onclick = function () { pushList().catch(function () {}); };
        $("btn-shared-reconcile").onclick = function () { syncNow().catch(function () {}); };
    }
    function hookFullSync() {
        var button = $("btn-sync");
        if (!button || button.dataset.sharedListHook === "yes") return;
        button.dataset.sharedListHook = "yes";
        var original = button.onclick;
        button.onclick = function (event) {
            if (!cfg.autoPull || !cfg.sourceRepo || busy) { if (original) return original.call(button, event); return; }
            fillForm();
            syncNow({ silent: true }).then(function () { if (original) original.call(button, event); }).catch(function () {
                status("Full sync was not started because the shared repository list could not be synchronized.", true);
            });
        };
    }

    createUi();
    window.GHSyncSharedList = { normalizeManifest: normalizeManifest, assigned: assigned, mergeLocal: mergeLocal };
    loadConfig().then(hookFullSync).catch(function (e) { status("Could not load sync configuration: " + (e.message || String(e)), true); hookFullSync(); });
    resize();
})();
