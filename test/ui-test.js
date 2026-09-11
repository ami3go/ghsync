/* DOM test for the Cockpit page.
 *
 *   npm install jsdom && node test/ui-test.js
 *
 * Loads cockpit/index.html and ghsync.js in jsdom against a stubbed cockpit
 * API that replays realistic --porcelain output, then asserts what the page
 * renders. No server, no Cockpit install and no network needed. */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const DIR = path.join(__dirname, "..", "cockpit");
const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8")
    .replace('<script src="../base1/cockpit.js"></script>', "");

const CHECK = [
    "check\tgit\t2.43.0", "check\tgh\t2.62.0", "check\tauth\tyes", "check\tuser\toctocat",
    "check\troot\t/home/octocat/github", "check\towners\tacme", "check\tproto\tssh",
    "check\tjobs\t4", "check\tlimit\t1000", "check\tforks\tfalse", "check\tarchived\ttrue",
    "check\tlocal\t3", "check\tcron\t0 */6 * * * /usr/local/bin/ghsync sync --quiet # ghsync",
    "check\tlog\t/home/octocat/.local/state/ghsync/ghsync.log",
    "check\tconfig\t/home/octocat/.config/ghsync/config",
    "check\thost\t", "check\tfilter\tblob:none", "check\tmirror\tfalse",
    "check\texclude\tacme/huge-*", "check\tnotify\ttrue", "check\tfailed\t2",
    "check\ttimer\t"
].join("\n") + "\n";

const STATUS = [
    "repo\tacme/api\tmain\t0\t0\t0\t0\t0",
    "repo\tacme/web\tmain\t3\t0\t2\t0\t0",
    "repo\tacme/infra\tdetached\t0\t2\t0\t1\t1",
    "summary\t3\t"
].join("\n") + "\n";

const NOW = Math.floor(Date.now() / 1000);
const STATS = [
    "stat\tacme/api\t1284\t3\t12\t" + (NOW - 3600) + "\tOctavia Cat\t524288",
    "stat\tacme/web\t97\t1\t0\t" + (NOW - 86400 * 200) + "\tSam Smith\t2048",
    "stat\tacme/infra\t0\t0\t0\t0\t\t512",
    "summary\t3\t"
].join("\n") + "\n";

const PULL = [
    "updated\tacme/api\tmain, +4 commits",
    "dirty\tacme/web\tfetched, local changes left untouched",
    "failed\tacme/infra\tfetch: could not read from remote",
    "summary\t3\t"
].join("\n") + "\n";

const calls = [];
let writtenConfig = null;

function fakeSpawn(argv) {
    calls.push(argv.join(" "));
    let out = "";
    const joined = argv.join(" ");
    if (joined.includes("for p in")) out = "/usr/local/bin/ghsync\n";
    else if (joined.includes(" check")) out = CHECK;
    else if (joined.includes(" status")) out = STATUS;
    else if (joined.includes(" stats")) out = STATS;
    else if (joined.includes(" pull") || joined.includes(" clone") || joined.includes(" sync")) out = PULL;
    else if (joined.includes(" retry")) out = "cloned\tacme/infra\t\nsummary\t1\t\n";
    else if (joined.includes(" orphans")) out = "orphan\tacme/old\tnot returned by GitHub any more\nsummary\t1\t\n";
    else if (joined.includes("tail -n")) out = "2026-09-06 10:00:00  updated  acme/api\n";

    let streamCb = null;
    const p = new Promise((resolve) => {
        setTimeout(() => {
            if (streamCb && out) streamCb(out);
            resolve(out);
        }, 0);
    });
    p.stream = (cb) => { streamCb = cb; return p; };
    p.close = () => {};
    return p;
}

const virtualConsole = new VirtualConsole();
const errors = [];
virtualConsole.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
virtualConsole.on("error", (m) => errors.push("console.error: " + m));

const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://localhost/cockpit/ghsync/index.html",
    virtualConsole,
    beforeParse(window) {
        window.cockpit = {
            spawn: fakeSpawn,
            file: (p) => ({ replace: (t) => { writtenConfig = { path: p, text: t }; return Promise.resolve(); } }),
            transport: { control: () => {} }
        };
    }
});

const { window } = dom;
const doc = window.document;
const $ = (id) => doc.getElementById(id);

function assert(cond, msg) {
    console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
    if (!cond) process.exitCode = 1;
}

// inject the page script after the stub is in place
const script = doc.createElement("script");
script.textContent = fs.readFileSync(path.join(DIR, "ghsync.js"), "utf8");
doc.body.appendChild(script);

