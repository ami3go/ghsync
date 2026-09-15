"use strict";

const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const dom = new JSDOM(`<!doctype html><html><head></head><body>
<div class="ghs-tabs" role="tablist">
  <button class="ghs-tab ghs-tab--current" data-tab="repos"></button>
  <button class="ghs-tab" data-tab="sync"></button>
  <button class="ghs-tab" data-tab="settings"></button>
</div>
<section class="ghs-tab-panel" id="panel-repos"></section>
<section class="ghs-tab-panel ghs-hidden" id="panel-sync"><p id="sync-status"></p></section>
<section class="ghs-tab-panel ghs-hidden" id="panel-settings"><div class="ghs-form"></div></section>
</body></html>`, { url: "https://example.test/" });

const manager = {
  statusSnapshot: () => Promise.resolve([]),
  runCore: () => Promise.resolve("check\tconfig\t/tmp/ghsync/config\ncheck\thost\tgithub.com\n")
};

dom.window.GHSyncRepoManager = manager;
dom.window.cockpit = {
  transport: { control: () => {} },
  spawn: () => Promise.resolve("")
};
const context = vm.createContext(dom.window);
vm.runInContext(fs.readFileSync("cockpit/repo-feature-machines.js", "utf8"), context);

const doc = dom.window.document;
if (!doc.querySelector('.ghs-tab[data-tab="machines"]')) throw new Error("Machines tab missing");
if (!doc.getElementById("panel-machines")) throw new Error("Machines panel missing");
if (!doc.getElementById("fleet-machine-filter")) throw new Error("machine assignment filter missing");
if (!doc.getElementById("fleet-assignment-body")) throw new Error("assignment table missing");
if (!doc.getElementById("ghs-machines-css")) throw new Error("fleet stylesheet was not loaded");

const api = dom.window.GHSyncFleetMachines;
if (!api) throw new Error("fleet test API missing");
if (api.telemetryPath("fleet/repos.json") !== "fleet/repos.machines.json") throw new Error("unexpected telemetry sidecar path");

const manifest = api.normalizeManifest({
  version: 1,
  groups: { development: ["acme/grouped"] },
  machines: { alpha: { groups: ["development"] }, beta: { groups: [] } },
  repositories: [
    { name: "acme/all", url: "https://github.com/acme/all.git", machines: "all" },
    { name: "acme/direct", url: "https://github.com/acme/direct.git", machines: ["alpha", "gamma"] },
    { name: "acme/grouped", url: "https://github.com/acme/grouped.git", machines: [] }
  ]
});
const telemetry = api.normalizeTelemetry({
  version: 1,
  machines: { delta: { groups: [], lastSeenAt: "2026-09-15T10:00:00Z" } }
});

const alpha = api.assigned(manifest, "alpha", ["development"]).map(r => r.name).sort();
if (alpha.join(",") !== "acme/all,acme/direct,acme/grouped") throw new Error("group/direct/all assignment resolution failed");
const beta = api.assigned(manifest, "beta", []).map(r => r.name);
if (beta.length !== 1 || beta[0] !== "acme/all") throw new Error("all-machine assignment failed");
const names = api.machineNames(manifest, telemetry, { machine: "epsilon" });
["alpha", "beta", "gamma", "delta", "epsilon"].forEach(name => {
  if (!names.includes(name)) throw new Error("machine discovery missed " + name);
});

const now = Date.parse("2026-09-15T12:00:00Z");
let state = api.health({ lastSeenAt: "2026-09-15T11:59:00Z", manifestRevision: "abc", missingRepositories: [], attentionRepositories: [], status: "healthy" }, "abc", now);
if (state.key !== "healthy") throw new Error("healthy machine classified incorrectly");
state = api.health({ lastSeenAt: "2026-09-13T12:00:00Z", manifestRevision: "abc", missingRepositories: [], attentionRepositories: [], status: "healthy" }, "abc", now);
if (state.key !== "stale") throw new Error("stale machine classified incorrectly");
state = api.health({ lastSeenAt: "2026-09-01T12:00:00Z", manifestRevision: "abc", missingRepositories: [], attentionRepositories: [], status: "healthy" }, "abc", now);
if (state.key !== "offline") throw new Error("offline machine classified incorrectly");
state = api.health({ lastSeenAt: "2026-09-15T11:59:00Z", manifestRevision: "old", missingRepositories: [], attentionRepositories: [], status: "healthy" }, "abc", now);
if (state.key !== "outofsync") throw new Error("manifest mismatch was not classified out of sync");

const report = api.buildReport(manifest, telemetry, {
  machine: "alpha",
  groups: ["development"],
  lastSyncAt: "2026-09-15T11:58:00Z",
  lastStatus: "2 cloned, 1 already present"
}, [
  { name: "acme/all", branch: "main", dirty: 0, ahead: 0, behind: 0, stashes: 0, unpushed: 0 },
  { name: "acme/direct", branch: "main", dirty: 1, ahead: 0, behind: 0, stashes: 0, unpushed: 0 },
  { name: "acme/extra", branch: "main", dirty: 0, ahead: 0, behind: 0, stashes: 0, unpushed: 0 }
], "abc");
if (report.assignedCount !== 3 || report.presentCount !== 2) throw new Error("fleet report counts are wrong");
if (report.missingRepositories.length !== 1 || report.missingRepositories[0] !== "acme/grouped") throw new Error("missing repository report is wrong");
if (report.attentionRepositories.length !== 1 || report.attentionRepositories[0] !== "acme/direct") throw new Error("attention repository report is wrong");
if (report.extraCount !== 1 || report.status !== "attention") throw new Error("fleet attention summary is wrong");
if (report.lastSuccessfulSyncAt !== "2026-09-15T11:58:00Z") throw new Error("last successful sync was not recorded");

console.log("fleet machines feature smoke test passed");
