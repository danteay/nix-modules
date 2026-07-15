{ ... }:
{
  # RTK (Rust Token Killer) wiring — see dotfiles/ai/rtk/.
  home.file = {
    # RTK.md is deployed into ~/.claude so Claude Code's `@RTK.md` import
    # (in dotfiles/ai/claude-code/CLAUDE.md) resolves; keep the ~/.claude
    # destination even though the source lives under ai/rtk.
    ".claude/RTK.md".source = ../../dotfiles/ai/rtk/RTK.md;

    # RTK user-global filters (nix / home-manager / devenv / uv, ...).
    "Library/Application Support/rtk/filters.toml".source =
      ../../dotfiles/ai/rtk/filters.toml;
  };
}
