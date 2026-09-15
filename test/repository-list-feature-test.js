"use strict";

const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const dom = new JSDOM(`<!doctype html><body>
<div class="ghs-tabs" role="tablist">
  <button class="ghs-tab ghs-tab--current" data-tab="repos" aria-selected="true"></button>
  <button class="ghs-tab" data-tab="settings" aria-selected="false"></button>
</div>
<section id="panel-repos" class="ghs-tab-panel"><div class="ghs-toolbar">
  <span class="ghs-toolbar__spacer"></span>
  <button id="btn-orphans"></button><span id="repo-count"></span>
</div></section>
<section id="panel-settings" class="ghs-tab-panel ghs-hidden"><div class="ghs-form">
  <div class="ghs-form-actions"><button id="btn-save"></button><button id="btn-reset"></button></div>
</div></section>
<button id="btn-sync"></button>
</body>`, { url: "https://example.test/" });

const manager = {
  statusSnapshot: () => Promise.resolve([]),
  mapLimit: (items, limit, worker) => Promise.all(items.map(worker)),
  runGit: () => Promise.resolve("git@github.com:acme/demo.git\n"),
  runCore: () => Promise.resolve([
    "check\tconfig\t/home/test/.config/ghsync/config",
    "check\troot\t/tmp/repos",
    "check\tjobs\t4",
    "check\thost\t"
  ].join("\n") + "\n"),
  repositoryRoot: () => Promise.resolve("/tmp/repos"),
  refreshMainPage: () => {}
};

function spawn(argv) {
  if (argv[0] === "hostname") return Promise.resolve("test-pc\n");
  if (argv[0] === "cat") return Promise.reject(new Error("missing"));
  return Promise.resolve("");
}

dom.window.GHSyncRepoManager = manager;
dom.window.cockpit = {
  transport: { control: () => {} },
  spawn,
  file: () => ({ replace: () => Promise.resolve() })
};
const context = vm.createContext(dom.window);
[
  "cockpit/repo-feature-sync.js",
  "cockpit/repo-feature-repository-list.js",
  "cockpit/repo-feature-sync-controls.js"
].forEach((file) => vm.runInContext(fs.readFileSync(file, "utf8"), context));

const doc = dom.window.document;
const syncTab = doc.querySelector('[data-tab="sync"]');
const syncPanel = doc.getElementById("panel-sync");
const exportButton = doc.getElementById("btn-repo-export");
const importButton = doc.getElementById("btn-repo-import");
const chooser = doc.getElementById("repo-list-file");
const group = doc.getElementById("repo-list-settings");

if (!syncTab) throw new Error("Sync tab missing");
if (!syncPanel) throw new Error("Sync panel missing");
if (!doc.getElementById("sync-source-repo")) throw new Error("shared source configuration missing");
if (!doc.getElementById("sync-machine")) throw new Error("machine identity configuration missing");
if (!doc.getElementById("btn-shared-pull")) throw new Error("Pull list action missing");
if (!doc.getElementById("btn-shared-push")) throw new Error("Push list action missing");
if (!doc.getElementById("btn-shared-reconcile")) throw new Error("Sync now action missing");
if (!exportButton || !importButton || !chooser || !group) throw new Error("import/export controls missing");
if (!exportButton.closest("#panel-sync") || !importButton.closest("#panel-sync")) throw new Error("import/export controls are not in Sync");
if (doc.querySelector("#panel-settings #btn-repo-export, #panel-settings #btn-repo-import")) throw new Error("import/export controls leaked into Settings");

syncTab.click();
if (syncPanel.classList.contains("ghs-hidden")) throw new Error("Sync panel does not open");
if (syncTab.getAttribute("aria-selected") !== "true") throw new Error("Sync tab aria-selected not updated");

const api = dom.window.GHSyncSharedList;
if (!api) throw new Error("shared-list API missing");
const manifest = api.normalizeManifest({
  version: 1,
  repositories: [
    { name: "acme/all", url: "git@github.com:acme/all.git", machines: "all" },
    { name: "acme/direct", url: "git@github.com:acme/direct.git", machines: ["test-pc"] },
    { name: "acme/grouped", url: "git@github.com:acme/grouped.git", machines: [] },
    { name: "acme/other", url: "git@github.com:acme/other.git", machines: ["other-pc"] }
  ],
  groups: { development: ["acme/grouped"] },
  machines: { "test-pc": { groups: ["development"] } }
});
const assigned = api.assigned(manifest, "test-pc", []).map((entry) => entry.name).sort();
if (assigned.join(",") !== "acme/all,acme/direct,acme/grouped") throw new Error("machine/group assignment is incorrect: " + assigned.join(","));

const merged = api.mergeLocal(manifest, [
  { name: "acme/all", url: "git@github.com:acme/all.git" },
  { name: "acme/new", url: "git@github.com:acme/new.git" }
], { machine: "test-pc", groups: ["development"] });
const direct = merged.repositories.find((entry) => entry.name === "acme/direct");
const other = merged.repositories.find((entry) => entry.name === "acme/other");
const fresh = merged.repositories.find((entry) => entry.name === "acme/new");
if (direct && direct.machines.includes("test-pc")) throw new Error("Push did not remove stale direct machine assignment");
if (!other || !other.machines.includes("other-pc")) throw new Error("Push damaged another machine assignment");
if (!fresh || !fresh.machines.includes("test-pc")) throw new Error("Push did not add new local repository");

console.log("repository list Sync feature smoke test passed");
