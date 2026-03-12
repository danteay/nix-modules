{ pkgs, ... }:
{
  home.file.".envs/global-envs.sh" = {
    text = ''
      export HOME_MANAGER_HOME="$HOME/.config/nix-modules/home-manager"
      export PATH="$HOME/.local/bin:$PATH"

      export GOPATH=$HOME/go
      export GOBIN=$GOPATH/bin
      export GO111MODULE=on
      export GOSUMDB=off
      export CGO_ENABLED=0

      export PATH=$PATH:$GOBIN
    '';
  };
}