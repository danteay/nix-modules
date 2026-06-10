{ pkgs, config ? {}, ... }:
let
  # Shared shell init that should run on every profile, BEFORE the
  # profile-specific init content. The trailing `clear` is appended after
  # the profile content so the terminal always ends up clean.
  templateInit = ''
    # Nix
    if [ -e '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh' ]; then
      . '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh'
    fi
    # End Nix

    folder_path="$HOME/.envs"

    # Check if the folder exists
    if [ -d "$folder_path" ]; then
        # Source all .sh files in the folder
        for file in "$folder_path"/*.sh; do
            if [ -f "$file" ]; then
                source "$file"
            fi
        done
    fi

    if [ -e '/opt/homebrew/bin/brew' ]; then
      export PATH="$PATH:/opt/homebrew/bin"
    fi

    fpath=(/Users/danteay/.zsh/completions $fpath)
    autoload -U compinit && compinit
  '';

  profileInit = config.zshConfig.initExtra or "";

  # Order: shared base -> profile injection -> clear.
  # Concatenation (not override) keeps the template's plumbing intact while
  # letting each profile add theme setup and other per-tenant lines.
  finalInitContent = templateInit + profileInit + ''

    clear
  '';

  defaultConfig = {
    enable = true;
    autocd = true;

    enableCompletion = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;

    oh-my-zsh = {
      enable = true;

      plugins = [
        "git"
        "docker"
      ];

      theme = "robbyrussell";
    };
  };

  # Every zshConfig key other than `initExtra` follows recursiveUpdate
  # override semantics. `initExtra` is consumed by this template as the
  # profile injection point and must NOT leak into `programs.zsh` — home-
  # manager treats `programs.zsh.initExtra` as a deprecated alias that
  # auto-appends to `initContent`, which would duplicate the profile
  # content after `clear`. Strip it from the user config before merging
  # and set the final `initContent` explicitly.
  userConfig = builtins.removeAttrs (config.zshConfig or {}) [ "initExtra" ];
  mergedConfig = pkgs.lib.recursiveUpdate defaultConfig userConfig;

  finalConfig = mergedConfig // { initContent = finalInitContent; };
in
{
  programs.zsh = finalConfig;
}
