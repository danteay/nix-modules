{ lib, pkgs, ... }:
let
  go = import ./custom/go.nix { inherit pkgs lib; };
in
{
  home.packages = [
    go
    pkgs.gotools
    pkgs.mage
    pkgs.revive
    pkgs.golangci-lint
    pkgs.graphviz
  ];

  home.file.".envs/go.sh" = {
    text = ''
      if [ -z "$GOROOT" ]; then
        export GOROOT=${go}/share/go
      fi

      export GOPATH=$HOME/go
      export GOBIN=$GOPATH/bin
      export GO111MODULE=on
      export GOSUMDB=off
      export CGO_ENABLED=0

      export PATH=$PATH:$GOBIN
    '';
  };
}
