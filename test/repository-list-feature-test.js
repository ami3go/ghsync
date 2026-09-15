"use strict";

const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const dom = new JSDOM(`<!doctype html><body>
<section id="panel-repos"><div class="ghs-toolbar">
  <span class="ghs-toolbar__spacer"></span>
  <button id="btn-orphans"></button><span id="repo-count"></span>
</div></section>
<section id="panel-settings"><div class="ghs-form">
  <div class="ghs-form-actions"><button id="btn-save"></button><button id="btn-reset"></button></div>
</div></section>
</body>`, { url: "https://example.test/" });

const manager = {
  statusSnapshot: () => Promise.resolve([]),
  mapLimit: () => Promise.resolve([]),
  runGit: () => Promise.resolve(""),
  runCore: () => Promise.resolve(""),
  repositoryRoot: () => Promise.resolve("/tmp/repos"),
  refreshMainPage: () => {}
};

dom.window.GHSyncRepoManager = manager;
dom.window.cockpit = { transport: { control: () => {} }, spawn: () => Promise.resolve("") };
const context = vm.createContext(dom.window);
vm.runInContext(fs.readFileSync("cockpit/repo-feature-repository-list.js", "utf8"), context);

const exportButton = dom.window.document.getElementById("btn-repo-export");
const importButton = dom.window.document.getElementById("btn-repo-import");
const chooser = dom.window.document.getElementById("repo-list-file");
const group = dom.window.document.getElementById("repo-list-settings");

if (!exportButton) throw new Error("export button missing");
if (!importButton) throw new Error("import button missing");
if (!chooser) throw new Error("file chooser missing");
if (!group) throw new Error("repository list settings group missing");
if (!exportButton.closest("#panel-settings")) throw new Error("export button is not in Settings");
if (!importButton.closest("#panel-settings")) throw new Error("import button is not in Settings");
if (dom.window.document.querySelector("#panel-repos #btn-repo-export, #panel-repos #btn-repo-import")) {
  throw new Error("repository list buttons leaked into Repositories toolbar");
}

console.log("repository list feature smoke test passed");
