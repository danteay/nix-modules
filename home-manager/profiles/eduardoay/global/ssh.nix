{ ... }:
{
  home.file = {
    ".ssh/config".source = ../../../../dotfiles/eduardoay/ssh/config;
    ".ssh/github".source = ../../../../dotfiles/eduardoay/ssh/github;
    ".ssh/github.pub".source = ../../../../dotfiles/eduardoay/ssh/github.pub;
  };
}