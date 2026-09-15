"use strict";

const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const dom = new JSDOM(`<!doctype html><html><head></head><body>
<div class="ghs-tabs" role="tablist">
  <button class="ghs-tab ghs-tab--current" data-tab="repos" aria-selected="true"></button>
  <button class="ghs-tab" data-tab="sync" aria-selected="false"></button>
  <button class="ghs-tab" data-tab="settings" aria-selected="false"></button>
</div>
<section class="ghs-tab-panel" id="panel-repos">
  <div class="ghs-toolbar"><label><input id="filter"></label></div>
  <div class="ghs-table-wrap"><table><tbody id="repos">
    <tr><td class="ghs-repo-name">acme/api</td><td>main</td><td></td></tr>
    <tr><td class="ghs-repo-name">acme/web</td><td>main</td><td></td></tr>
  </tbody></table></div>
</section>
<section class="ghs-tab-panel ghs-hidden" id="panel-sync">
  <div class="ghs-form">
    <input id="sync-source-repo" value="acme/sync-config">
    <input id="sync-source-branch" value="main">
    <input id="sync-source-path" value="ghsync-repositories.json">
    <input id="sync-machine" value="devbox">
    <input id="sync-groups" value="development">
  </div>
</section>
<section class="ghs-tab-panel ghs-hidden" id="panel-settings"><div class="ghs-form"></div></section>
</body></html>`, { url: "https://example.test/" });

let meta = {
  groups: { "acme/api": "development" },
  groupDefinitions: ["development", "staging"],
  tags: {}, favorites: {}, policies: {}
};
let writtenManifest = null;
const remoteManifest = {
  version: 1,
  repositories: [
    { name: "acme/api", url: "https://github.com/acme/api.git", machines: ["devbox"] },
    { name: "acme/web", url: "https://github.com/acme/web.git", machines: ["devbox"] }
  ],
  groups: { shared: ["acme/web"] },
  machines: { devbox: { groups: ["development"] } }
};

function encode(text) { return Buffer.from(text, "utf8").toString("base64"); }
function spawn(argv) {
  const joined = argv.join(" ");
  if (argv[0] === "cat") return Promise.resolve(JSON.stringify(meta));
  if (argv[0] === "mkdir") return Promise.resolve("");
  if (argv[0] === "gh" && argv[1] === "api") {
    if (joined.includes("--method PUT")) {
      const contentArg = argv.find(v => v.startsWith("content="));
      writtenManifest = JSON.parse(Buffer.from(contentArg.slice("content=".length), "base64").toString("utf8"));
      return Promise.resolve(JSON.stringify({ content: { sha: "new-sha" } }));
    }
    if (joined.includes("/contents/ghsync-repositories.json")) {
      return Promise.resolve(JSON.stringify({ type: "file", sha: "old-sha", content: encode(JSON.stringify(remoteManifest)) }));
    }
  }
  return Promise.resolve("");
}

const manager = {
  actions: [],
  registerAction(action) { this.actions.push(action); },
  runCore(args) {
    if (args[0] === "check") return Promise.resolve([
      "check\tconfig\t/tmp/ghsync/config",
      "check\thost\t",
      "check\tfilter\tblob:none",
      "check\tmirror\tfalse",
      "check\tjobs\t4"
    ].join("\n") + "\n");
    if (args[0] === "pull") return Promise.resolve("up-to-date\t" + args[1] + "\tmain\n");
    return Promise.resolve("");
  },
  statusSnapshot() {
    return Promise.resolve([
      { name: "acme/api", branch: "main", dirty: 0, ahead: 0, behind: 0, stashes: 0, unpushed: 0 },
      { name: "acme/web", branch: "main", dirty: 1, ahead: 2, behind: 0, stashes: 0, unpushed: 0 }
    ]);
  },
  runGit(name, args) {
    if (args[0] === "remote") return Promise.resolve("https://github.com/" + name + ".git\n");
    if (args[0] === "rev-parse") return Promise.resolve("origin/main\n");
    if (args[0] === "push") return Promise.resolve("");
    return Promise.resolve("");
  },
  mapLimit(items, limit, worker) { return Promise.all(items.map(worker)); },
  repositoryRoot() { return Promise.resolve("/tmp/repos"); },
  refreshMainPage() {}
};

