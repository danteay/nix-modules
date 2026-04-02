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
      if [ -z "$GOROOT" ]; then
        export GOROOT=${pkgs.go}/share/go
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
