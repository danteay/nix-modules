{ pkgs, home-manager }:

let
  filesystem = import ./filesystem.nix;
  modules = import ./modules.nix { inherit pkgs; };
  helpers = { inherit filesystem modules; };
in
{
  inherit filesystem modules;
  profiles = import ./profiles.nix { inherit pkgs home-manager helpers; };
}
