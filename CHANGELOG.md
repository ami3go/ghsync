# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-06

### Added
- `ghsync` command: `clone`, `pull`, `sync`, `status`, `check`, `config`, `cron`.
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
- `--porcelain` output mode (`TAG<TAB>NAME<TAB>DETAIL`) consumed by the Cockpit
  front-end.
- Per-user and system-wide installers, a Makefile, and CI running shellcheck
  plus an install smoke test.
