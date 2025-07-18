{ lib, pkgs, ... }:
{
  home.packages = with pkgs; [
    go
    gotools
    mage
    revive
    golangci-lint
    graphviz
  ];

  home.file.".envs/go.sh" = {
    text = ''
      export GOPATH=$HOME/go
      export GOROOT=${pkgs.go}/share/go
      export GOBIN=$GOPATH/bin
      export GO111MODULE=on
      export GOSUMDB=off
      export CGO_ENABLED=0

      export PATH=$PATH:$GOBIN
    '';
  };
}
