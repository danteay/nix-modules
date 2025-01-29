{
  description = "Home Manager configuration";

  inputs = {
    # Specify the source of Home Manager and Nixpkgs.
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { nixpkgs, home-manager, ... }:
    let
      system = builtins.currentSystem;
      pkgs = nixpkgs.legacyPackages.${system};

      # listDirModules: string -> list of string
      # Receives a directory and returns a list of all the nix files in it
      listDirModules = path:
        let
          files = builtins.attrNames (builtins.readDir path);
          nixFiles = builtins.filter (name:
            builtins.match ".*\\.nix" name != null &&
            !(builtins.match ".*\\.skip\\.nix" name != null)
          ) files;
        in
        builtins.map (file: path + "/${file}") nixFiles;

      # listProfiles: string -> list of string
      # Receives a directory and returns a list of all profile directories in it
      listProfiles = path:
        let
          items = builtins.attrNames (builtins.readDir path);
        in
        builtins.map (file: path + "/${file}") items;

      # Load all Nix files from the global folder
      # userGlobalModules = listDirModules ./profiles/eduardoay/global;
      generalGlobalModules = listDirModules ./global;
      commonModules = [ ./home.nix ] ++ generalGlobalModules;

      allProfileGlobalModules = builtins.concatLists (builtins.map (profile:
        if builtins.pathExists (profile + "/global")
          then listDirModules (profile + "/global")
          else []
      ) profiles);

      makeCustomModule = { path, config }: { ... }: {
        imports = [
          (import path {
            inherit pkgs;
            inherit config;
          })
        ];
      };

      profiles = listProfiles ./profiles;

      # create each profile configuration using the profile name and the home-manager.lib.homeManagerConfiguration derivation
      profilesConfig = builtins.listToAttrs (builtins.map (profile:
        let
          profileName = builtins.baseNameOf profile;

          userModules = (pkgs.callPackage (profile + "/default.nix") {}).modules;

          userGitConfig = if builtins.pathExists (profile + "/custom/git.nix")
            then makeCustomModule { path = ./modules/custom/git.nix; config = (import (profile + "/custom/git.nix"));}
            else makeCustomModule { path = ./modules/custom/git.nix; config = {}; };

          importFlakes = if builtins.pathExists (profile + "/custom/import-flakes.nix")
            then import (profile + "/custom/import-flakes.nix") { inherit system; }
            else { ... }: {};

          zshConfig = if builtins.pathExists (profile + "/custom/zsh.nix")
            then makeCustomModule { path = ./modules/custom/zsh.nix; config = (import (profile + "/custom/zsh.nix") { inherit pkgs; }); }
            else makeCustomModule { path = ./modules/custom/zsh.nix; config = {}; };
        in
        {
          name = profileName;

          value = home-manager.lib.homeManagerConfiguration {
            inherit pkgs;

            modules = commonModules ++ allProfileGlobalModules ++ userModules ++ [
              userGitConfig
              importFlakes
              zshConfig
            ];
          };
        }
      ) profiles);
    in
    {
      homeConfigurations = profilesConfig;
    };
}
