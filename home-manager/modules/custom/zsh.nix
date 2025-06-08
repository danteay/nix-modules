{ pkgs, config ? {}, ... }:
let
  p10kConfig = if config.enableP10K then ''
    source ${pkgs.zsh-powerlevel10k}/share/zsh-powerlevel10k/powerlevel10k.zsh-theme
    POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD=true

    # load p10k configuration if exists
    [[ -f ~/.p10k.zsh ]] && source ~/.p10k.zsh
  '' else "";

  initExtra = ''
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

    if command -v nix-your-shell > /dev/null; then
      nix-your-shell zsh | source /dev/stdin
    fi

    if command -v zellij > /dev/null; then
      zellij setup --generate-auto-start zsh
    fi

    if [ -e '/opt/homebrew/bin/brew' ]; then
      export PATH="$PATH:/opt/homebrew/bin"
    fi

    ${p10kConfig}

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

      theme = if config.theme == ""
              then "robbyrussell"
              else config.theme;
    };
  };

  finalInitExtra = initExtra + (config.zshConfig.initExtra or "");

  mergedConfig = pkgs.lib.recursiveUpdate defaultConfig (config.zshConfig or {});

  finalConfig = mergedConfig // { initExtra = finalInitExtra; };
in
{
  programs.zsh = finalConfig;
}
