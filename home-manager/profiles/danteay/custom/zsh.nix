{ pkgs, ... }:
{
  zshConfig = {
    shellAliases = {
      myip = "ifconfig en0 | grep inet | grep -v inet6 | awk '{print $2}'";
      nds = "sudo nix --extra-experimental-features \"nix-command flakes\" run nix-darwin#darwin-rebuild -- switch --flake $HOME/.config/nix-modules/nix-darwin#danteay";
    };

    initExtra = ''
      ## Add p10k
      source ${pkgs.zsh-powerlevel10k}/share/zsh-powerlevel10k/powerlevel10k.zsh-theme
      POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD=true

      # load p10k configuration if exists
      [[ -f ~/.p10k.zsh ]] && source ~/.p10k.zsh
    '';
  };
}