dom.window.GHSyncRepoManager = manager;
dom.window.GHSyncSharedList = {
  normalizeManifest(value) { return JSON.parse(JSON.stringify(value)); },
  mergeLocal(manifest, entries, current) {
    const out = JSON.parse(JSON.stringify(manifest));
    const byName = Object.fromEntries((out.repositories || []).map(r => [r.name, r]));
    entries.forEach(entry => {
      if (!byName[entry.name]) {
        byName[entry.name] = { name: entry.name, url: entry.url, machines: [current.machine] };
        out.repositories.push(byName[entry.name]);
      }
    });
    return out;
  }
};
dom.window.cockpit = {
  spawn,
  file() { return { replace(text) { meta = JSON.parse(text); return Promise.resolve(); } }; },
  transport: { control() {} }
};
dom.window.confirm = () => true;
dom.window.alert = () => {};
dom.window.prompt = () => null;

const context = vm.createContext(dom.window);
vm.runInContext(fs.readFileSync("cockpit/repo-feature-groups.js", "utf8"), context);
vm.runInContext(fs.readFileSync("cockpit/repo-feature-groups-management.js", "utf8"), context);

const doc = dom.window.document;
function assert(cond, msg) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
  if (!cond) process.exitCode = 1;
}

setTimeout(async () => {
  assert(!!doc.querySelector('.ghs-tab[data-tab="groups"]'), "Groups tab is present");
  assert(!!doc.getElementById("panel-groups"), "Groups panel is present");
  assert(!!doc.getElementById("repo-group-filter"), "repository table has a group filter");
  const filterOptions = [...doc.getElementById("repo-group-filter").options].map(o => o.value);
  assert(filterOptions.includes("development") && filterOptions.includes("staging"), "defined groups appear in repository filter");

  const api = dom.window.GHSyncGroups;
  assert(api.localMembers(meta, "development").join(",") === "acme/api", "local group membership is readable");
  api.setMembers(meta, "development", ["acme/api", "acme/web"]);
  assert(api.localMembers(meta, "development").join(",") === "acme/api,acme/web", "membership helper assigns repositories");
  const share = api.sharedGroups(meta);
  assert(share.development.length === 2 && Array.isArray(share.staging), "local groups serialize for the shared manifest");

  doc.querySelector('.ghs-tab[data-tab="groups"]').dispatchEvent(new dom.window.Event("click"));
  await new Promise(r => setTimeout(r, 30));
  assert(!doc.getElementById("panel-groups").classList.contains("ghs-hidden"), "Groups tab opens");
  assert(doc.querySelectorAll("#groups-members-body tr").length === 2, "local repositories are listed for membership editing");
  assert(doc.getElementById("btn-group-pull").disabled === false, "group actions are enabled when a group is selected");

  doc.getElementById("btn-groups-shared-refresh").dispatchEvent(new dom.window.Event("click"));
  await new Promise(r => setTimeout(r, 40));
  const groupsAfterRefresh = [...doc.getElementById("groups-select").options].map(o => o.value);
  assert(groupsAfterRefresh.includes("shared"), "shared-manifest groups are discoverable");
  assert(api.effectiveMembers(meta, "shared").includes("acme/web"), "shared members participate in group operations");

  doc.getElementById("btn-groups-shared-push").dispatchEvent(new dom.window.Event("click"));
  await new Promise(r => setTimeout(r, 60));
  assert(writtenManifest !== null, "Push groups writes the shared manifest");
  assert(writtenManifest.groups.development.includes("acme/api"), "published manifest contains local group membership");
  assert(Object.prototype.hasOwnProperty.call(writtenManifest.groups, "staging"), "empty named groups are preserved in the manifest");

  console.log("repository groups feature smoke test passed");
}, 20);
