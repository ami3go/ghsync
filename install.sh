#!/usr/bin/env bash
# Install ghsync and its Cockpit page.
#
#   ./install.sh              install for the current user (no root needed)
#   sudo ./install.sh --system   install for every user on the host
#   ./install.sh --uninstall [--system]
#
# Honours PREFIX (system mode, default /usr/local) and DESTDIR for packagers.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEM=false
UNINSTALL=false
METAINFO_NAME="io.github.ami3go.ghsync.metainfo.xml"

for arg in "$@"; do
    case "$arg" in
        --system)    SYSTEM=true ;;
        --uninstall) UNINSTALL=true ;;
        -h|--help)   sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $arg" >&2; exit 1 ;;
    esac
done

DESTDIR="${DESTDIR:-}"
if [[ "$SYSTEM" == true ]]; then
    PREFIX="${PREFIX:-/usr/local}"
    BIN="$DESTDIR$PREFIX/bin/ghsync"
    THIRD_BIN="$DESTDIR$PREFIX/bin/ghsync-thirdparty"
    PKG_DIR="$DESTDIR/usr/share/cockpit/ghsync"
    METAINFO="$DESTDIR/usr/share/metainfo/$METAINFO_NAME"
    if [[ $EUID -ne 0 && -z "$DESTDIR" ]]; then
        echo "--system needs root. Re-run with sudo." >&2
        exit 1
    fi
else
    DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
    BIN="$HOME/.local/bin/ghsync"
    THIRD_BIN="$HOME/.local/bin/ghsync-thirdparty"
    PKG_DIR="$DATA_HOME/cockpit/ghsync"
    METAINFO="$DATA_HOME/metainfo/$METAINFO_NAME"
fi

if [[ "$UNINSTALL" == true ]]; then
    rm -rf "$PKG_DIR"
    rm -f "$BIN" "$THIRD_BIN" "$METAINFO"
    echo "Removed $PKG_DIR"
    echo "Removed $BIN"
    echo "Removed $THIRD_BIN"
    echo "Removed $METAINFO"
    echo
    echo "Your repositories, config and log were left alone."
    echo "To drop the scheduled job as well, run 'ghsync cron remove' before uninstalling."
    exit 0
fi

[[ -f "$SRC/bin/ghsync" ]] || { echo "bin/ghsync missing — run this from the repository root." >&2; exit 1; }
[[ -f "$SRC/bin/ghsync-thirdparty" ]] || { echo "bin/ghsync-thirdparty missing — run this from the repository root." >&2; exit 1; }
[[ -f "$SRC/packaging/$METAINFO_NAME" ]] || { echo "packaging/$METAINFO_NAME missing — run this from the repository root." >&2; exit 1; }

install -Dm755 "$SRC/bin/ghsync" "$BIN"
install -Dm755 "$SRC/bin/ghsync-thirdparty" "$THIRD_BIN"
install -Dm755 "$SRC/bin/ghsync" "$PKG_DIR/ghsync"
install -Dm755 "$SRC/bin/ghsync-thirdparty" "$PKG_DIR/ghsync-thirdparty"
for f in manifest.json index.html ghsync.css ghsync.js thirdparty.js repo-features.json; do
    install -Dm644 "$SRC/cockpit/$f" "$PKG_DIR/$f"
done
for src_file in "$SRC"/cockpit/repo-feature-*.js "$SRC"/cockpit/repo-feature-*.css; do
    [[ -f "$src_file" ]] || continue
    install -Dm644 "$src_file" "$PKG_DIR/$(basename "$src_file")"
done
install -Dm644 "$SRC/packaging/$METAINFO_NAME" "$METAINFO"

echo "Installed:"
echo "  command      $BIN"
echo "  helper       $THIRD_BIN"
echo "  cockpit page $PKG_DIR"
echo "  app metadata $METAINFO"
echo

if [[ "$SYSTEM" != true ]] && ! printf '%s' ":$PATH:" | grep -q ":$HOME/.local/bin:"; then
    echo "Note: $HOME/.local/bin is not on your PATH. Add it to ~/.profile:"
    # shellcheck disable=SC2016  # printing the literal line for the user to copy
    echo '  export PATH="$HOME/.local/bin:$PATH"'
    echo
fi
if ! command -v gh >/dev/null; then
    echo "Next: install the GitHub CLI (https://cli.github.com), then run 'gh auth login'."
elif ! gh auth status >/dev/null 2>&1; then
    echo "Next: run 'gh auth login' as the user who will sync repositories."
else
    echo "Next: run 'ghsync' for the TUI, or open Cockpit → Tools → GitHub Sync."
fi
