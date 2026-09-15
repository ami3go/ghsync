"use strict";

const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const dom = new JSDOM(`<!doctype html><html><head></head><body>
<section id="panel-sync"><div class="ghs-form">
  <div class="ghs-form-group"><input id="sync-source-repo" value="acme/fleet-config"></div>
  <input id="sync-source-branch" value="main">
  <input id="sync-source-path" value="ghsync-repositories.json">
  <input id="sync-machine" value="mini-pc-1">
  <input id="sync-groups" value="development">
  <div class="ghs-form-actions"><button id="btn-sync-config-save">Save</button></div>
  <div class="ghs-form-actions">
    <button id="btn-shared-pull">Pull list</button>
    <button id="btn-shared-push">Push list</button>
    <button id="btn-shared-reconcile">Sync now</button>
  </div>
  <p id="sync-status"></p>
</div></section>
</body></html>`, { url: "https://example.test/" });

let repoExists = false;
let branchExists = false;
let manifestExists = false;
const calls = [];

function missing() { return Promise.reject(new Error("HTTP 404: Not Found")); }
function spawn(argv) {
  calls.push(argv.slice());
  const joined = argv.join(" ");
  if (joined.startsWith("gh api")) {
    if (/--method PUT/.test(joined) && /contents\/ghsync-repositories\.json/.test(joined)) {
      repoExists = true;
      branchExists = true;
      manifestExists = true;
      return Promise.resolve(JSON.stringify({ content: { sha: "manifest-sha" } }));
    }
    if (/repos\/acme\/fleet-config\/contents\/ghsync-repositories\.json/.test(joined)) {
      return manifestExists ? Promise.resolve(JSON.stringify({ type: "file", content: "e30=", sha: "manifest-sha" })) : missing();
    }
    if (/repos\/acme\/fleet-config\/branches\/main/.test(joined)) {
      return branchExists ? Promise.resolve(JSON.stringify({ name: "main" })) : missing();
    }
    if (/repos\/acme\/fleet-config$/.test(joined)) {
      return repoExists ? Promise.resolve(JSON.stringify({ private: true, default_branch: "main" })) : missing();
    }
  }
  if (joined.startsWith("gh repo create acme/fleet-config")) {
    repoExists = true;
    branchExists = true;
    manifestExists = false;
    return Promise.resolve("");
  }
  return Promise.resolve("");
}

const manager = {
  runCore: () => Promise.resolve("check\thost\tgithub.com\n"),
  statusSnapshot: () => Promise.resolve([{ name: "acme/api" }]),
  mapLimit: (items, limit, worker) => Promise.all(items.map(worker)),
  runGit: () => Promise.resolve("https://github.com/acme/api.git\n")
};

dom.window.GHSyncRepoManager = manager;
dom.window.GHSyncSharedList = {
  normalizeManifest: value => value,
  mergeLocal: (manifest, entries, current) => ({
    version: 1,
    repositories: entries.map(entry => ({ name: entry.name, url: entry.url, machines: [current.machine] })),
    groups: {},
    machines: { [current.machine]: { groups: current.groups || [] } }
  })
};
dom.window.cockpit = {
  spawn,
  transport: { control: () => {} }
};

const context = vm.createContext(dom.window);
vm.runInContext(fs.readFileSync("cockpit/repo-feature-sync-bootstrap.js", "utf8"), context);
const api = dom.window.GHSyncSyncBootstrap;
const doc = dom.window.document;

function assert(condition, text) {
  if (!condition) throw new Error(text);
  console.log("PASS", text);
}

(async () => {
  assert(!!api, "bootstrap test API is exposed");
  assert(!!doc.getElementById("btn-sync-test-repo"), "Test connection button added");
  assert(!!doc.getElementById("btn-sync-create-repo"), "Create private repository button added");
  assert(!!doc.getElementById("btn-sync-init-manifest"), "Initialize manifest button added");

  await api.inspectRepository(false);
  assert(doc.getElementById("btn-sync-create-repo").disabled === false, "create enabled when repository is missing");
  assert(doc.getElementById("btn-sync-init-manifest").disabled === true, "initialize disabled before repository exists");

  await api.createRepository();
  assert(calls.some(args => args.join(" ").includes("gh repo create acme/fleet-config --private --add-readme")), "repository is created private with an initial README");
  assert(doc.getElementById("btn-sync-create-repo").disabled === true, "create disabled after repository exists");

  branchExists = false;
  manifestExists = false;
  await api.inspectRepository(false);
  assert(doc.getElementById("btn-sync-init-manifest").disabled === false, "initialize enabled for an empty existing repository");
  const beforeEmptyInit = calls.length;
  await api.initializeManifest();
  const emptyInit = calls.slice(beforeEmptyInit).find(args => args.includes("--method") && args.includes("PUT"));
  assert(!!emptyInit, "empty repository initialization uses Contents API PUT");
  assert(!emptyInit.some(arg => arg === "branch=main"), "empty repository first commit omits nonexistent branch parameter");
  assert(doc.getElementById("btn-sync-init-manifest").disabled === true, "initialize disabled after manifest exists");

  manifestExists = false;
  branchExists = true;
  await api.inspectRepository(false);
  const beforeBranchInit = calls.length;
  await api.initializeManifest();
  const branchInit = calls.slice(beforeBranchInit).find(args => args.includes("--method") && args.includes("PUT"));
  assert(branchInit.some(arg => arg === "branch=main"), "existing branch initialization targets configured branch");

  console.log("sync bootstrap feature smoke test passed");
})().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
