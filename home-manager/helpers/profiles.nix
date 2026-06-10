{ pkgs, home-manager, helpers }:

let
  inherit (helpers.filesystem) listDirModules;
  inherit (helpers.modules) makeCustomModule;

  emptyModule = { ... }: {};

  # readProfileImport: { path, importArgs } -> value
  # When `importArgs` is null the imported value is returned as-is (file is a
  # plain attrset). Otherwise the imported value is called with `importArgs`
  # (file is a function from args to attrset/module).
  readProfileImport = { path, importArgs }:
    let v = import path; in
    if importArgs == null then v else v importArgs;
in
{
  # collectGlobalModules: list of profile paths -> list of module paths
  # Walks each profile's `global/` subdirectory and concatenates the
  # discovered .nix module paths.
  collectGlobalModules = profiles:
    builtins.concatLists (builtins.map (profile:
      if builtins.pathExists (profile + "/global")
        then listDirModules (profile + "/global")
        else []
    ) profiles);

  # loadUserModules: profile -> list of modules
  # Loads `<profile>/default.nix` via pkgs.callPackage and returns its
  # `modules` attribute. Falls back to [] when the file is missing or
  # malformed.
  loadUserModules = profile:
    let
      result = builtins.tryEval (pkgs.callPackage (profile + "/default.nix") {});
    in
    if result.success && result.value ? modules then result.value.modules else [];

  # loadCustomTemplate: { template, name, importArgs ? null } -> profile -> module
  # Instantiates the parameterized module `template` using config read from
  # `<profile>/custom/<name>.nix`. When the profile file is absent the
  # template is applied with an empty config so the template's own defaults
  # take over. Set `importArgs = null` when the profile file is a plain
  # attrset; pass an attrset when the profile file is a function.
  loadCustomTemplate = { template, name, importArgs ? null }: profile:
    let
      profileFile = profile + "/custom/${name}.nix";
      config =
        if builtins.pathExists profileFile
          then readProfileImport { path = profileFile; inherit importArgs; }
          else {};
    in
    makeCustomModule { path = template; inherit config; };

  # loadProfileModule: { name, importArgs ? {} } -> profile -> module
  # Imports `<profile>/custom/<name>.nix` as a home-manager module directly,
  # passing `importArgs` to it. Returns a no-op module when absent. Use this
  # for profile files that are themselves complete modules rather than
  # template configs.
  loadProfileModule = { name, importArgs ? {} }: profile:
    let
      file = profile + "/custom/${name}.nix";
    in
    if builtins.pathExists file
      then (import file) importArgs
      else emptyModule;

  # buildConfigurations: builds a `homeConfigurations`-shaped attrset by
  # composing per-profile home-manager configurations from a list of
  # module sources.
  #
  # Arguments:
  #   profiles       - list of absolute profile-directory paths
  #   commonModules  - modules applied to every profile (e.g. home.nix + globals)
  #   profileGlobals - modules collected from every profile's `global/` dir
  #   moduleSources  - list of `profile -> module | list of modules` loaders.
  #                    Each loader runs once per profile and contributes its
  #                    result to that profile's module list. Adding a new
  #                    custom module = append one loader here; no changes to
  #                    `buildConfigurations` internals.
  buildConfigurations = { profiles, commonModules, profileGlobals, moduleSources }:
    builtins.listToAttrs (builtins.map (profile: {
      name = builtins.baseNameOf profile;

      value = home-manager.lib.homeManagerConfiguration {
        inherit pkgs;

        modules = commonModules ++ profileGlobals ++ builtins.concatMap (source:
          let result = source profile; in
          if builtins.isList result then result else [ result ]
        ) moduleSources;
      };
    }) profiles);
}
