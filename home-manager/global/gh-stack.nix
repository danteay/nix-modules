{ pkgs, lib, ... }:
{
  # `gh stack` is GitHub's official `gh` CLI extension for managing stacked
  # pull requests (https://github.com/github/gh-stack). Extensions are
  # installed imperatively by the `gh` binary itself into
  # ~/.local/share/gh/extensions, so home-manager can't declare the package —
  # this activation hook makes sure it's present (and kept current) on every
  # switch instead. Requires `gh` on PATH (installed via Homebrew, see
  # nix-darwin/configuration.nix), so it's a no-op until nix-darwin has run.
  home.activation.ghStackExtension = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    if command -v gh >/dev/null 2>&1; then
      if gh extension list 2>/dev/null | grep -q "github/gh-stack"; then
        run gh extension upgrade github/gh-stack >/dev/null 2>&1 || true
      else
        run gh extension install github/gh-stack >/dev/null 2>&1 || true
      fi
    fi
  '';

  home.packages = with pkgs; [
    # Short alias for `gh stack`, e.g. `gs submit`, `gs sync --prune`.
    # Implemented as a nix-managed script instead of `gh stack alias` so it
    # stays declarative rather than writing a mutable file to ~/.local/bin.
    (writeShellScriptBin "gs" ''
      exec gh stack "$@"
    '')
  ];
}
