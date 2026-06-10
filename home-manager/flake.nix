{
  description = "Home Manager configuration";

  inputs = {
    # Specify the source of Home Manager and Nixpkgs.
    nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";
    unstable-pkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";

    # Use the latest version of Home Manager
    home-manager.url = "github:nix-community/home-manager/release-26.05";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";

    # # extra flakes
    # draft.url = "github:Drafteame/draft";
    # draft.inputs.nixpkgs.follows = "nixpkgs";

    # taskrun.url = "github:Drafteame/taskrun";
    # taskrun.inputs.nixpkgs.follows = "nixpkgs";

    # modcheck.url = "github:Drafteame/modcheck";
    # modcheck.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = {
    nixpkgs
    , unstable-pkgs
    , home-manager

    # extra flakes
    # , draft
    # , taskrun
    # , modcheck

    , ...
  }:
    let
      system = builtins.currentSystem;

      pkgs = nixpkgs.legacyPackages.${system}.extend (final: prev: {
        # go = unstable-pkgs.legacyPackages.${system}.go;
        # go-mockery = unstable-pkgs.legacyPackages.${system}.go-mockery;
        # inetutils-2.7 fails to compile with clang-21 on macOS in nixos-25.11 (revalidate on 26.05)
        inetutils = unstable-pkgs.legacyPackages.${system}.inetutils;
        # direnv-2.37.1 fish tests get killed during build on macOS (nixos-25.11, revalidate on 26.05)
        direnv = prev.direnv.overrideAttrs (_: { doCheck = false; });
      });

      helpers = import ./helpers { inherit pkgs home-manager; };
      inherit (helpers.filesystem) listDirModules listProfiles;
      inherit (helpers.profiles)
        collectGlobalModules
        buildConfigurations
        loadUserModules
        loadCustomTemplate
        loadProfileModule;

      profiles = listProfiles ./profiles;
      commonModules = [ ./home.nix ] ++ listDirModules ./global;
      profileGlobals = collectGlobalModules profiles;
    in
    {
      homeConfigurations = buildConfigurations {
        inherit profiles commonModules profileGlobals;

        # Each entry is a `profile -> module | list of modules` loader.
        # Add a new custom module by appending a loader to this list.
        moduleSources = [
          loadUserModules
          (loadCustomTemplate { template = ./modules/custom/git.nix; name = "git"; })
          (loadCustomTemplate { template = ./modules/custom/zsh.nix; name = "zsh"; importArgs = { inherit pkgs; }; })
          (loadProfileModule { name = "import-flakes"; importArgs = { inherit system; }; })
        ];
      };
    };
}