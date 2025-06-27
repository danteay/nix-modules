# To import this module, doit in the next way:
#
# home.packages = [
#   (import ../modules/langs/go-migrate.nix { inherit pkgs; })
# ];
#
# Adjust the path to this file according of the module that is loading it

{ pkgs, ... }:
let
  version = "4.18.3";

  system = builtins.currentSystem;

  archs = {
    "aarch64-darwin" = "darwin-arm64";
    "x86_64-darwin" = "darwin-amd64";
    "aarch64-linux" = "linux-arm64";
    "x86_64-linux" = "linux-amd64";
  };

  shas = {
    "aarch64-darwin" = "sha256-xuPLPc1zVOBbGACxxTKve8x6BDEh5Po3e4pLC1vMG1g=";
    "x86_64-darwin" = "sha256-6hCOY560nK+S+t9w+jc9zrSNsl5blid0xa1JocE2PY4=";
    "aarch64-linux" = "sha256-SpTGMlkAb/1OJMMRxxGNhWh9vrTzEPrdZteWFzyHaNk=";
    "x86_64-linux" = "sha256-YMWcDKxQ6ZFy2VE1svQhhjxLL0pncJ5m2q4CTWUvobU=";
  };

  arch = archs."${system}";
  sha = shas."${system}";

  url = "https://github.com/golang-migrate/migrate/releases/download/v${version}/migrate.${arch}.tar.gz";
in
pkgs.stdenv.mkDerivation {
  name = "migrate";
  version = "${version}";

  src = pkgs.fetchurl {
    url = "${url}";
    sha256 = "${sha}";
  };

  phases = [ "installPhase" ];

  nativeBuildInputs = [ pkgs.gnutar ];

  installPhase = ''
    mkdir -p $out/bin
    tar -xf $src
    cp migrate $out/bin/migrate
    chmod +x $out/bin/migrate
  '';

  meta = {
    description = "Database migrations written in Go. Use as CLI or import as library.";
    mainProgram = "migrate";
  };
}
