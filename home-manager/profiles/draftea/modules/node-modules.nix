{ pkgs, ... }:
let
  npm = (pkgs.callPackage ../../../modules/npm/default.nix { });
in
{
  home.packages = [
    npm.json-keys-diff
  ];
}