setTimeout(() => {
    console.log("\n--- overview ---");
    assert($("v-gh").textContent.includes("2.62.0"), "gh version rendered as a label");
    assert($("v-user").textContent.includes("octocat"), "account rendered");
    assert($("v-root").textContent === "/home/octocat/github", "repository root rendered");
    assert($("v-local").textContent === "3 repositories", "clone count pluralised");
    assert($("v-cron").textContent.includes("Every 6 hours"), "cron expression humanised");
    assert($("v-attention").textContent.includes("2 repositories"), "attention count computed");
    assert($("v-unpushed").textContent.includes("1 repository"), "local-only work counted");
    assert(doc.querySelector(".ghs-alert--warning") !== null, "warned about work that exists only locally");
    assert(!$("btn-retry").classList.contains("ghs-hidden"), "retry button shown when failures are pending");

    console.log("\n--- repository table ---");
    const rows = doc.querySelectorAll("#repos tr");
    assert(rows.length === 3, "three rows rendered (got " + rows.length + ")");
    assert(rows[0].children[0].textContent === "acme/api", "sorted by name");
    assert(rows[2].children[2].textContent.includes("Uncommitted"), "dirty repo labelled");
    assert($("repos-empty").classList.contains("ghs-hidden"), "empty state hidden when rows exist");
    assert($("repo-count").textContent === "3 repositories", "toolbar count rendered");

    const apiRow = [...rows].find((r) => r.children[0].textContent === "acme/api");
    const webRow = [...rows].find((r) => r.children[0].textContent === "acme/web");
    const infraRow = [...rows].find((r) => r.children[0].textContent === "acme/infra");
    const button = (row, text) => [...row.querySelectorAll("button")].find((b) => b.textContent === text);
    assert(button(apiRow, "Pull") !== undefined && button(apiRow, "Commit") !== undefined,
           "Pull and Commit actions render side by side");
    assert(button(apiRow, "Commit").disabled === true, "commit disabled for a clean repository");
    assert(button(webRow, "Commit").disabled === false, "commit enabled for a dirty repository");
    assert(button(infraRow, "Commit").disabled === true, "commit disabled on detached HEAD");

    console.log("\n--- filter ---");
    $("filter").value = "web";
    $("filter").dispatchEvent(new window.Event("input"));
    assert(doc.querySelectorAll("#repos tr").length === 1, "filter narrows the table");
    assert($("repo-count").textContent === "1 of 3 repositories", "filtered count rendered");
    $("filter").value = "zzz";
    $("filter").dispatchEvent(new window.Event("input"));
    assert(!$("repos-empty").classList.contains("ghs-hidden"), "empty state shown for no matches");
    assert($("btn-empty-clone").classList.contains("ghs-hidden"), "clone CTA hidden when filtering");
    $("filter").value = "";
    $("filter").dispatchEvent(new window.Event("input"));

    console.log("\n--- new state columns ---");
    const infra = [...doc.querySelectorAll("#repos tr")].find((r) => r.children[0].textContent === "acme/infra");
    assert(infra.children[2].textContent.includes("Unpushed commits"), "unpushed work outranks other states");
    assert(infra.children[6].textContent === "4", "local-only column sums ahead, stashes and branches");

    console.log("\n--- settings form ---");
    assert($("f-root").value === "/home/octocat/github", "root prefilled");
    assert($("f-owners").value === "acme", "owners prefilled");
    assert($("f-archived").checked === true, "archived switch reflects config");
    assert($("f-forks").checked === false, "forks switch reflects config");
    assert($("f-limit").value === "1000", "limit prefilled");
    assert($("f-exclude").value === "acme/huge-*", "exclude patterns prefilled");
    assert($("f-filter").value === "blob:none", "clone filter prefilled");
    assert($("f-notify").checked === true, "notify switch prefilled");
    assert($("f-mirror").checked === false, "mirror switch prefilled");

    console.log("\n--- tabs ---");
    doc.querySelector('[data-tab="settings"]').dispatchEvent(new window.Event("click"));
    assert(!$("panel-settings").classList.contains("ghs-hidden"), "settings panel shown");
    assert($("panel-repos").classList.contains("ghs-hidden"), "repos panel hidden");
    assert(doc.querySelector('[data-tab="settings"]').getAttribute("aria-selected") === "true", "aria-selected updated");

    console.log("\n--- save settings ---");
    $("f-jobs").value = "8";
    $("btn-save").dispatchEvent(new window.Event("click"));

    setTimeout(() => {
        assert(writtenConfig && writtenConfig.path === "/home/octocat/.config/ghsync/config", "config written to right path");
        assert(/JOBS=8/.test(writtenConfig.text), "edited value persisted");
        assert(/INCLUDE_ARCHIVED=true/.test(writtenConfig.text), "switch persisted");
        assert(/CLONE_FILTER="blob:none"/.test(writtenConfig.text), "clone filter persisted");
        assert(/EXCLUDE="acme\/huge-\*"/.test(writtenConfig.text), "exclude patterns persisted");
        assert(/NOTIFY=true/.test(writtenConfig.text), "notify setting persisted");
        assert(doc.querySelector(".ghs-alert--success") !== null, "success alert shown");

        console.log("\n--- run an action ---");
        $("btn-pull").dispatchEvent(new window.Event("click"));

        setTimeout(() => {
            assert(!$("panel-activity").classList.contains("ghs-hidden"), "activity tab auto-selected");
            const log = $("console").textContent;
            assert(/updated/.test(log) && /acme\/api/.test(log), "streamed rows rendered in the log");
            assert(/\+4 commits/.test(log), "detail column rendered");
            assert($("counters").textContent.includes("1 failed"), "counters chip rendered");
            assert(doc.querySelector(".ghs-alert--danger") !== null, "failure alert raised");
            assert(calls.some((c) => c.includes("pull --porcelain")), "backend invoked with --porcelain");

            console.log("\n--- statistics tab ---");
            doc.querySelector('[data-tab="stats"]').dispatchEvent(new window.Event("click"));
            setTimeout(() => {
                assert(calls.some((c) => c.includes("stats --porcelain")), "stats fetched lazily on first open");
                const srows = doc.querySelectorAll("#stats-body tr");
                assert(srows.length === 3, "a row per repository (got " + srows.length + ")");
                assert(srows[0].children[0].textContent === "acme/api", "sorted by commits descending by default");
                assert(srows[0].children[1].textContent.includes("1,284"), "commit count is thousands-separated");
                assert(srows[0].children[1].querySelector(".ghs-bar__fill").style.width === "100%",
                       "busiest repo fills its bar");
                assert(srows[0].children[4].textContent === "512 MiB", "size rendered in human units");
                assert(srows[0].children[5].textContent === "1 hour ago", "last commit shown as relative time");
                assert(srows[0].children[5].title.length > 0, "absolute timestamp available on hover");
                assert(srows[2].children[5].textContent === "no commits", "empty repository handled");
                assert(srows[1].children[5].className.includes("ghs-stale"), "200-day-old commit marked stale");
                assert($("m-size").textContent === "515 MiB", "disk usage totalled");
                assert($("m-repos").textContent === "3", "repository metric");
                assert($("m-commits").textContent === "1,381", "commits are totalled");
                assert($("m-branches").textContent === "4", "branches are totalled");
                assert($("m-last").textContent === "1 hour ago", "most recent activity surfaced");

                doc.querySelector('[data-sort="name"]').dispatchEvent(new window.Event("click"));
                assert(doc.querySelectorAll("#stats-body tr")[0].children[0].textContent === "acme/api",
                       "sorting by name ascending");
                doc.querySelector('[data-sort="name"]').dispatchEvent(new window.Event("click"));
                assert(doc.querySelectorAll("#stats-body tr")[0].children[0].textContent === "acme/web",
                       "clicking the same header reverses direction");
                assert(doc.querySelector('[data-sort="name"]').className.includes("ghs-sort--desc"),
                       "sort indicator reflects direction");

                $("stats-filter").value = "infra";
                $("stats-filter").dispatchEvent(new window.Event("input"));
                assert(doc.querySelectorAll("#stats-body tr").length === 1, "statistics filter works");
                assert($("m-repos").textContent === "1", "metrics follow the filter");
                $("stats-filter").value = "";
                $("stats-filter").dispatchEvent(new window.Event("input"));

                runSchedule();
            }, 40);

            function runSchedule() {
            console.log("\n--- schedule ---");
            doc.querySelector('[data-tab="schedule"]').dispatchEvent(new window.Event("click"));
            assert($("cron-line").textContent.includes("ghsync sync --quiet"), "current crontab line shown");
            assert($("f-sched").value === "0 */6 * * *", "matching preset selected");
            $("f-sched").value = "custom";
            $("f-sched").dispatchEvent(new window.Event("change"));
            assert(!$("g-custom").classList.contains("ghs-hidden"), "custom field revealed");
            $("f-custom").value = "not valid";
            $("btn-cron-install").dispatchEvent(new window.Event("click"));
            assert(doc.querySelector(".ghs-alert--warning") !== null, "invalid cron expression rejected");
            $("f-custom").value = "30 2 * * 0";
            $("btn-cron-install").dispatchEvent(new window.Event("click"));

            $("f-backend").value = "timer";
            $("f-sched").value = "custom";
            $("btn-cron-install").dispatchEvent(new window.Event("click"));
            assert(doc.querySelectorAll(".ghs-alert--warning").length > 0,
                   "custom expression refused for the systemd timer");
            $("f-sched").value = "0 3 * * *";
            $("btn-cron-install").dispatchEvent(new window.Event("click"));

            setTimeout(() => {
                assert(calls.some((c) => c.includes("cron install 30 2 * * 0")), "cron install passed through");
                assert(calls.some((c) => c.includes("timer install *-*-* 03:00:00")),
                       "preset translated to an OnCalendar value");
                console.log("\n--- runtime errors ---");
                assert(errors.length === 0, "no console/jsdom errors" + (errors.length ? ": " + errors.join(" | ") : ""));
                console.log("\ncalls made to the backend:");
                [...new Set(calls)].forEach((c) => console.log("  " + c));
            }, 30);
            }
        }, 40);
    }, 30);
}, 60);
