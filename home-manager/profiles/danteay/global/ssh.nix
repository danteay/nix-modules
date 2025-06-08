{ ... }:
{
  home.file = {
    ".ssh/config".source = ../../../../dotfiles/danteay/ssh/config;
    ".ssh/github".source = ../../../../dotfiles/danteay/ssh/github;
    ".ssh/github.pub".source = ../../../../dotfiles/danteay/ssh/github.pub;
  };
}