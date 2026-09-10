# ghsync

Clone and keep every GitHub repository you own up to date — from a terminal TUI,
from cron, or from a page inside [Cockpit](https://cockpit-project.org). All
three drive the same script and share one config file, one log and one cron
entry.

```
$ ghsync pull
  updated     acme/api-server      main, +12 commits
  up-to-date  acme/website         main
  dirty       acme/notes           fetched, local changes left untouched
  diverged    acme/infra           main needs a manual merge or rebase

  Summary (4 repos)
      1  updated
      1  up-to-date
      1  dirty
      1  diverged
```

## Features

- Clones every repo returned by `gh repo list`, for your account or any org
- Fast-forward-only updates: a dirty, detached, diverged or upstream-less repo is
  reported and left untouched — nothing is stashed, reset or overwritten
- Parallel git operations with a `flock` so runs never overlap
- Terminal TUI with arrow-key navigation, no `dialog`/`whiptail` dependency
- Cockpit page in PatternFly style: overview, repository table, live activity
  log, settings and scheduler, with light and dark theme support
- One command to install or remove the cron job

## Requirements

- Linux, bash 4+, git, cron
- [GitHub CLI](https://cli.github.com), authenticated: `gh auth login`
- Cockpit 215+ — only if you want the web UI

## Install

```bash
git clone https://github.com/<you>/ghsync.git
cd ghsync
./install.sh                # current user, no root
sudo ./install.sh --system  # all users
```

| Mode | Command | Cockpit page |
|---|---|---|
| user | `~/.local/bin/ghsync` | `~/.local/share/cockpit/ghsync/` |
| system | `/usr/local/bin/ghsync` | `/usr/share/cockpit/ghsync/` |

Reload Cockpit afterwards; **GitHub Sync** appears under *Tools*.

`make install`, `make install-system` and `make uninstall` do the same thing, and
respect `PREFIX` and `DESTDIR` for packaging.

Uninstall with `./install.sh --uninstall [--system]`. Your clones, config and log
are left alone; run `ghsync cron remove` first if you also want the schedule gone.

## Usage

```bash
ghsync                       # TUI: arrows or j/k, Enter to select, q to go back
ghsync clone                 # clone every repo missing from the root directory
ghsync pull                  # fetch + fast-forward every local clone
ghsync sync                  # clone missing, then pull everything
ghsync status                # branch / uncommitted / ahead / behind per repo
ghsync pull owner/repo       # act on a single repository
ghsync cron install "0 */6 * * *"
ghsync cron remove
ghsync cron status
ghsync check                 # machine-readable environment probe
```

Flags: `--root DIR`, `--owner NAME` (repeatable, for organisations), `--jobs N`,
`--ssh` / `--https`, `--forks`, `--archived`, `--limit N`, `--quiet`,
`--porcelain`.

## Configuration

Settings live in `~/.config/ghsync/config` and are shared by the TUI, the CLI and
the Cockpit page. Edit the file, use the TUI's Settings screen, or use the form in
Cockpit.

```bash
ROOT="$HOME/github"      # clones land in $ROOT/<owner>/<repo>
OWNERS=""                # blank = your own repos; else "myorg otherorg"
PROTOCOL="ssh"           # ssh | https
INCLUDE_FORKS=false
INCLUDE_ARCHIVED=false
JOBS=4                   # parallel git operations
LIMIT=1000               # max repos fetched per owner
GIT_TIMEOUT=600          # seconds per git operation
```

| Path | Contents |
|---|---|
| `~/.config/ghsync/config` | settings |
| `~/.local/state/ghsync/ghsync.log` | log, rotated at 5 MB |
| `~/.local/state/ghsync/ghsync.lock` | run lock |

## Scheduled updates

```bash
ghsync cron install "0 */6 * * *"
```

The entry runs `ghsync sync --quiet` as your user. Cron has no terminal, so the
script sets `GIT_TERMINAL_PROMPT=0` and SSH batch mode to guarantee a run can
never hang waiting for input. Two consequences:

- A passphrase-protected SSH key fails silently under cron. Use a key without a
  passphrase, or switch to HTTPS (`PROTOCOL="https"`) and run `gh auth setup-git`
  so git authenticates with your gh token.
- `gh` must read its token non-interactively. That is the default
  (`~/.config/gh/hosts.yml`); a locked keyring will break unattended runs.

## Cockpit page

Four tabs — Repositories, Activity, Settings, Schedule — under an overview card
that shows gh status, the signed-in account, clone counts and the current
schedule. Actions stream their output into the Activity tab line by line.

The page never runs as root. It calls `ghsync` through `cockpit.spawn` with
`superuser: null`, so it uses the logged-in user's gh token and SSH keys, and it
parses the script's `--porcelain` output (`TAG⇥NAME⇥DETAIL`).

### Styling

Cockpit's interface is PatternFly. Third-party pages have to bring their own
copy, and the major PatternFly version Cockpit ships changes between releases,
so `cockpit/ghsync.css` implements the PatternFly design tokens and component
styles directly — colour, type scale, spacing, cards, tabs, tables, labels,
alerts, switches and empty states. There is no build step, no bundled framework
and nothing to break when Cockpit moves to a new PatternFly major. The sheet
reads Cockpit's theme class (`pf-v6-theme-dark`, `pf-v5-theme-dark`,
`pf-theme-dark`) so the page follows the shell's light or dark setting.

A sync started in the browser is killed when the tab closes — that is how
`cockpit.spawn` works. Use the cron job for unattended updates.

## Layout

```
bin/ghsync           the entire engine: listing, cloning, pulling, cron, TUI
cockpit/             Cockpit package (manifest, page, styles, front-end logic)
install.sh           user or system installer
test/ui-test.js      jsdom test for the Cockpit page, no server required
Makefile             install / install-system / uninstall / lint / test targets
.github/workflows/   lint, DOM test and an install smoke test on push
```

## Development

```bash
make lint     # shellcheck + node --check + JSON validation
make test     # renders the Cockpit page in jsdom against a stubbed backend
```

The same checks run in CI. `bin/ghsync` is plain bash with no runtime
dependencies beyond git and gh; `cockpit/` has no build step and no bundled
framework, so the files ship exactly as they are written.

## License

MIT — see [LICENSE](LICENSE).
