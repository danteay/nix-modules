# To import this module, doit in the next way:
#
# home.packages = [
#   (import ../modules/langs/pkl.nix { inherith pkgs; })
# ];
#
# Adjust the path to this file according of the module that is loading it

{ pkgs, ... }:
let
  version = "0.27.0";

  system = builtins.currentSystem;

  archs = {
    "aarch64-darwin" = "macos-aarch64";
    "x86_64-darwin" = "macos-amd64";
    "aarch64-linux" = "linux-aarch64";
    "x86_64-linux" = "linux-amd64";
  };

  shas = {
    "aarch64-darwin" = "sha256-M/mUHGgw5v8K0Ny+lUugKGOKXCt8L518BLBMfbyWFDI=";
    "x86_64-darwin" = "sha256-1kkE1E9eDbnRxM9pwyvkUIPaoP3sAgVqN7ZdQCCzAXs=";
    "aarch64-linux" = "sha256-44wRAs4bX8RT3E+8NbQbNZB/5ayEwbfL+xQtQC+3fAc=";
    "x86_64-linux" = "sha256-5MdrbdAkVtrI0wDqHxxQEC9kFMuUdWdDZHfL98Las6o=";
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
