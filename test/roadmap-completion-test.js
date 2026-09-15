"use strict";

const fs = require("fs");
const path = require("path");

function read(name) {
  return fs.readFileSync(path.join(process.cwd(), name), "utf8");
}
function assert(cond, message) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + message);
  if (!cond) process.exitCode = 1;
}
function includes(file, ...needles) {
  const text = read(file);
  needles.forEach(needle => assert(text.includes(needle), `${file} contains ${needle}`));
  return text;
}

const manifest = JSON.parse(read("cockpit/repo-features.json"));
const requiredFeatures = [
  "repo-feature-sync-preview.js",
  "repo-feature-groups-management.js",
  "repo-feature-bulk-actions.js",
  "repo-feature-policy.js",
  "repo-feature-branch-overview.js",
  "repo-feature-reliability-center.js",
  "repo-feature-github-insights.js",
  "repo-feature-storage-config.js",
  "repo-feature-activity-recovery.js",
  "repo-feature-metadata.js",
  "repo-feature-risk-backup.js"
];
requiredFeatures.forEach(name => assert(manifest.includes(name), `feature manifest loads ${name}`));

const preview = includes("cockpit/repo-feature-sync-preview.js", "Full sync preview", "Proceed with Full sync", "sync-preview.json", "local not assigned (kept)");
assert(!/reset\s+--hard|rm\s+-rf/.test(preview), "Full-sync preview has no reset/delete path");

const groups = includes("cockpit/repo-feature-groups-management.js", "Pull group", "Push group", "Sync group", "Push groups to shared manifest");
assert(groups.includes("groupDefinitions"), "first-class groups keep named definitions");

const bulk = includes("cockpit/repo-feature-bulk-actions.js", "Pull selected", "Push selected", "Check updates selected", "Commit selected", "Group / labels selected");
assert(!/--force(?:-with-lease)?/.test(bulk), "bulk actions never force-push");

const policy = includes("cockpit/repo-feature-policy.js", '"manual"', '"pull-only"', '"pull+push"', '"fetch-only"', "groupPolicies", "machinePolicies", "Run policies");
assert(policy.includes('value === "automatic"') && policy.includes('value === "ignore"'), "legacy policy values are migrated safely");

const branch = includes("cockpit/repo-feature-branch-overview.js", "Local branches", "Remote branches", "Ahead", "Behind", "Last commit", "merged", "stale", '"branch", "-d"');
assert(!branch.includes('"branch", "-D"'), "branch cleanup never force-deletes");

const maintenance = includes("bin/ghsync-maintenance", "fetch --all --prune --tags", "gc --auto", "fsck --connectivity-only", "--submodules", "maintenance.log");
assert(!/reset\s+--hard|clean\s+-fd/.test(maintenance), "scheduled maintenance avoids destructive worktree cleanup");

includes("cockpit/repo-feature-reliability-center.js", "Healthy", "Attention", "Problem", "Repository health", "Maintenance timer", "Restore copy", "Run diagnostics", "GitHub authentication", "Shared manifest", "SSH connectivity");
includes("cockpit/repo-feature-backup.js", "metadata.json", "keepLast", "recovery", "repository.bundle", "apply --index");

const github = includes("cockpit/repo-feature-github-insights.js", "5 * 60 * 1000", "Enable workflow status", "Include open PR and issue counts", "GitHub Actions failed", "--hostname");
assert(github.includes('localStorage.getItem(ENABLED_KEY) === "yes"'), "GitHub API integration is opt-in");

const storage = includes("cockpit/repo-feature-storage-config.js", ".git", "git gc --auto", "Export configuration", "Apply restored configuration", "No credentials", "token|password|secret|credential", "thirdPartyTsv");
assert(!storage.includes("gh auth token"), "configuration migration never exports gh auth tokens");

const activity = includes("cockpit/repo-feature-activity-recovery.js", "Activity timeline", "All actions", "All severities", "Raw log", "Recovery actions", "gh auth login", "stash", "Set upstream");
assert(!/reset\s+--hard/.test(activity), "recovery actions avoid hard reset");

includes("cockpit/repo-feature-metadata.js", "labels", "notes", "labelRules", "groupPolicies", "machinePolicies", "Share labels and notes through the fleet manifest", "Publish shared metadata");
includes("cockpit/repo-feature-risk-backup.js", "Create a recovery backup", "Cleanup was not started");

const roadmap = read("ROADMAP.md");
assert(!roadmap.includes("- [ ]"), "ROADMAP.md has no unchecked planned implementation items");
assert(roadmap.includes("- [x] Preview what Full sync will do"), "roadmap records Full-sync preview completion");
assert(roadmap.includes("- [x] Add repository selection checkboxes"), "roadmap records bulk-action completion");
assert(roadmap.includes("- [x] Add a diagnostics / health section"), "roadmap records diagnostics completion");
assert(roadmap.includes("- [x] Add a human-readable event timeline"), "roadmap records timeline completion");

console.log("roadmap completion regression checks finished");
