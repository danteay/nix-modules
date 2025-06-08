# To import this module, doit in the next way:
#
# home.packages = [
#   (import ../modules/langs/pkl.nix { inherit pkgs; })
# ];
#
# Adjust the path to this file according of the module that is loading it

{ pkgs, ... }:
let
  version = "0.28.2";

  system = builtins.currentSystem;

  archs = {
    "aarch64-darwin" = "macos-aarch64";
    "x86_64-darwin" = "macos-amd64";
    "aarch64-linux" = "linux-aarch64";
    "x86_64-linux" = "linux-amd64";
  };

  shas = {
    "aarch64-darwin" = "sha256-RSx1dp2FwHcUNW8iOp2ZoCvcC/NgwHQXZZWOmqCApQw=";
    "x86_64-darwin" = "sha256-/oa9qgycQjfiEXkmd0n6wk/ovTS4QJ3WhlH4Rbid2Ks=";
    "aarch64-linux" = "sha256-7QTQF1/Tzq3ctcNa9lfeapbNgBjPyp99FOc4yYtHgr8=";
    "x86_64-linux" = "sha256-uociumlx98sri5D9ynbJR6lRClcRm68FJjv0/Pn5sLo=";
  };

  arch = archs."${system}";
  sha = shas."${system}";

  url = "https://github.com/apple/pkl/releases/download/${version}/pkl-${arch}";
in
pkgs.stdenv.mkDerivation {
  name = "pkl";
  version = "${version}";

  src = pkgs.fetchurl {
    url = "${url}";
    sha256 = "${sha}";
  };

  phases = [ "installPhase" ];

  installPhase = ''
    mkdir -p $out/bin
    cp $src $out/bin/pkl
    chmod +x $out/bin/pkl
  '';

  meta = {
    description = "A configuration as code language with rich validation and tooling.";
    mainProgram = "pkl";
  };
}
