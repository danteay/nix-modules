# RTK - Rust Token Killer

**Usage**: Token-optimized CLI proxy (60-90% savings on dev operations)

## Meta Commands (always use rtk directly)

```bash
rtk gain              # Show token savings analytics
rtk gain --history    # Show command usage history with savings
rtk discover          # Analyze Claude Code history for missed opportunities
rtk proxy <cmd>       # Execute raw command without filtering (for debugging)
```

## Installation Verification

```bash
rtk --version         # Should show: rtk X.Y.Z
rtk gain              # Should work (not "command not found")
which rtk             # Verify correct binary
```

⚠️ **Name collision**: If `rtk gain` fails, you may have reachingforthejack/rtk (Rust Type Kit) installed instead.

## Hook-Based Usage

Most commands are automatically rewritten by the Claude Code hook.
Example: `git status` → `rtk git status` (transparent, 0 tokens overhead).
This covers git, gh, cat/read, grep, find, ls, curl, aws, go, docker, wc, du, etc.

## Manually prefix Nix-ecosystem commands with `rtk`

The hook's auto-rewrite map is compiled-in and does **not** include these
verbose commands. They emit heavy store-path/build/progress noise (mostly on
stderr), so prefix them with `rtk` yourself to route them through the custom
filters in `~/Library/Application Support/rtk/filters.toml`:

```bash
rtk nix build .#foo          # nix build / develop / flake / eval / run
rtk nix flake update
rtk home-manager switch ...  # (the `hms` alias is NOT rewritten either)
rtk devenv shell ...
rtk uv run <cmd>             # strips uv's resolver preamble, keeps program output
```

To validate `filters.toml` edits (inline `[[tests.*]]`): `rtk verify` only
covers bundled + trusted project-local filters, not the user-global file. Copy
it to a scratch `./.rtk/filters.toml`, run `rtk trust`, then `rtk verify`.

Refer to CLAUDE.md for full command reference.
