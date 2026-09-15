/* Fleet / Machines view backed by the shared repository manifest and a telemetry sidecar. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.statusSnapshot || !m.runCore) return;

    var STALE_MS = 24 * 60 * 60 * 1000;
    var OFFLINE_MS = 7 * 24 * 60 * 60 * 1000;
    var HEARTBEAT_MS = 5 * 60 * 1000;
    var tab = null, panel = null, busy = false, snapshot = null, reportTimer = null;

    function $(id) { return document.getElementById(id); }
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
    function dirname(path) { return (path || "").replace(/\/[^/]*$/, "") || "."; }
    function telemetryPath(path) {
        path = String(path || "ghsync-repositories.json");
        return path.replace(/\.json$/i, "") + ".machines.json";
    }
    function safeSyncConfig(value) {
        value = value && typeof value === "object" ? value : {};
        return {
            sourceRepo: String(value.sourceRepo || ""),
            branch: String(value.branch || "main"),
            path: String(value.path || "ghsync-repositories.json"),
            machine: String(value.machine || ""),
            groups: uniq(Array.isArray(value.groups) ? value.groups : []),
            lastSyncAt: String(value.lastSyncAt || ""),
            lastStatus: String(value.lastStatus || "")
        };
    }
    function validConfig(current) {
        return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(current.sourceRepo) && !!current.machine;
    }
    function cleanOrigin(value) {
        value = String(value || "").trim();
        if (!value) return "";
        if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
            try {
                var url = new URL(value);
                if (/^https?:$/i.test(url.protocol)) url.username = "";
                url.password = ""; url.search = ""; url.hash = ""; value = url.toString();
            } catch (e) { value = value.replace(/^(https?:\/\/)[^/@]+@/i, "$1").replace(/[?#].*$/, ""); }
        }
        return value;
    }
    function validRepo(name, url) {
        return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name) && !!url && !/[\r\n\t]/.test(url);
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
                var machine = raw.machines[name];
                if (!machine || typeof machine !== "object" || Array.isArray(machine)) machine = {};
                out.machines[name] = { groups: uniq(Array.isArray(machine.groups) ? machine.groups : []) };
            });
        }
        (Array.isArray(raw.repositories) ? raw.repositories : []).forEach(function (item) {
            if (!item || typeof item !== "object") return;
            var name = String(item.name || "").trim(), url = cleanOrigin(item.url || "");
            if (!validRepo(name, url)) return;
            var entry = {
                name: name,
                url: url,
                machines: item.machines === "all" ? "all" : uniq(Array.isArray(item.machines) ? item.machines : [])
            };
            if (Array.isArray(item.groups)) entry.groups = uniq(item.groups);
            if (Object.prototype.hasOwnProperty.call(positions, name)) out.repositories[positions[name]] = entry;
            else { positions[name] = out.repositories.length; out.repositories.push(entry); }
        });
        out.repositories.sort(function (a, b) { return a.name.localeCompare(b.name); });
        return out;
    }
    function normalizeTelemetry(raw) {
        var out = { version: 1, machines: {}, updatedAt: "" };
        if (!raw || typeof raw !== "object") return out;
        if (Number(raw.version || 1) !== 1) return out;
        var machines = raw.machines && typeof raw.machines === "object" && !Array.isArray(raw.machines) ? raw.machines : {};
        Object.keys(machines).forEach(function (name) {
            var item = machines[name];
            if (!item || typeof item !== "object" || Array.isArray(item)) return;
            out.machines[name] = {
                groups: uniq(Array.isArray(item.groups) ? item.groups : []),
                lastSeenAt: String(item.lastSeenAt || ""),
                lastSuccessfulSyncAt: String(item.lastSuccessfulSyncAt || ""),
                lastStatus: String(item.lastStatus || ""),
                status: String(item.status || "unknown"),
                assignedCount: Math.max(0, parseInt(item.assignedCount, 10) || 0),
                presentCount: Math.max(0, parseInt(item.presentCount, 10) || 0),
                extraCount: Math.max(0, parseInt(item.extraCount, 10) || 0),
                missingRepositories: uniq(Array.isArray(item.missingRepositories) ? item.missingRepositories : []),
                attentionRepositories: uniq(Array.isArray(item.attentionRepositories) ? item.attentionRepositories : []),
                manifestRevision: String(item.manifestRevision || "")
            };
        });
        out.updatedAt = String(raw.updatedAt || "");
        return out;
    }
    function machineGroups(manifest, telemetry, name, current) {
        var values = [];
        if (manifest.machines[name] && Array.isArray(manifest.machines[name].groups)) values = values.concat(manifest.machines[name].groups);
        if (telemetry.machines[name] && Array.isArray(telemetry.machines[name].groups)) values = values.concat(telemetry.machines[name].groups);
        if (current && current.machine === name) values = values.concat(current.groups || []);
        return uniq(values);
    }
    function assignmentContext(manifest, groups) {
        var repos = Object.create(null);
        groups.forEach(function (group) { (manifest.groups[group] || []).forEach(function (name) { repos[name] = true; }); });
        return repos;
    }
    function assigned(manifest, machine, groups) {
        var grouped = assignmentContext(manifest, groups || []);
        return manifest.repositories.filter(function (entry) {
            return entry.machines === "all" ||
                (Array.isArray(entry.machines) && entry.machines.indexOf(machine) >= 0) ||
                grouped[entry.name] ||
                (Array.isArray(entry.groups) && entry.groups.some(function (group) { return (groups || []).indexOf(group) >= 0; }));
        });
    }
    function assignmentReason(manifest, entry, machine, groups) {
        if (entry.machines === "all") return "All machines";
        if (Array.isArray(entry.machines) && entry.machines.indexOf(machine) >= 0) return "Direct";
        var reasons = [];
        (groups || []).forEach(function (group) {
            if ((manifest.groups[group] || []).indexOf(entry.name) >= 0 || (Array.isArray(entry.groups) && entry.groups.indexOf(group) >= 0)) reasons.push(group);
        });
        return reasons.length ? "Group: " + uniq(reasons).join(", ") : "Assignment";
    }
    function machineNames(manifest, telemetry, current) {
        var names = Object.keys(manifest.machines || {}).concat(Object.keys(telemetry.machines || {}));
        manifest.repositories.forEach(function (entry) {
            if (Array.isArray(entry.machines)) names = names.concat(entry.machines);
        });
        if (current && current.machine) names.push(current.machine);
        return uniq(names).sort(function (a, b) { return a.localeCompare(b); });
    }
    function parseTime(value) {
        var n = Date.parse(value || ""); return isNaN(n) ? 0 : n;
    }
    function health(report, revision, now) {
        now = now || Date.now();
        if (!report || !parseTime(report.lastSeenAt)) return { key: "unknown", text: "Never reported" };
        var age = Math.max(0, now - parseTime(report.lastSeenAt));
        if (age > OFFLINE_MS) return { key: "offline", text: "Offline" };
        if (age > STALE_MS) return { key: "stale", text: "Stale" };
        if (revision && report.manifestRevision && report.manifestRevision !== revision) return { key: "outofsync", text: "Out of sync" };
        if ((report.missingRepositories || []).length || (report.attentionRepositories || []).length || report.status === "attention")
            return { key: "attention", text: "Attention" };
        return { key: "healthy", text: "Healthy" };
    }
    function formatTime(value) {
        var n = parseTime(value); return n ? new Date(n).toLocaleString() : "Never";
    }
    function relativeTime(value) {
        var n = parseTime(value); if (!n) return "Never";
        var seconds = Math.max(0, Math.floor((Date.now() - n) / 1000));
        if (seconds < 60) return "just now";
        var units = [["minute", 60], ["hour", 3600], ["day", 86400], ["month", 2629800], ["year", 31557600]], chosen = units[0];
        units.forEach(function (u) { if (seconds >= u[1]) chosen = u; });
        var count = Math.floor(seconds / chosen[1]);
        return count + " " + chosen[0] + (count === 1 ? "" : "s") + " ago";
    }
    function repositoryAttention(row) {
        return Number(row.dirty) > 0 || Number(row.ahead) > 0 || Number(row.behind) > 0 ||
            Number(row.stashes) > 0 || Number(row.unpushed) > 0 || row.branch === "detached";
    }
    function buildReport(manifest, telemetry, current, rows, revision) {
        var groups = machineGroups(manifest, telemetry, current.machine, current);
        var wanted = assigned(manifest, current.machine, groups), local = Object.create(null), wantedSet = Object.create(null);
        rows.forEach(function (row) { local[row.name] = row; });
        wanted.forEach(function (entry) { wantedSet[entry.name] = true; });
        var missing = wanted.filter(function (entry) { return !local[entry.name]; }).map(function (entry) { return entry.name; });
        var attention = wanted.filter(function (entry) { return local[entry.name] && repositoryAttention(local[entry.name]); }).map(function (entry) { return entry.name; });
        var extras = rows.filter(function (row) { return !wantedSet[row.name]; }).length;
        var previous = telemetry.machines[current.machine] || {};
        var successful = current.lastSyncAt && current.lastStatus && !/failed|could not|incomplete/i.test(current.lastStatus);
        return {
            groups: groups,
            lastSeenAt: new Date().toISOString(),
            lastSuccessfulSyncAt: successful ? current.lastSyncAt : String(previous.lastSuccessfulSyncAt || ""),
            lastStatus: current.lastStatus || String(previous.lastStatus || ""),
            status: missing.length || attention.length ? "attention" : "healthy",
            assignedCount: wanted.length,
            presentCount: Math.max(0, wanted.length - missing.length),
            extraCount: extras,
            missingRepositories: missing,
            attentionRepositories: attention,
            manifestRevision: revision || ""
        };
    }
    function reportChanged(previous, next) {
        if (!previous || !parseTime(previous.lastSeenAt)) return true;
        if (Date.now() - parseTime(previous.lastSeenAt) > HEARTBEAT_MS) return true;
        var keys = ["lastSuccessfulSyncAt", "lastStatus", "status", "assignedCount", "presentCount", "extraCount", "manifestRevision"];
        if (keys.some(function (key) { return String(previous[key] || "") !== String(next[key] || ""); })) return true;
        return JSON.stringify(previous.groups || []) !== JSON.stringify(next.groups || []) ||
            JSON.stringify(previous.missingRepositories || []) !== JSON.stringify(next.missingRepositories || []) ||
            JSON.stringify(previous.attentionRepositories || []) !== JSON.stringify(next.attentionRepositories || []);
    }
    function setMessage(text, bad) {
        var el = $("fleet-message");
        if (!el) return;
        el.textContent = text || ""; el.className = "ghs-helper" + (bad ? " ghs-t-red" : ""); resize();
    }
    function installCss() {
        if ($("ghs-machines-css")) return;
        var link = document.createElement("link"); link.id = "ghs-machines-css"; link.rel = "stylesheet"; link.href = "repo-feature-machines.css";
        document.head.appendChild(link);
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
    function endpoint(current, path, withRef) {
        var value = "repos/" + current.sourceRepo + "/contents/" + encodedPath(path);
        return withRef ? value + "?ref=" + encodeURIComponent(current.branch) : value;
    }
    function readCheck() {
        var values = {};
        return m.runCore(["check"]).then(function (out) {
            out.split("\n").forEach(function (line) { var f = line.split("\t"); if (f[0] === "check") values[f[1]] = f[2] || ""; });
            return values;
        });
    }
    function readText(path) {
        return cockpit.spawn(["cat", "--", path], { err: "ignore", superuser: null }).catch(function () { return ""; });
    }
    function loadLocalConfig() {
        return readCheck().then(function (check) {
            if (!check.config) throw new Error("Could not determine the ghsync configuration directory");
            return readText(dirname(check.config) + "/repository-sync.json").then(function (text) {
                var current = safeSyncConfig(text.trim() ? JSON.parse(text) : {});
                if (!validConfig(current)) throw new Error("Configure the shared repository list in the Sync tab first");
                return { current: current, check: check };
            });
        });
    }
    function ghApi(check, args) {
        var command = ["gh", "api"];
        if (check.host) command.push("--hostname", check.host);
        return cockpit.spawn(command.concat(args), { err: "message", superuser: null });
    }
    function fetchJson(check, current, path, missingValue) {
        return ghApi(check, [endpoint(current, path, true)]).then(function (out) {
            var object = JSON.parse(out);
            if (!object || object.type !== "file" || !object.content) throw new Error(path + " is not a readable file");
            return { value: JSON.parse(decode64(object.content)), sha: object.sha || "" };
        }).catch(function (e) {
            if (missingValue !== undefined && /404|Not Found/i.test(e.message || String(e))) return { value: missingValue, sha: "" };
            throw e;
        });
    }
    function writeJson(check, current, path, value, sha) {
        var args = ["--method", "PUT", endpoint(current, path, false),
            "-f", "message=Update ghsync fleet status for " + current.machine,
            "-f", "content=" + encode64(JSON.stringify(value, null, 2) + "\n"),
            "-f", "branch=" + current.branch];
        if (sha) args.push("-f", "sha=" + sha);
        return ghApi(check, args).then(function (out) {
            var result = JSON.parse(out); return result && result.content ? String(result.content.sha || "") : "";
        });
    }
    function loadRemote(check, current) {
        return Promise.all([
            fetchJson(check, current, current.path),
            fetchJson(check, current, telemetryPath(current.path), { version: 1, machines: {} })
        ]).then(function (values) {
            return {
                manifest: normalizeManifest(values[0].value), manifestSha: values[0].sha,
                telemetry: normalizeTelemetry(values[1].value), telemetrySha: values[1].sha
            };
        });
    }
    function publishReport(check, current, remote, report, retry) {
        var previous = remote.telemetry.machines[current.machine];
        if (!reportChanged(previous, report)) return Promise.resolve(remote);
        remote.telemetry.machines[current.machine] = report;
        remote.telemetry.updatedAt = new Date().toISOString();
        return writeJson(check, current, telemetryPath(current.path), remote.telemetry, remote.telemetrySha).then(function (sha) {
            remote.telemetrySha = sha; return remote;
        }).catch(function (e) {
            if (retry === false) throw e;
            return fetchJson(check, current, telemetryPath(current.path), { version: 1, machines: {} }).then(function (latest) {
                remote.telemetry = normalizeTelemetry(latest.value); remote.telemetrySha = latest.sha;
                remote.telemetry.machines[current.machine] = report; remote.telemetry.updatedAt = new Date().toISOString();
                return publishReport(check, current, remote, report, false);
            });
        });
    }
    function stateForRepository(report, revision, name) {
        if (!report || !parseTime(report.lastSeenAt)) return { key: "unknown", text: "Unknown" };
        if (revision && report.manifestRevision !== revision) return { key: "outofsync", text: "Out of date" };
        if ((report.missingRepositories || []).indexOf(name) >= 0) return { key: "offline", text: "Missing" };
        if ((report.attentionRepositories || []).indexOf(name) >= 0) return { key: "attention", text: "Attention" };
        return { key: "healthy", text: "Present" };
    }
    function makeState(state) {
        var span = document.createElement("span");
        span.className = "ghs-fleet-state ghs-fleet-state--" + state.key; span.textContent = state.text; return span;
    }
    function renderAssignments(machine) {
        if (!snapshot) return;
        var body = $("fleet-assignment-body"); if (!body) return;
        var groups = machineGroups(snapshot.manifest, snapshot.telemetry, machine, snapshot.current);
        var rows = assigned(snapshot.manifest, machine, groups), report = snapshot.telemetry.machines[machine];
        body.textContent = "";
        $("fleet-assignment-count").textContent = rows.length + (rows.length === 1 ? " repository" : " repositories");
        $("fleet-assignments-empty").classList.toggle("ghs-hidden", rows.length > 0);
        $("fleet-assignment-wrap").classList.toggle("ghs-hidden", rows.length === 0);
        rows.forEach(function (entry) {
            var tr = document.createElement("tr"), repo = document.createElement("td"), via = document.createElement("td"), state = document.createElement("td");
            repo.className = "ghs-repo-name"; repo.textContent = entry.name;
            via.textContent = assignmentReason(snapshot.manifest, entry, machine, groups);
            state.appendChild(makeState(stateForRepository(report, snapshot.manifestSha, entry.name)));
            tr.appendChild(repo); tr.appendChild(via); tr.appendChild(state); body.appendChild(tr);
        });
        resize();
    }
    function renderFleet() {
        if (!snapshot) return;
        var names = machineNames(snapshot.manifest, snapshot.telemetry, snapshot.current), body = $("fleet-body"), filter = $("fleet-filter").value.trim().toLowerCase();
        var shown = names.filter(function (name) {
            var groupText = machineGroups(snapshot.manifest, snapshot.telemetry, name, snapshot.current).join(" ").toLowerCase();
            return !filter || name.toLowerCase().indexOf(filter) >= 0 || groupText.indexOf(filter) >= 0;
        });
        body.textContent = "";
        $("fleet-count").textContent = shown.length + (shown.length === 1 ? " machine" : " machines");
        $("fleet-empty").classList.toggle("ghs-hidden", shown.length > 0);
        $("fleet-wrap").classList.toggle("ghs-hidden", shown.length === 0);
        shown.forEach(function (name) {
            var groups = machineGroups(snapshot.manifest, snapshot.telemetry, name, snapshot.current), wanted = assigned(snapshot.manifest, name, groups);
            var report = snapshot.telemetry.machines[name], state = health(report, snapshot.manifestSha), tr = document.createElement("tr");
            var nameCell = document.createElement("td"), stateCell = document.createElement("td"), seen = document.createElement("td"), success = document.createElement("td");
            var assignedCell = document.createElement("td"), present = document.createElement("td"), missing = document.createElement("td"), groupCell = document.createElement("td");
            nameCell.className = "ghs-repo-name"; nameCell.textContent = name + (snapshot.current.machine === name ? " (this PC)" : "");
            stateCell.appendChild(makeState(state));
            seen.textContent = report ? relativeTime(report.lastSeenAt) : "Never"; seen.title = report ? formatTime(report.lastSeenAt) : "";
            success.textContent = report ? relativeTime(report.lastSuccessfulSyncAt) : "Never"; success.title = report ? formatTime(report.lastSuccessfulSyncAt) : "";
            assignedCell.className = "ghs-num"; assignedCell.textContent = wanted.length;
            present.className = "ghs-num"; present.textContent = report && report.manifestRevision === snapshot.manifestSha ? report.presentCount : "—";
            if (report && report.manifestRevision === snapshot.manifestSha) {
                missing.className = "ghs-num" + (report.missingRepositories.length ? " ghs-t-red" : " ghs-zero"); missing.textContent = report.missingRepositories.length;
                missing.title = report.missingRepositories.join("\n");
            } else { missing.textContent = "—"; }
            groupCell.textContent = groups.join(", ") || "—";
            [nameCell, stateCell, seen, success, assignedCell, present, missing, groupCell].forEach(function (cell) { tr.appendChild(cell); });
            tr.onclick = function () { $("fleet-machine-filter").value = name; renderAssignments(name); };
            body.appendChild(tr);
        });
        var select = $("fleet-machine-filter"), before = select.value;
        select.textContent = "";
        names.forEach(function (name) { var option = document.createElement("option"); option.value = name; option.textContent = name; select.appendChild(option); });
        if (names.indexOf(before) >= 0) select.value = before;
        else if (names.indexOf(snapshot.current.machine) >= 0) select.value = snapshot.current.machine;
        else if (names.length) select.value = names[0];
        if (select.value) renderAssignments(select.value);
        resize();
    }
    function refreshFleet(publish) {
        if (busy) return Promise.resolve();
        busy = true; if ($("btn-fleet-refresh")) $("btn-fleet-refresh").disabled = true;
        setMessage("Loading fleet status…");
        return loadLocalConfig().then(function (local) {
            return loadRemote(local.check, local.current).then(function (remote) {
                return m.statusSnapshot().catch(function () { return []; }).then(function (rows) {
                    var report = buildReport(remote.manifest, remote.telemetry, local.current, rows, remote.manifestSha);
                    var finish = publish ? publishReport(local.check, local.current, remote, report) : Promise.resolve(remote);
                    return finish.then(function (updated) {
                        snapshot = {
                            current: local.current, check: local.check, manifest: updated.manifest,
                            manifestSha: updated.manifestSha, telemetry: updated.telemetry, telemetrySha: updated.telemetrySha
                        };
                        renderFleet(); setMessage("Fleet status loaded from " + local.current.sourceRepo + ".");
                    });
                });
            });
        }).catch(function (e) {
            snapshot = null; if ($("fleet-body")) $("fleet-body").textContent = "";
            setMessage(e.message || String(e), true);
        }).finally(function () { busy = false; if ($("btn-fleet-refresh")) $("btn-fleet-refresh").disabled = false; resize(); });
    }
    function createUi() {
        if ($("panel-machines")) return;
        var tabs = document.querySelector(".ghs-tabs"), settingsTab = document.querySelector('.ghs-tab[data-tab="settings"]'), settingsPanel = $("panel-settings");
        if (!tabs || !settingsPanel || !settingsPanel.parentNode) return;
        installCss();
        tab = document.createElement("button"); tab.className = "ghs-tab"; tab.type = "button"; tab.dataset.tab = "machines";
        tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", "false"); tab.textContent = "Machines";
        tabs.insertBefore(tab, settingsTab || null);
        panel = document.createElement("section"); panel.id = "panel-machines"; panel.className = "ghs-tab-panel ghs-hidden"; panel.setAttribute("role", "tabpanel");
        panel.innerHTML =
            '<div class="ghs-toolbar"><div class="ghs-search"><input id="fleet-filter" class="ghs-input ghs-search__input" type="search" placeholder="Filter machines or groups" aria-label="Filter machines"></div>' +
            '<span class="ghs-toolbar__spacer"></span><span id="fleet-count" class="ghs-toolbar__count"></span><button id="btn-fleet-refresh" class="ghs-btn ghs-btn--secondary ghs-btn--sm" type="button">Refresh</button></div>' +
            '<p id="fleet-message" class="ghs-helper"></p>' +
            '<div id="fleet-wrap" class="ghs-table-wrap ghs-hidden"><table class="ghs-table ghs-fleet-table"><thead><tr><th>Machine</th><th>Status</th><th>Last seen</th><th>Last successful sync</th><th class="ghs-num">Assigned</th><th class="ghs-num">Present</th><th class="ghs-num">Missing</th><th>Groups</th></tr></thead><tbody id="fleet-body"></tbody></table></div>' +
            '<div id="fleet-empty" class="ghs-empty"><h3 class="ghs-empty__title">No machines yet</h3><p class="ghs-empty__body">Configure machine assignments in the shared repository manifest, then refresh this view.</p></div>' +
            '<div class="ghs-fleet-assignments"><div class="ghs-toolbar"><label class="ghs-label ghs-fleet-machine-label" for="fleet-machine-filter">Repository assignments</label><select id="fleet-machine-filter" class="ghs-input ghs-input--narrow"></select><span class="ghs-toolbar__spacer"></span><span id="fleet-assignment-count" class="ghs-toolbar__count"></span></div>' +
            '<div id="fleet-assignment-wrap" class="ghs-table-wrap ghs-hidden"><table class="ghs-table"><thead><tr><th>Repository</th><th>Assigned via</th><th>Reported state</th></tr></thead><tbody id="fleet-assignment-body"></tbody></table></div>' +
            '<div id="fleet-assignments-empty" class="ghs-empty"><p class="ghs-empty__body">No repositories are assigned to this machine.</p></div></div>';
        settingsPanel.parentNode.insertBefore(panel, settingsPanel);
        tab.onclick = function () {
            document.querySelectorAll(".ghs-tab").forEach(function (item) {
                var on = item === tab; item.classList.toggle("ghs-tab--current", on); item.setAttribute("aria-selected", on ? "true" : "false");
            });
            document.querySelectorAll(".ghs-tab-panel").forEach(function (item) { item.classList.add("ghs-hidden"); });
            panel.classList.remove("ghs-hidden"); resize(); refreshFleet(true);
        };
        new MutationObserver(function () {
            var current = tabs.querySelector('.ghs-tab--current:not([data-tab="machines"])');
            if (current && panel && !panel.classList.contains("ghs-hidden")) panel.classList.add("ghs-hidden");
        }).observe(tabs, { subtree: true, attributes: true, attributeFilter: ["class", "aria-selected"] });
        $("fleet-filter").oninput = renderFleet;
        $("fleet-machine-filter").onchange = function () { renderAssignments(this.value); };
        $("btn-fleet-refresh").onclick = function () { refreshFleet(true); };
    }
    function hookSyncStatus() {
        var status = $("sync-status"); if (!status) return;
        new MutationObserver(function () {
            var text = status.textContent.trim();
            if (!text || /…$|Pulling|Reading local|Loading current|Synchronizing/i.test(text)) return;
            clearTimeout(reportTimer);
            reportTimer = setTimeout(function () { refreshFleet(true); }, 1200);
        }).observe(status, { childList: true, characterData: true, subtree: true });
    }

    createUi();
    window.GHSyncFleetMachines = {
        telemetryPath: telemetryPath,
        normalizeManifest: normalizeManifest,
        normalizeTelemetry: normalizeTelemetry,
        assigned: assigned,
        machineNames: machineNames,
        health: health,
        buildReport: buildReport,
        stateForRepository: stateForRepository
    };
    hookSyncStatus();
    resize();
})();
