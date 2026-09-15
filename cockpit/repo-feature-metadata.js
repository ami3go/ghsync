/* Roadmap: repository labels/notes plus shared policy metadata. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.loadMeta || !m.saveMeta || !m.statusSnapshot) return;
    var tab, panel, currentRows = [];
    var VALID = ["manual", "pull-only", "pull+push", "fetch-only"];

    function $(id) { return document.getElementById(id); }
    function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function uniq(values) { var seen = {}, out = []; (values || []).forEach(function (v) { v = String(v || "").trim(); if (v && !seen[v]) { seen[v] = true; out.push(v); } }); return out; }
    function msg(e) { return e && e.message ? e.message : String(e || "Unknown error"); }
    function parseCheck(out) { var v = {}; out.split("\n").forEach(function (line) { var f = line.split("\t"); if (f[0] === "check") v[f[1]] = f[2] || ""; }); return v; }
    function b64decode(text) { var binary = atob(String(text || "").replace(/\s/g, "")); if (typeof TextDecoder !== "undefined") { var bytes = new Uint8Array(binary.length); for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i); return new TextDecoder().decode(bytes); } return decodeURIComponent(escape(binary)); }
    function b64encode(text) { if (typeof TextEncoder !== "undefined") { var bytes = new TextEncoder().encode(text), binary = ""; bytes.forEach(function (b) { binary += String.fromCharCode(b); }); return btoa(binary); } return btoa(unescape(encodeURIComponent(text))); }
    function syncConfig() {
        return m.runCore(["check"]).then(parseCheck).then(function (check) {
            if (!check.config) throw new Error("Could not determine config directory"); var dir = check.config.slice(0, check.config.lastIndexOf("/"));
            return cockpit.spawn(["cat", dir + "/repository-sync.json"], { err: "message", superuser: null }).then(function (text) { var cfg = JSON.parse(text); if (!cfg.sourceRepo) throw new Error("Configure the Sync repository first"); return { cfg: cfg, check: check }; });
        });
    }
    function ghApi(check, args) { var cmd = ["gh", "api"]; if (check.host) cmd.push("--hostname", check.host); return cockpit.spawn(cmd.concat(args), { err: "message", superuser: null }); }
    function endpoint(cfg, ref) { var path = String(cfg.path || "ghsync-repositories.json").split("/").map(encodeURIComponent).join("/"); var value = "repos/" + cfg.sourceRepo + "/contents/" + path; return ref ? value + "?ref=" + encodeURIComponent(cfg.branch || "main") : value; }
    function fetchRaw() {
        return syncConfig().then(function (context) { return ghApi(context.check, [endpoint(context.cfg, true)]).then(function (out) { var object = JSON.parse(out), raw = JSON.parse(b64decode(object.content || "")); return { context: context, raw: raw, sha: object.sha || "" }; }); });
    }
    function writeRaw(remote, raw, title) {
        var args = ["--method", "PUT", endpoint(remote.context.cfg, false), "-f", "message=" + title + " from " + (remote.context.cfg.machine || "machine"), "-f", "content=" + b64encode(JSON.stringify(raw, null, 2) + "\n"), "-f", "branch=" + (remote.context.cfg.branch || "main")]; if (remote.sha) args.push("-f", "sha=" + remote.sha);
        return ghApi(remote.context.check, args);
    }
    function byName(raw) { var map = {}; (Array.isArray(raw.repositories) ? raw.repositories : []).forEach(function (r) { if (r && r.name) map[r.name] = r; }); return map; }
    function publishMetadata(showAlert) {
        return Promise.all([fetchRaw(), m.loadMeta()]).then(function (values) {
            var remote = values[0], raw = remote.raw, meta = values[1], machine = remote.context.cfg.machine || ""; raw.groupPolicies = meta.groupPolicies || {}; var map = byName(raw);
            Object.keys(map).forEach(function (name) {
                var item = map[name], policy = (meta.policies || {})[name]; if (VALID.indexOf(policy) >= 0) item.policy = policy; else delete item.policy;
                item.machinePolicies = item.machinePolicies && typeof item.machinePolicies === "object" && !Array.isArray(item.machinePolicies) ? item.machinePolicies : {};
                var localMachine = meta.machinePolicies && meta.machinePolicies[name] && meta.machinePolicies[name][machine]; if (VALID.indexOf(localMachine) >= 0) item.machinePolicies[machine] = localMachine; else delete item.machinePolicies[machine]; if (!Object.keys(item.machinePolicies).length) delete item.machinePolicies;
                if (meta.shareLabels) { var labels = uniq((meta.tags || {})[name] || []); if (labels.length) item.labels = labels; else delete item.labels; var note = String((meta.notes || {})[name] || "").trim(); if (note) item.note = note; else delete item.note; }
            });
            raw.updatedAt = new Date().toISOString(); return writeRaw(remote, raw, "Update ghsync shared metadata");
        }).then(function () { if (showAlert) window.alert("Shared policies" + ($("metadata-share-labels") && $("metadata-share-labels").checked ? ", labels and notes" : "") + " published."); if (window.GHSyncNotifications && window.GHSyncNotifications.add) window.GHSyncNotifications.add({ variant: "success", title: "Shared repository metadata published", body: "Policies and enabled metadata were written to the shared manifest.", source: "metadata" }); });
    }
    function pullMetadata() {
        return Promise.all([fetchRaw(), m.loadMeta()]).then(function (values) {
            var remote = values[0], raw = remote.raw, meta = values[1], machine = remote.context.cfg.machine || ""; meta.groupPolicies = raw.groupPolicies && typeof raw.groupPolicies === "object" ? raw.groupPolicies : meta.groupPolicies || {}; var map = byName(raw);
            Object.keys(map).forEach(function (name) { var item = map[name]; if (VALID.indexOf(item.policy) >= 0) meta.policies[name] = item.policy; if (item.machinePolicies && VALID.indexOf(item.machinePolicies[machine]) >= 0) { meta.machinePolicies[name] = meta.machinePolicies[name] || {}; meta.machinePolicies[name][machine] = item.machinePolicies[machine]; } if (meta.shareLabels) { if (Array.isArray(item.labels)) meta.tags[name] = uniq(item.labels); if (typeof item.note === "string") meta.notes[name] = item.note; } });
            return m.saveMeta();
        }).then(function () { render(); if (m.refreshGroups) m.refreshGroups(); window.alert("Shared metadata refreshed."); });
    }
    function hookSharedPush(id) {
        var button = $(id); if (!button || button.dataset.metadataHook === "yes") return; button.dataset.metadataHook = "yes"; var original = button.onclick;
        button.onclick = function (event) { var result = original ? original.call(button, event) : null; return Promise.resolve(result).then(function () { return publishMetadata(false); }).catch(function () { /* original action reports its own failure */ }); };
    }

    function applyRules(meta) {
        var rules = meta.labelRules || {}; meta.groups = meta.groups || {}; meta.policies = meta.policies || {}; meta.groupDefinitions = meta.groupDefinitions || [];
        Object.keys(meta.tags || {}).forEach(function (repo) { (meta.tags[repo] || []).forEach(function (label) { var rule = rules[label]; if (!rule) return; if (rule.group) { meta.groups[repo] = rule.group; if (meta.groupDefinitions.indexOf(rule.group) < 0) meta.groupDefinitions.push(rule.group); } if (VALID.indexOf(rule.policy) >= 0) meta.policies[repo] = rule.policy; }); }); return meta;
    }
    function editRule() {
        m.loadMeta().then(function (meta) {
            var label = window.prompt("Label to configure as a rule:"); if (label === null) return; label = label.trim(); if (!label) throw new Error("Label is required"); var current = (meta.labelRules || {})[label] || {};
            var group = window.prompt("Group assigned by label '" + label + "' (blank = no group rule):", current.group || ""); if (group === null) return; group = group.trim(); if (group && !/^[A-Za-z0-9._-]+$/.test(group)) throw new Error("Invalid group name");
            var policy = window.prompt("Policy assigned by this label (manual, pull-only, pull+push, fetch-only, or blank):", current.policy || ""); if (policy === null) return; policy = policy.trim(); if (policy && VALID.indexOf(policy) < 0) throw new Error("Invalid policy");
            meta.labelRules = meta.labelRules || {}; if (!group && !policy) delete meta.labelRules[label]; else meta.labelRules[label] = { group: group, policy: policy }; applyRules(meta); return m.saveMeta();
        }).then(function () { render(); if (m.refreshGroups) m.refreshGroups(); }).catch(function (e) { window.alert("Could not save label rule: " + msg(e)); });
    }
    function editRepo(name) {
        m.loadMeta().then(function (meta) {
            var labels = window.prompt("Comma-separated labels for " + name + ":", ((meta.tags || {})[name] || []).join(", ")); if (labels === null) return; var note = window.prompt("Note for " + name + " (blank clears):", (meta.notes || {})[name] || ""); if (note === null) return;
            meta.tags = meta.tags || {}; meta.notes = meta.notes || {}; labels = uniq(labels.split(",")); if (labels.length) meta.tags[name] = labels; else delete meta.tags[name]; note = note.trim(); if (note) meta.notes[name] = note; else delete meta.notes[name]; applyRules(meta); return m.saveMeta();
        }).then(function () { render(); if (m.refreshGroups) m.refreshGroups(); }).catch(function (e) { window.alert("Could not save labels/note: " + msg(e)); });
    }
    function render() {
        return Promise.all([m.loadMeta(), m.statusSnapshot()]).then(function (values) {
            var meta = values[0], rows = values[1], needle = ($("metadata-filter") ? $("metadata-filter").value : "").trim().toLowerCase(), labelNeedle = ($("metadata-label-filter") ? $("metadata-label-filter").value : "").trim().toLowerCase(), body = $("metadata-body"); currentRows = rows; if (!body) return; body.textContent = "";
            rows.filter(function (row) { var labels = ((meta.tags || {})[row.name] || []).join(" ").toLowerCase(); return (!needle || row.name.toLowerCase().indexOf(needle) >= 0 || String((meta.notes || {})[row.name] || "").toLowerCase().indexOf(needle) >= 0) && (!labelNeedle || labels.indexOf(labelNeedle) >= 0); }).forEach(function (row) {
                var name = row.name, tr = document.createElement("tr"), details = m.policyDetails ? m.policyDetails(meta, name, "") : { policy: (meta.policies || {})[name] || "pull-only", source: "repository" };
                tr.innerHTML = '<td class="ghs-mono">' + esc(name) + '</td><td>' + esc((meta.groups || {})[name] || "—") + '</td><td>' + esc(((meta.tags || {})[name] || []).join(", ") || "—") + '</td><td>' + esc((meta.notes || {})[name] || "—") + '</td><td>' + esc(details.policy) + '</td><td class="ghs-table__action"></td>';
                var edit = document.createElement("button"); edit.className = "ghs-btn ghs-btn--secondary ghs-btn--sm"; edit.textContent = "Edit"; edit.onclick = function () { editRepo(name); }; tr.lastElementChild.appendChild(edit); body.appendChild(tr);
            });
            if ($("metadata-share-labels")) $("metadata-share-labels").checked = meta.shareLabels === true;
            $("metadata-status").textContent = Object.keys(meta.labelRules || {}).length + " label rule(s). Labels can assign groups and policies.";
        });
    }
    function createUi() {
        if ($("panel-metadata")) return; var tabs = document.querySelector(".ghs-tabs"), settings = document.querySelector('.ghs-tab[data-tab="settings"]'), settingsPanel = $("panel-settings"); if (!tabs || !settingsPanel) return;
        tab = document.createElement("button"); tab.className = "ghs-tab"; tab.type = "button"; tab.dataset.tab = "metadata"; tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", "false"); tab.textContent = "Metadata"; tabs.insertBefore(tab, settings || null);
        panel = document.createElement("section"); panel.id = "panel-metadata"; panel.className = "ghs-tab-panel ghs-hidden"; panel.setAttribute("role", "tabpanel"); panel.innerHTML = '<div class="ghs-form"><div class="ghs-form-row"><div class="ghs-form-group"><label class="ghs-label" for="metadata-filter">Search names / notes</label><input id="metadata-filter" class="ghs-input" type="search"></div><div class="ghs-form-group"><label class="ghs-label" for="metadata-label-filter">Filter label</label><input id="metadata-label-filter" class="ghs-input" type="search"></div></div><label><input id="metadata-share-labels" type="checkbox"> Share labels and notes through the fleet manifest</label><div class="ghs-form-actions"><button id="btn-label-rule" class="ghs-btn ghs-btn--secondary" type="button">Label rule…</button><button id="btn-metadata-pull" class="ghs-btn ghs-btn--secondary" type="button">Refresh shared metadata</button><button id="btn-metadata-push" class="ghs-btn ghs-btn--primary" type="button">Publish shared metadata</button></div><p id="metadata-status" class="ghs-helper"></p></div><div class="ghs-table-wrap"><table class="ghs-table"><thead><tr><th>Repository</th><th>Group</th><th>Labels</th><th>Note</th><th>Policy</th><th class="ghs-table__action">Actions</th></tr></thead><tbody id="metadata-body"></tbody></table></div>';
        settingsPanel.parentNode.insertBefore(panel, settingsPanel); tab.onclick = function () { document.querySelectorAll(".ghs-tab").forEach(function (t) { var on = t === tab; t.classList.toggle("ghs-tab--current", on); t.setAttribute("aria-selected", on ? "true" : "false"); }); document.querySelectorAll(".ghs-tab-panel").forEach(function (p) { p.classList.add("ghs-hidden"); }); panel.classList.remove("ghs-hidden"); render(); };
        $("metadata-filter").oninput = render; $("metadata-label-filter").oninput = render; $("btn-label-rule").onclick = editRule; $("btn-metadata-pull").onclick = function () { pullMetadata().catch(function (e) { window.alert("Shared metadata refresh failed: " + msg(e)); }); }; $("btn-metadata-push").onclick = function () { publishMetadata(true).catch(function (e) { window.alert("Shared metadata publish failed: " + msg(e)); }); };
        $("metadata-share-labels").onchange = function () { var checked = this.checked; m.loadMeta().then(function (meta) { meta.shareLabels = checked; return m.saveMeta(); }); };
    }
    createUi(); render(); setTimeout(function () { hookSharedPush("btn-shared-push"); hookSharedPush("btn-groups-shared-push"); }, 0);
    if (m.registerAction) m.registerAction({ label: "Labels / note…", run: editRepo });
    window.GHSyncMetadata = { applyRules: applyRules, publish: publishMetadata, pull: pullMetadata };
})();
