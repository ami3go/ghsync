const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const DIR = path.join(__dirname, "..", "cockpit");
const dom = new JSDOM(`<!doctype html><html><head></head><body>
<div class="ghs-table-wrap"><table><tbody id="repos"><tr data-repo-name="acme/demo">
<td class="ghs-repo-name">acme/demo</td><td class="ghs-table__action"></td>
</tr></tbody></table></div>
</body></html>`, { runScripts: "dangerously", url: "http://localhost/" });

const { window } = dom;
const doc = window.document;
const row = doc.querySelector("#repos tr");
const cell = row.querySelector(".ghs-table__action");
const tableWrap = doc.querySelector(".ghs-table-wrap");
let pullRuns = 0;
let commitRuns = 0;
let detailsRuns = 0;

row._ghsyncBuiltins = [
    { label: "Pull", run: () => { pullRuns += 1; }, state: {} },
    { label: "Commit", run: () => { commitRuns += 1; }, state: {} }
];
window.GHSyncRepoManager = {
    actions: [{ label: "Details…", run: () => { detailsRuns += 1; } }]
};

function assert(cond, msg) {
    console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
    if (!cond) process.exitCode = 1;
}

function loadFeature() {
    const script = doc.createElement("script");
    script.textContent = fs.readFileSync(path.join(DIR, "repo-feature-row-actions-popover.js"), "utf8");
    doc.body.appendChild(script);
}

function pointerDown(target) {
    target.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
}

loadFeature();

let pull = cell.querySelector(".ghs-primary-pull");
let kebab = cell.querySelector(".ghs-kebab");
assert(!!pull, "Pull remains visible");
assert(!!kebab, "three-dot trigger is rendered");
assert(!!doc.querySelector('link[href$="repo-feature-row-actions-popover.css"]'),
       "packaged popover stylesheet is requested");

pull.click();
assert(pullRuns === 1, "visible Pull action still runs");

pointerDown(kebab);
let menu = doc.querySelector(".ghs-context-overlay");
assert(!!menu, "pointer-down opens the three-dot menu");
assert(kebab.getAttribute("aria-expanded") === "true", "trigger reports expanded state");
assert(menu.parentElement.classList.contains("ghs-row-actions"),
       "menu is anchored to the row controls instead of the end of the document");
assert(!menu.hasAttribute("style"), "menu positioning does not depend on inline styles");
assert(tableWrap.classList.contains("ghs-table-wrap--menu-open"),
       "table clipping is disabled while the menu is open");
assert([...menu.querySelectorAll("button")].some((b) => b.textContent === "Commit"), "built-in Commit action is present");
assert([...menu.querySelectorAll("button")].some((b) => b.textContent === "Details…"), "registered repository action is present");

const commit = [...menu.querySelectorAll("button")].find((b) => b.textContent === "Commit");
commit.click();
assert(commitRuns === 1, "menu action runs");
assert(!doc.querySelector(".ghs-context-overlay"), "menu closes after selecting an action");
assert(!tableWrap.classList.contains("ghs-table-wrap--menu-open"),
       "table clipping mode is restored when the menu closes");

/* Re-open and ensure an outside pointer interaction closes it. */
pointerDown(kebab);
assert(!!doc.querySelector(".ghs-context-overlay"), "menu reopens");
pointerDown(doc.body);
assert(!doc.querySelector(".ghs-context-overlay"), "outside interaction closes the menu");

/* Simulate the repository manager rebuilding the action cell while leaving stale dataset state. */
cell.textContent = "";
cell.dataset.contextOverlayReady = "v3";
cell.removeAttribute("data-manager-ready");
const temporary = doc.createElement("div");
temporary.className = "ghs-menu-wrap";
cell.appendChild(temporary);

setTimeout(() => {
    pull = cell.querySelector(".ghs-primary-pull");
    kebab = cell.querySelector(".ghs-kebab");
    assert(!!pull && !!kebab, "menu controls recover after the action cell is rebuilt");
    pointerDown(kebab);
    menu = doc.querySelector(".ghs-context-overlay");
    assert(!!menu, "three-dot menu still opens after a cell rebuild");
    assert(menu && menu.parentElement.classList.contains("ghs-row-actions"),
           "rebuilt menu remains anchored to its repository row");

    const details = menu && [...menu.querySelectorAll("button")].find((b) => b.textContent === "Details…");
    if (details) details.click();
    assert(detailsRuns === 1, "registered action still runs after rebuild");
}, 20);
