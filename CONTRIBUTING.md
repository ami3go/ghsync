# Contributing

## Before opening a pull request

```bash
make lint
make test
```

`lint` runs shellcheck, `bash -n`, `node --check` and JSON validation. `test`
renders the Cockpit page in jsdom against a stubbed `cockpit` API and asserts
what it draws, so front-end changes can be checked without a Cockpit install.
Both run in CI.

## Ground rules

- `bin/ghsync` is plain bash and must stay dependency-free beyond `git`, `gh`
  and coreutils. It has to keep working under cron, where there is no terminal
  and a minimal `PATH`.
- Never make a destructive git operation the default. Updates are
  fast-forward-only; anything that could discard a user's work belongs behind an
  explicit, separate flag.
- `cockpit/` has no build step. Files ship exactly as written, so no bundlers,
  transpilers or frameworks.
- Anything the Cockpit page needs from the backend goes through `--porcelain`
  output, not by parsing human-readable text.

## Testing a change by hand

```bash
git init --bare /tmp/remote.git
git clone /tmp/remote.git /tmp/work    # commit and push something
GHSYNC_ROOT=/tmp/fixture ./bin/ghsync pull
```

`GHSYNC_ROOT`, `GHSYNC_OWNERS`, `GHSYNC_PROTOCOL`, `GHSYNC_JOBS` and
`GHSYNC_QUIET` override the config file, which makes throwaway test runs easy.
