"use strict";

const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const dom = new JSDOM(`<!doctype html><html><head></head><body>
<article class="ghs-card"><div class="ghs-card__body"><dl class="ghs-dl">
  <div class="ghs-dl__group"><dt>Local clones</dt><dd id="v-local">4 repositories</dd></div>
  <div class="ghs-dl__group"><dt>Needs attention</dt><dd id="v-attention">2</dd></div>
</dl></div></article>
<div class="ghs-tabs" role="tablist">
  <button class="ghs-tab ghs-tab--current" data-tab="repos">Repositories</button>
  <button class="ghs-tab" data-tab="attention">Attention</button>
  <button class="ghs-tab" data-tab="settings">Settings</button>
</div>
<section class="ghs-tab-panel" id="panel-repos"><table><tbody id="repos"></tbody></table></section>
<section class="ghs-tab-panel ghs-hidden" id="panel-settings"></section>
<button id="btn-refresh" type="button">Refresh</button>
</body></html>`, { url: "https://example.test/" });

const rows = [
  { name: "acme/api", branch: "main", dirty: 0, ahead: 0, behind: 0, stashes: 0, unpushed: 0 },
  { name: "acme/web", branch: "main", dirty: 2, ahead: 0, behind: 1, stashes: 0, unpushed: 0 },
  { name: "acme/infra", branch: "main", dirty: 0, ahead: 2, behind: 3, stashes: 0, unpushed: 0 },
  { name: "acme/bad", branch: "main", dirty: 0, ahead: 0, behind: 0, stashes: 0, unpushed: 0 }
];

const tbody = dom.window.document.getElementById("repos");
rows.forEach(repo => {
  const tr = dom.window.document.createElement("tr");
  tr.dataset.repoName = repo.name;
  tr.innerHTML = `<td class="ghs-repo-name">${repo.name}</td><td>${repo.branch}</td><td><span>State</span></td><td></td>`;
  tbody.appendChild(tr);
});

function mapLimit(items, limit, worker) { return Promise.all(items.map(worker)); }

const manager = {
  statusSnapshot: () => Promise.resolve(rows),
  mapLimit,
  rowName: row => row.dataset.repoName,
  runCore(args) {
    if (args[0] === "check") return Promise.resolve("check\tlog\t/tmp/ghsync.log\n");
    return Promise.resolve("");
  },
  runGit(name, args) {
    const command = args.join(" ");
    if (command.includes("@{u}")) return Promise.resolve("origin/main\n");
    if (command.startsWith("fsck")) {
      if (name === "acme/bad") return Promise.reject(new Error("missing blob deadbeef"));
      return Promise.resolve("");
    }
    return Promise.resolve("");
  },
  repoDirectory(name) { return Promise.resolve("/repos/" + name); }
};

dom.window.GHSyncRepoManager = manager;
dom.window.cockpit = {
  transport: { control: () => {} },
  spawn(argv) {
    if (argv[0] === "tail") {
      return Promise.resolve([
        "2026-09-14 08:00:00  failed      acme/api — transient network error",
        "2026-09-14 09:00:00  updated     acme/api — main, +1 commits",
        "2026-09-14 09:00:01  up-to-date  acme/web — main",
        "2026-09-14 09:00:02  updated     acme/infra — main, +2 commits",
        "2026-09-14 09:00:03  updated     acme/bad — main, +1 commits",
        "2026-09-15 10:00:00  failed      acme/bad — fetch: object missing"
      ].join("\n") + "\n");
    }
    if (argv[0] === "du") {
      const path = argv[2] || "";
      const kb = path.includes("acme/api") ? 1024 : path.includes("acme/web") ? 2048 : path.includes("acme/infra") ? 4096 : 8192;
      return Promise.resolve(kb + "\t" + path + "\n");
    }
    return Promise.resolve("");
  }
};

const context = vm.createContext(dom.window);
vm.runInContext(fs.readFileSync("cockpit/repo-feature-health.js", "utf8"), context);

const doc = dom.window.document;
const api = dom.window.GHSyncHealth;
if (!api) throw new Error("health test API missing");
if (!doc.querySelector('.ghs-tab[data-tab="health"]')) throw new Error("Health tab missing");
if (!doc.getElementById("panel-health")) throw new Error("Health panel missing");
if (!doc.getElementById("ghs-health-css")) throw new Error("Health stylesheet not loaded");
if (!doc.getElementById("v-health")) throw new Error("Overview health metric missing");

const parsed = api.parseHistory([
  "2026-09-15 08:00:00  failed      acme/api — first failure",
  "2026-09-15 09:00:00  updated     acme/api — recovered",
  "2026-09-15 10:00:00  failed      acme/web — latest failure"
].join("\n"));
if (!parsed.success["acme/api"] || !parsed.failure["acme/api"] || !parsed.failure["acme/web"]) throw new Error("history parsing failed");

let assessed = api.assess(rows[0], { detached: false, upstream: true, integrity: { ok: true }, sizeKb: 1024 }, parsed);
if (assessed.state !== "healthy") throw new Error("newer success should clear an older failure");
assessed = api.assess(rows[1], { detached: false, upstream: true, integrity: { ok: true }, sizeKb: 2048 }, { success: {}, failure: {} });
if (assessed.state !== "attention" || !assessed.signals.some(s => s.key === "dirty") || !assessed.signals.some(s => s.key === "behind")) throw new Error("attention signals missing");
assessed = api.assess(rows[2], { detached: false, upstream: true, integrity: { ok: true }, sizeKb: 4096 }, { success: {}, failure: {} });
if (assessed.state !== "problem" || !assessed.signals.some(s => s.key === "diverged")) throw new Error("diverged repository should be a problem");

setTimeout(() => {
  const healthRows = [...doc.querySelectorAll("#health-body tr")];
  if (healthRows.length !== 4) throw new Error("expected four health rows, got " + healthRows.length);
  const byRepo = Object.fromEntries(healthRows.map(row => [row.children[0].textContent, row]));
  if (!byRepo["acme/api"].textContent.includes("Healthy")) throw new Error("healthy repository not marked healthy");
  if (!byRepo["acme/web"].textContent.includes("Attention")) throw new Error("dirty/behind repository not marked attention");
  if (!byRepo["acme/infra"].textContent.includes("Problem") || !byRepo["acme/infra"].textContent.includes("Branch diverged")) throw new Error("diverged repository problem signal missing");
  if (!byRepo["acme/bad"].textContent.includes("Integrity check failed") || !byRepo["acme/bad"].textContent.includes("Latest sync failed")) throw new Error("integrity/latest failure signals missing");

  const overview = doc.getElementById("v-health").textContent;
  if (!overview.includes("1 healthy") || !overview.includes("1 attention") || !overview.includes("2 problem")) throw new Error("overview health counts incorrect: " + overview);

  const inline = [...doc.querySelectorAll("#repos .ghs-health-inline")];
  if (inline.length !== 4) throw new Error("repository table should contain four inline health badges");

  doc.querySelector('.ghs-tab[data-tab="health"]').click();
  if (doc.getElementById("panel-health").classList.contains("ghs-hidden")) throw new Error("Health tab did not open");
  console.log("repository health feature smoke test passed");
}, 350);
