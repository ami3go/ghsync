"use strict";

const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const dom = new JSDOM(`<!doctype html><body>
<section id="panel-repos"><div class="ghs-toolbar">
  <span class="ghs-toolbar__spacer"></span>
  <button id="btn-orphans"></button><span id="repo-count"></span>
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

if (!dom.window.document.getElementById("btn-repo-export")) throw new Error("export button missing");
if (!dom.window.document.getElementById("btn-repo-import")) throw new Error("import button missing");
if (!dom.window.document.getElementById("repo-list-file")) throw new Error("file chooser missing");

console.log("repository list feature smoke test passed");
