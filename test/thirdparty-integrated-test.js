"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const DIR = path.join(__dirname, "..", "cockpit");
const dom = new JSDOM(`<!doctype html><html><head></head><body>
<div class="ghs-tabs" role="tablist">
  <button class="ghs-tab ghs-tab--current" data-tab="repos" aria-selected="true">Repositories</button>
  <button class="ghs-tab" data-tab="stats" aria-selected="false">Statistics</button>
</div>
<section id="panel-repos">
  <div class="ghs-toolbar">
    <div class="ghs-search"><input id="filter"></div>
    <span class="ghs-toolbar__spacer"></span>
    <button id="btn-orphans">Find orphans</button>
    <span id="repo-count"></span>
  </div>
  <div class="ghs-table-wrap"><table><tbody id="repos">
    <tr><td class="ghs-repo-name">acme/api</td><td>main</td><td>Clean</td><td>0</td><td>0</td><td>0</td><td>0</td><td class="ghs-table__action"><button>Pull</button><button>Commit</button></td></tr>
    <tr><td class="ghs-repo-name">vendor/tool</td><td>main</td><td>Clean</td><td>0</td><td>0</td><td>0</td><td>0</td><td class="ghs-table__action"><button>Pull</button><button>Commit</button></td></tr>
  </tbody></table></div>
  <div id="repos-empty" class="ghs-empty ghs-hidden"><p id="repos-empty-body"></p><button id="btn-empty-clone">Clone missing</button></div>
</section>
</body></html>`, { runScripts: "dangerously", url: "http://localhost/cockpit/ghsync/" });

const { window } = dom;
const doc = window.document;
const calls = [];

function spawn(argv) {
  calls.push(argv.join(" "));
  if (argv[0] === "sh" && argv[1] === "-c") {
    return Promise.resolve(argv[2].includes("ghsync-thirdparty") ? "/usr/local/bin/ghsync-thirdparty\n" : "/usr/local/bin/ghsync\n");
  }
  if (argv[0] === "bash" && argv[1] === "/usr/local/bin/ghsync-thirdparty" && argv[2] === "list") {
    return Promise.resolve([
      "third-party\tvendor/missing\thttps://codeberg.org/vendor/missing.git\tmissing",
      "third-party\tvendor/tool\thttps://gitlab.com/vendor/tool.git\tcloned"
    ].join("\n") + "\n");
  }
  if (argv[0] === "bash" && argv[1] === "/usr/local/bin/ghsync-thirdparty") return Promise.resolve("");
  if (argv[0] === "bash" && argv[1] === "/usr/local/bin/ghsync" && argv[2] === "check") {
    return Promise.resolve("check\troot\t/tmp/repos\n");
  }
  if (argv[0] === "test") return Promise.resolve("");
  return Promise.resolve("");
}

window.cockpit = { spawn, transport: { control() {} } };
window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
window.confirm = () => true;
window.prompt = () => null;

function assert(cond, msg) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
  if (!cond) process.exitCode = 1;
}
function visibleNames() {
  return [...doc.querySelectorAll("#repos tr")]
    .filter(row => row.style.display !== "none")
    .map(row => row.dataset.repoName || row.querySelector(".ghs-repo-name").textContent.trim())
    .sort();
}

const script = doc.createElement("script");
script.textContent = fs.readFileSync(path.join(DIR, "thirdparty.js"), "utf8");
doc.body.appendChild(script);

setTimeout(() => {
  assert(!doc.getElementById("tab-thirdparty"), "dedicated third-party tab is removed");
  assert(!doc.getElementById("panel-thirdparty"), "dedicated third-party panel is removed");
  assert(!!doc.getElementById("repo-source-filter"), "Repositories toolbar has a Source filter");
  assert(!!doc.getElementById("btn-third-add-inline"), "Repositories toolbar keeps Add third-party action");

  const rows = [...doc.querySelectorAll("#repos tr")];
  assert(rows.length === 3, "tracked missing repository is added without duplicating cloned third-party repository");
  const managed = rows.find(row => row.dataset.repoName === "acme/api");
  const clonedThird = rows.find(row => row.dataset.repoName === "vendor/tool");
  const missingThird = rows.find(row => row.dataset.repoName === "vendor/missing");
  assert(managed && managed.dataset.repoSource === "managed", "normal repository is classified as Managed");
  assert(clonedThird && clonedThird.dataset.repoSource === "third-party", "existing local third-party clone is classified in place");
  assert(missingThird && missingThird.dataset.thirdSynthetic === "yes", "missing tracked repository gets a synthetic main-table row");
  assert(clonedThird.querySelector(".ghs-repo-source").textContent === "Third-party", "third-party source is visible in the row");
  assert(clonedThird._ghsyncBuiltins.some(action => action.label === "Untrack"), "local third-party row exposes Untrack");
  assert(missingThird._ghsyncBuiltins.some(action => action.label === "Clone"), "missing third-party row exposes Clone");

  const source = doc.getElementById("repo-source-filter");
  source.value = "third-party";
  source.dispatchEvent(new window.Event("change"));
  assert(visibleNames().join(",") === "vendor/missing,vendor/tool", "Third-party source filter shows only tracked third-party repositories");
  source.value = "managed";
  source.dispatchEvent(new window.Event("change"));
  assert(visibleNames().join(",") === "acme/api", "Managed source filter hides third-party repositories");
  source.value = "";
  source.dispatchEvent(new window.Event("change"));

  const actions = doc.createElement("script");
  actions.textContent = fs.readFileSync(path.join(DIR, "repo-feature-row-actions-popover.js"), "utf8");
  doc.body.appendChild(actions);

  setTimeout(() => {
    const missingPrimary = missingThird.querySelector(".ghs-primary-pull");
    assert(missingPrimary && missingPrimary.textContent === "Clone", "missing third-party repository keeps Clone as the visible primary action");
    assert(doc.getElementById("repo-count").textContent === "3 repositories", "combined repository count includes missing tracked repositories");
    console.log("integrated third-party repositories smoke test passed");
  }, 30);
}, 80);