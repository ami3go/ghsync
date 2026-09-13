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

function readCockpit(name) {
    return fs.readFileSync(path.join(DIR, name), "utf8");
}

console.log("\n--- theme safety ---");
fs.readdirSync(DIR).filter((name) => name.endsWith(".js")).forEach((name) => {
    const source = readCockpit(name);
    const hardCodedWhiteBackground = /background\s*:\s*(?:#fff(?:fff)?|white)\b/i.test(source);
    assert(!hardCodedWhiteBackground, `${name} avoids hard-coded white backgrounds`);
});

["repo-feature-details.js", "repo-feature-history.js"].forEach((name) => {
    const source = readCockpit(name);
    assert(source.includes("background:var(--ghs-surface)"), `${name} uses the themed surface token`);
    assert(source.includes("color:var(--ghs-text)"), `${name} uses the themed text token`);
    assert(source.includes("border:1px solid var(--ghs-border)"), `${name} uses the themed border token`);
});

const legacyMenuSource = readCockpit("thirdparty.js");
assert(legacyMenuSource.includes("background:var(--ghs-surface,#fff)"), "legacy repository menu uses the themed surface token");
assert(legacyMenuSource.includes("color:var(--ghs-text,#151515)"), "legacy repository menu uses the themed text token");
assert(legacyMenuSource.includes("background:var(--ghs-surface-alt,#f5f5f5)"), "legacy repository menu hover follows the themed alternate surface");

const popoverCss = readCockpit("repo-feature-row-actions-popover.css");
assert(/\.ghs-context-overlay\s*\{[\s\S]*?background:\s*var\(--ghs-surface/.test(popoverCss),
       "repository popover uses the themed surface token");
assert(/\.ghs-context-overlay\s*\{[\s\S]*?color:\s*var\(--ghs-text/.test(popoverCss),
       "repository popover uses the themed text token");
assert(/\.ghs-context-overlay button:hover[\s\S]*?background:\s*var\(--ghs-surface-alt/.test(popoverCss),
       "repository popover hover follows the themed alternate surface");

function loadFeature() {
    const script = doc.createElement("script");
    script.textContent = readCockpit("repo-feature-row-actions-popover.js");
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
