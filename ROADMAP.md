# GitHub Sync Roadmap

This file tracks planned improvements for `ghsync`. Items are grouped by priority rather than strict release order.

All items below now have an implementation in the Cockpit application or its installed helpers. The checklist records implemented scope; future refinement and UX work can continue without changing the safety principles at the end of this document.

## Completed foundations

- [x] Clone, pull, commit, status and full repository sync
- [x] Cockpit repository table with row actions
- [x] Clickable repository names that open the GitHub remote
- [x] Third-party repository support
- [x] Notifications tab with unread counter and event history
- [x] Cron and systemd user-timer scheduling
- [x] Repository-list import and export
- [x] Shared repository-list Sync tab for multiple PCs
- [x] Per-machine repository assignments and groups in the shared manifest
- [x] Pull / Push / Sync-now controls for shared repository lists
- [x] GitHub Enterprise host support where applicable
- [x] AppStream metadata for Cockpit Applications discovery

## Priority 1 — Operations and fleet visibility

### Fleet / Machines view

- [x] Add a Machines tab based on the shared repository manifest
- [x] Show machine name / ID, last sync, assigned repository count and status
- [x] Show missing or out-of-sync repositories per machine
- [x] Record last-seen / last-successful-sync metadata for each machine
- [x] Allow filtering repository assignments by machine
- [x] Surface stale/offline machines clearly

### Attention dashboard

- [x] Add a dedicated view for repositories that require action
- [x] Detect dirty working trees
- [x] Detect ahead / behind / diverged branches
- [x] Detect detached HEAD and missing upstreams
- [x] Include failed fetch / pull / push results
- [x] Provide recommended one-click actions where safe
- [x] Link each problem to repository details and relevant notifications

### Full-sync preview / dry run

- [x] Preview what Full sync will do before changing repositories
- [x] Show repositories that will be cloned
- [x] Show repositories that will be pulled
- [x] Show repositories that will be skipped because of conflicts or local-only work
- [x] Show machine-list reconciliation changes
- [x] Add Proceed / Cancel controls
- [x] Reuse the preview data for scheduled-sync diagnostics where possible

## Priority 2 — Repository management

### First-class repository groups

- [x] Add group management UI
- [x] Filter the repository table by group
- [x] Support Pull group
- [x] Support Push group
- [x] Support Sync group
- [x] Allow groups to be stored in the shared manifest

### Bulk actions

- [x] Add repository selection checkboxes
- [x] Add Pull selected
- [x] Add Push selected
- [x] Add Check updates selected
- [x] Add Commit selected where safe
- [x] Add group / tag assignment for selected repositories
- [x] Keep destructive bulk actions explicitly confirmed

### Per-repository sync policy

- [x] Support policies such as manual, pull-only, pull+push and fetch-only
- [x] Allow policy inheritance from groups
- [x] Allow policy overrides per machine
- [x] Store shareable policy in the shared manifest
- [x] Keep credentials and local paths machine-local

### Branch overview

- [x] Show local and remote branches
- [x] Show upstream and ahead / behind counts
- [x] Show last commit time per branch
- [x] Mark merged and stale branches
- [x] Add safe cleanup for merged branches
- [x] Never force-delete branches without explicit confirmation

## Priority 3 — Reliability and maintenance

### Repository health indicators

- [x] Add Healthy / Attention / Problem state per repository
- [x] Include dirty state, ahead / behind, failed fetch and missing upstream
- [x] Include last successful sync
- [x] Include disk usage and repository integrity signals
- [x] Add aggregate health metrics to the Overview card

### Scheduled maintenance

- [x] Add a separate maintenance schedule
- [x] Run `git fetch --prune`
- [x] Run safe `git gc`
- [x] Run `git fsck`
- [x] Report stale remote branches
- [x] Optionally update submodules
- [x] Send maintenance results to Notifications

### Backup and restore

- [x] Improve the existing backup workflow into a dedicated Backups UI
- [x] Automatically offer a backup before risky operations
- [x] Create Git bundle / patch snapshots where appropriate
- [x] Show repository, timestamp, size and reason for each backup
- [x] Add Restore and Delete actions
- [x] Add retention settings

### Authentication and connectivity diagnostics

- [x] Add a diagnostics / health section
- [x] Check Git and GitHub CLI versions
- [x] Check GitHub authentication
- [x] Check SSH / HTTPS connectivity
- [x] Check configured GitHub Enterprise host
- [x] Check shared-manifest access
- [x] Check available disk space
- [x] Provide Test connection actions and actionable error messages

## Priority 4 — GitHub integration

### GitHub Actions status

- [x] Show latest workflow state for each repository
- [x] Display passing / failed / running status in repository details
- [x] Add failed workflow runs to Notifications
- [x] Add quick link to the workflow run on GitHub
- [x] Keep API polling conservative and cache results

### Pull request and issue indicators

- [x] Optionally show open PR count
- [x] Optionally show open issue count
- [x] Add direct links to GitHub PR and issue pages
- [x] Make the feature optional to avoid unnecessary API traffic

## Priority 5 — Storage and configuration

### Disk usage and cleanup

- [x] Show working-tree size, `.git` size and total size per repository
- [x] Sort repositories by disk usage
- [x] Highlight unusually large repositories
- [x] Add safe `git gc` action
- [x] Show total space used by the repository root
- [x] Warn when free disk space is low

### Configuration backup and migration

- [x] Export all `ghsync` configuration in one package
- [x] Include local settings, scheduling, machine ID and sync configuration
- [x] Include third-party repository registry
- [x] Restore configuration on a new PC
- [x] Allow preview before applying a restored configuration
- [x] Never export credentials or secrets

## Priority 6 — UX improvements

### Activity timeline

- [x] Add a human-readable event timeline above or alongside raw logs
- [x] Show repository, action, result and timestamp
- [x] Filter by repository, action and severity
- [x] Keep raw logs available for troubleshooting

### Automatic recovery actions

- [x] Offer Pull when behind remote
- [x] Offer Set upstream when missing upstream
- [x] Offer Commit / Stash for dirty repositories
- [x] Offer Clone for missing assigned repositories
- [x] Show authentication repair guidance for auth failures
- [x] Only automate operations that are safe and reversible

### Repository labels and notes

- [x] Add user-defined labels / tags
- [x] Add optional repository notes
- [x] Filter and search by labels
- [x] Allow labels to drive groups and policies
- [x] Optionally share labels through the fleet manifest

## Design principles

- Never delete a local repository automatically because it disappeared from a shared list.
- Never force-push or force-reset by default.
- Preserve local-only work and make risk visible before sync operations.
- Prefer reversible actions and backups before destructive operations.
- Keep credentials, secrets and machine-local paths out of shared configuration.
- Reuse the existing repository model and feature architecture rather than creating parallel state.
- Route meaningful successes, warnings and failures through the Notifications tab.
- Keep GitHub API usage efficient and compatible with GitHub Enterprise where practical.

## Suggested implementation order — completed

1. [x] Fleet / Machines view
2. [x] Attention dashboard
3. [x] Full-sync preview / dry run
4. [x] First-class repository groups
5. [x] Bulk actions
6. [x] Repository health indicators
7. [x] Scheduled maintenance
8. [x] Authentication / connectivity diagnostics
