# GitHub Sync Roadmap

This file tracks planned improvements for `ghsync`. Items are grouped by priority rather than strict release order.

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

- [ ] Add a Machines tab based on the shared repository manifest
- [ ] Show machine name / ID, last sync, assigned repository count and status
- [ ] Show missing or out-of-sync repositories per machine
- [ ] Record last-seen / last-successful-sync metadata for each machine
- [ ] Allow filtering repository assignments by machine
- [ ] Surface stale/offline machines clearly

### Attention dashboard

- [ ] Add a dedicated view for repositories that require action
- [ ] Detect dirty working trees
- [ ] Detect ahead / behind / diverged branches
- [ ] Detect detached HEAD and missing upstreams
- [ ] Include failed fetch / pull / push results
- [ ] Provide recommended one-click actions where safe
- [ ] Link each problem to repository details and relevant notifications

### Full-sync preview / dry run

- [ ] Preview what Full sync will do before changing repositories
- [ ] Show repositories that will be cloned
- [ ] Show repositories that will be pulled
- [ ] Show repositories that will be skipped because of conflicts or local-only work
- [ ] Show machine-list reconciliation changes
- [ ] Add Proceed / Cancel controls
- [ ] Reuse the preview data for scheduled-sync diagnostics where possible

## Priority 2 — Repository management

### First-class repository groups

- [ ] Add group management UI
- [ ] Filter the repository table by group
- [ ] Support Pull group
- [ ] Support Push group
- [ ] Support Sync group
- [ ] Allow groups to be stored in the shared manifest

### Bulk actions

- [ ] Add repository selection checkboxes
- [ ] Add Pull selected
- [ ] Add Push selected
- [ ] Add Check updates selected
- [ ] Add Commit selected where safe
- [ ] Add group / tag assignment for selected repositories
- [ ] Keep destructive bulk actions explicitly confirmed

### Per-repository sync policy

- [ ] Support policies such as manual, pull-only, pull+push and fetch-only
- [ ] Allow policy inheritance from groups
- [ ] Allow policy overrides per machine
- [ ] Store shareable policy in the shared manifest
- [ ] Keep credentials and local paths machine-local

### Branch overview

- [ ] Show local and remote branches
- [ ] Show upstream and ahead / behind counts
- [ ] Show last commit time per branch
- [ ] Mark merged and stale branches
- [ ] Add safe cleanup for merged branches
- [ ] Never force-delete branches without explicit confirmation

## Priority 3 — Reliability and maintenance

### Repository health indicators

- [ ] Add Healthy / Attention / Problem state per repository
- [ ] Include dirty state, ahead / behind, failed fetch and missing upstream
- [ ] Include last successful sync
- [ ] Include disk usage and repository integrity signals
- [ ] Add aggregate health metrics to the Overview card

### Scheduled maintenance

- [ ] Add a separate maintenance schedule
- [ ] Run `git fetch --prune`
- [ ] Run safe `git gc`
- [ ] Run `git fsck`
- [ ] Report stale remote branches
- [ ] Optionally update submodules
- [ ] Send maintenance results to Notifications

### Backup and restore

- [ ] Improve the existing backup workflow into a dedicated Backups UI
- [ ] Automatically offer a backup before risky operations
- [ ] Create Git bundle / patch snapshots where appropriate
- [ ] Show repository, timestamp, size and reason for each backup
- [ ] Add Restore and Delete actions
- [ ] Add retention settings

### Authentication and connectivity diagnostics

- [ ] Add a diagnostics / health section
- [ ] Check Git and GitHub CLI versions
- [ ] Check GitHub authentication
- [ ] Check SSH / HTTPS connectivity
- [ ] Check configured GitHub Enterprise host
- [ ] Check shared-manifest access
- [ ] Check available disk space
- [ ] Provide Test connection actions and actionable error messages

## Priority 4 — GitHub integration

### GitHub Actions status

- [ ] Show latest workflow state for each repository
- [ ] Display passing / failed / running status in repository details
- [ ] Add failed workflow runs to Notifications
- [ ] Add quick link to the workflow run on GitHub
- [ ] Keep API polling conservative and cache results

### Pull request and issue indicators

- [ ] Optionally show open PR count
- [ ] Optionally show open issue count
- [ ] Add direct links to GitHub PR and issue pages
- [ ] Make the feature optional to avoid unnecessary API traffic

## Priority 5 — Storage and configuration

### Disk usage and cleanup

- [ ] Show working-tree size, `.git` size and total size per repository
- [ ] Sort repositories by disk usage
- [ ] Highlight unusually large repositories
- [ ] Add safe `git gc` action
- [ ] Show total space used by the repository root
- [ ] Warn when free disk space is low

### Configuration backup and migration

- [ ] Export all `ghsync` configuration in one package
- [ ] Include local settings, scheduling, machine ID and sync configuration
- [ ] Include third-party repository registry
- [ ] Restore configuration on a new PC
- [ ] Allow preview before applying a restored configuration
- [ ] Never export credentials or secrets

## Priority 6 — UX improvements

### Activity timeline

- [ ] Add a human-readable event timeline above or alongside raw logs
- [ ] Show repository, action, result and timestamp
- [ ] Filter by repository, action and severity
- [ ] Keep raw logs available for troubleshooting

### Automatic recovery actions

- [ ] Offer Pull when behind remote
- [ ] Offer Set upstream when missing upstream
- [ ] Offer Commit / Stash for dirty repositories
- [ ] Offer Clone for missing assigned repositories
- [ ] Show authentication repair guidance for auth failures
- [ ] Only automate operations that are safe and reversible

### Repository labels and notes

- [ ] Add user-defined labels / tags
- [ ] Add optional repository notes
- [ ] Filter and search by labels
- [ ] Allow labels to drive groups and policies
- [ ] Optionally share labels through the fleet manifest

## Design principles

- Never delete a local repository automatically because it disappeared from a shared list.
- Never force-push or force-reset by default.
- Preserve local-only work and make risk visible before sync operations.
- Prefer reversible actions and backups before destructive operations.
- Keep credentials, secrets and machine-local paths out of shared configuration.
- Reuse the existing repository model and feature architecture rather than creating parallel state.
- Route meaningful successes, warnings and failures through the Notifications tab.
- Keep GitHub API usage efficient and compatible with GitHub Enterprise where practical.

## Suggested next implementation order

1. Fleet / Machines view
2. Attention dashboard
3. Full-sync preview / dry run
4. First-class repository groups
5. Bulk actions
6. Repository health indicators
7. Scheduled maintenance
8. Authentication / connectivity diagnostics
