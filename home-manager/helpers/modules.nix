{ pkgs }:

{
  # makeCustomModule: { path, config } -> home-manager module
  # Wraps a parameterized module file at `path` by importing it with `pkgs`
  # and the provided `config`, producing a module suitable for home-manager.
  makeCustomModule = { path, config }: { ... }: {
    imports = [
      (import path {
        inherit pkgs;
        inherit config;
      })
    ];
  };
}
