{
  description = "Home Manager configuration";

  inputs = {
    # Specify the source of Home Manager and Nixpkgs.
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

    # Use the latest version of Home Manager
    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";

    # extra flakes
    draft.url = "github:Drafteame/draft";
    taskrun.url = "github:Drafteame/taskrun";
  };

  outputs = {
    nixpkgs
    , home-manager

    # extra flakes
    , draft
    , taskrun

    , ...
  }:
    let
      system = builtins.currentSystem;
      pkgs = nixpkgs.legacyPackages.${system};

      # listDirModules: string -> list of string
      # Receives a directory and returns a list of all the nix files in it
      # Now with proper error handling for non-existent or unreadable directories
      listDirModules = path:
        if builtins.pathExists path then
          let
            # Use try-catch equivalent by checking if readDir succeeds
            dirContents = builtins.tryEval (builtins.readDir path);
          in
          if dirContents.success then
            let
              files = builtins.attrNames dirContents.value;
              nixFiles = builtins.filter (name:
                builtins.match ".*\\.nix" name != null &&
                !(builtins.match ".*\\.skip\\.nix" name != null)
              ) files;
            in
            builtins.map (file: path + "/${file}") nixFiles
          else
            # Directory exists but is not readable, return empty list
            []
        else
          # Directory doesn't exist, return empty list
          [];

      # listProfiles: string -> list of string
      # Receives a directory and returns a list of all profile directories in it
      # Now with proper error handling for non-existent or unreadable directories
      listProfiles = path:
        if builtins.pathExists path then
          let
            # Use try-catch equivalent by checking if readDir succeeds
            dirContents = builtins.tryEval (builtins.readDir path);
          in
          if dirContents.success then
            let
              items = builtins.attrNames dirContents.value;
              # Filter only directories
              directories = builtins.filter (name:
                let
                  itemPath = path + "/${name}";
                  pathType = builtins.tryEval (builtins.readFileType itemPath);
                in
                pathType.success && pathType.value == "directory"
              ) items;
            in
            builtins.map (file: path + "/${file}") directories
          else
            # Directory exists but is not readable, return empty list
            []
        else
          # Directory doesn't exist, return empty list
          [];

      # Load all Nix files from the global folder
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

          # Safe module loading with error handling
          userModulesResult = builtins.tryEval (pkgs.callPackage (profile + "/default.nix") {});
          userModules = if userModulesResult.success && userModulesResult.value ? modules
            then userModulesResult.value.modules
            else [];

          userGitConfig = if builtins.pathExists (profile + "/custom/git.nix")
            then makeCustomModule { path = ./modules/custom/git.nix; config = (import (profile + "/custom/git.nix"));}
            else makeCustomModule { path = ./modules/custom/git.nix; config = {}; };

          importFlakes = if builtins.pathExists (profile + "/custom/import-flakes.nix")
            then import (profile + "/custom/import-flakes.nix") {
              inherit system;
              inherit draft;
              inherit taskrun;
            } else { ... }: {};

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