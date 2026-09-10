# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-06

### Added
- `ghsync` command: `clone`, `pull`, `sync`, `status`, `stats`, `check`,
  `config`, `cron`.
- Terminal TUI with arrow-key navigation and no external dependency on
  `dialog` or `whiptail`.
- Parallel git operations with a `flock` guard against overlapping runs.
- Fast-forward-only updates that skip dirty, detached, diverged and
  upstream-less repositories instead of touching them.
- Cron management: install, remove and inspect the scheduled `sync --quiet` job.
- Cockpit page following the PatternFly design language: overview card with a
  description list, tabbed layout (Repositories, Activity, Settings, Schedule),
  compact table with status labels, inline alerts, switches, empty state and
  spinner, in light and dark themes.
- Warnings for work that exists only on the local machine: unpushed commits,
  branches without a remote, and stashes, surfaced after every pull and in the
  overview card.
- `ghsync orphans`: local clones the GitHub API no longer returns.
- `ghsync retry`: re-runs only the operations that failed in the previous run.
- Partial clones (`CLONE_FILTER`, default `blob:none`) and bare-mirror mode.
- `EXCLUDE` glob patterns, and `HOST` for GitHub Enterprise.
- systemd user timer as an alternative to cron, with `Persistent=true`.
- Failure notifications to the journal via `systemd-cat`, tagged `ghsync`.
- Repository size on disk in the statistics tab.
- Statistics tab and `ghsync stats`: commits, local branches, tags, last commit
  age and author per repository, with totals, sortable columns and a relative
  commit-volume bar.
- `--porcelain` output mode (`TAG<TAB>NAME<TAB>DETAIL`) consumed by the Cockpit
  front-end.
- Per-user and system-wide installers, a Makefile, and CI running shellcheck
  plus an install smoke test.
