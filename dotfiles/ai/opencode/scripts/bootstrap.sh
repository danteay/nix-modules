#!/usr/bin/env bash
# Materialize Bun entry points so imports resolve against config/node_modules.
# Usage: bash scripts/bootstrap.sh SOURCE_CONFIG [DEST_CONFIG] [--skip-install]
# Home Manager skips installation; OpenCode installs dependencies at startup.
set -euo pipefail

SRC="${1:?Pass the source opencode config directory}"
DST="${2:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
MODE="${3:-}"

[[ -f "$SRC/package.json" && -d "$SRC/tools" && -d "$SRC/plugins" ]] || {
  echo "Invalid source config: $SRC" >&2
  exit 1
}
[[ -z "$MODE" || "$MODE" == --skip-install ]] || {
  echo "Unknown option: $MODE" >&2
  exit 1
}
mkdir -p "$DST"
[[ "$(cd "$SRC" && pwd -P)" != "$(cd "$DST" && pwd -P)" ]] || {
  echo "Source and destination must differ" >&2
  exit 1
}

# Unlink only managed paths; never write through a link into the Nix store.
# Preserve unrelated local tools/plugins and the existing node_modules.
for dir in plugins tools lib scripts tests bin; do
  if [[ -L "$DST/$dir" ]]; then unlink "$DST/$dir"; fi
  mkdir -p "$DST/$dir"
  for file in "$SRC/$dir/"*; do
    [[ -f "$file" ]] || continue
    target="$DST/$dir/$(basename "$file")"
    if [[ -L "$target" ]]; then unlink "$target"; fi
    if [[ -f "$target" ]]; then chmod u+w "$target"; fi
    cp -L "$file" "$target"
    chmod u+w "$target"
  done
done

if [[ -L "$DST/package.json" ]]; then unlink "$DST/package.json"; fi
if [[ -f "$DST/package.json" ]]; then chmod u+w "$DST/package.json"; fi
cp -L "$SRC/package.json" "$DST/package.json"
chmod u+w "$DST/package.json"

if [[ "$MODE" != --skip-install ]]; then
  (cd "$DST" && bun install)
fi
