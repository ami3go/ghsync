"use strict";

const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const dom = new JSDOM(`<!doctype html><html><head></head><body>
<div class="ghs-tabs" role="tablist">
  <button class="ghs-tab ghs-tab--current" data-tab="repos">Repositories</button>
  <button class="ghs-tab" data-tab="notifications">Notifications</button>
  <button class="ghs-tab" data-tab="settings">Settings</button>
</div>
<section class="ghs-tab-panel" id="panel-repos"><table><tbody id="repos"></tbody></table></section>
<section class="ghs-tab-panel ghs-hidden" id="panel-notifications"></section>
<section class="ghs-tab-panel ghs-hidden" id="panel-settings"></section>
<button id="btn-refresh" type="button">Refresh</button>
</body></html>`, { url: "https://example.test/" });

const statusRows = [
  { name: "acme/api", branch: "main", dirty: 0, ahead: 0, behind: 0, stashes: 0, unpushed: 0 },
  { name: "acme/web", branch: "main", dirty: 2, ahead: 0, behind: 2, stashes: 0, unpushed: 0 },
  { name: "acme/infra", branch: "detached", dirty: 0, ahead: 2, behind: 0, stashes: 0, unpushed: 1 },
  { name: "acme/new", branch: "main", dirty: 0, ahead: 0, behind: 0, stashes: 0, unpushed: 0 }
];

function gitResult(name, args) {
  const cmd = args.join(" ");
  if (cmd.startsWith("symbolic-ref")) {
    if (name === "acme/infra") return Promise.reject(new Error("detached"));
    return Promise.resolve("main\n");
  }
  if (cmd.includes("@{u}")) {
    if (name === "acme/infra" || name === "acme/new") return Promise.reject(new Error("no upstream"));
    return Promise.resolve("origin/main\n");
  }
  return Promise.resolve("");
}

const registered = ["Push", "Details…", "Branches…", "Stash changes"].map(label => ({ label, run: () => Promise.resolve() }));
const manager = {
  actions: registered,
  statusSnapshot: () => Promise.resolve(statusRows),
  mapLimit(items, limit, worker) { return Promise.all(items.map(worker)); },
  runCore(args) {
    if (args[0] === "check") return Promise.resolve("check\tlog\t/tmp/ghsync.log\n");
    if (args[0] === "pull") return Promise.resolve("updated\t" + args[1] + "\tfast-forward\nsummary\t1\t\n");
    return Promise.resolve("");
  },
  runGit: gitResult,
  refreshMainPage: () => {}
};

dom.window.GHSyncRepoManager = manager;
dom.window.cockpit = {
  transport: { control: () => {} },
  spawn(argv) {
    if (argv[0] === "tail") {
      return Promise.resolve([
        "2026-09-15 10:00:00  updated  acme/api",
        "2026-09-15 10:00:01  failed  acme/infra  fetch: could not read from remote",
        "2026-09-15 10:00:02  summary  4 repositories"
      ].join("\n") + "\n");
    }
    return Promise.resolve("");
  }
};
dom.window.alert = () => {};
const context = vm.createContext(dom.window);
vm.runInContext(fs.readFileSync("cockpit/repo-feature-attention.js", "utf8"), context);

const doc = dom.window.document;
const api = dom.window.GHSyncAttention;
if (!api) throw new Error("attention test API missing");
if (!doc.querySelector('.ghs-tab[data-tab="attention"]')) throw new Error("Attention tab missing");
if (!doc.getElementById("panel-attention")) throw new Error("Attention panel missing");
if (!doc.getElementById("ghs-attention-css")) throw new Error("Attention stylesheet not loaded");

const failures = api.parseLatestFailures([
  "old failed acme/old old error",
  "old summary 1",
  "2026-09-15 failed acme/infra fetch denied",
  "2026-09-15 summary 4"
].join("\n"));
if (!failures["acme/infra"] || failures["acme/old"]) throw new Error("latest failure parsing did not isolate latest run");

let issues = api.buildIssues(statusRows[1], { detached: false, upstream: true, upstreamName: "origin/main" }, {});
let keys = issues.map(i => i.key).sort();
if (keys.join(",") !== "behind,dirty") throw new Error("dirty/behind issues were not detected");
let actions = api.actionNames(statusRows[1], { detached: false, upstream: true }, issues);
if (!actions.includes("Stash changes") || actions.includes("Pull")) throw new Error("dirty-behind remediation is unsafe");

const cleanBehind = { name: "acme/web", branch: "main", dirty: 0, ahead: 0, behind: 2, stashes: 0, unpushed: 0 };
issues = api.buildIssues(cleanBehind, { detached: false, upstream: true }, {});
actions = api.actionNames(cleanBehind, { detached: false, upstream: true }, issues);
if (!actions.includes("Pull")) throw new Error("safe pull was not recommended");

const diverged = { name: "acme/diverged", branch: "main", dirty: 0, ahead: 2, behind: 3, stashes: 0, unpushed: 0 };
issues = api.buildIssues(diverged, { detached: false, upstream: true }, {});
actions = api.actionNames(diverged, { detached: false, upstream: true }, issues);
if (!issues.some(i => i.key === "diverged") || actions.includes("Pull") || actions.includes("Push")) throw new Error("diverged repository offered an unsafe mutation");

const noUpstream = statusRows[3];
issues = api.buildIssues(noUpstream, { detached: false, upstream: false }, {});
actions = api.actionNames(noUpstream, { detached: false, upstream: false }, issues);
if (!issues.some(i => i.key === "no-upstream") || !actions.includes("Push")) throw new Error("missing upstream remediation was not offered");

setTimeout(() => {
  const badge = doc.getElementById("attention-count");
  if (badge.textContent !== "3") throw new Error("attention badge should report three repositories, got " + badge.textContent);
  doc.querySelector('.ghs-tab[data-tab="attention"]').click();
  setTimeout(() => {
    const rows = [...doc.querySelectorAll("#attention-body tr")];
    if (rows.length !== 3) throw new Error("expected three attention rows, got " + rows.length);
    const infra = rows.find(row => row.children[0].textContent === "acme/infra");
    if (!infra || !infra.textContent.includes("Latest sync failed") || !infra.textContent.includes("Detached HEAD")) throw new Error("failure/detached context missing for infra");
    if (!infra.textContent.includes("Branches…") || !infra.textContent.includes("Notifications")) throw new Error("infra recommended actions missing");
    const web = rows.find(row => row.children[0].textContent === "acme/web");
    if (!web.textContent.includes("Stash changes") || web.textContent.includes("Pull")) throw new Error("web row offered unsafe pull before stash");
    console.log("attention dashboard feature smoke test passed");
  }, 50);
}, 250);
