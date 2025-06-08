{}:
{
  # Specify your own configuration modules here, for example,
  modules = [
    # Common modules

    ../../modules/dev-tools/containers.nix
    ../../modules/dev-tools/general.nix
    ../../modules/dev-tools/libyaml.nix

    ../../modules/langs/golang.nix
    ../../modules/langs/nodejs.nix
    ../../modules/langs/python.nix


    # User modules

    ./modules/aws-config.nix
    ./modules/dev-tools.nix
    ./modules/draft-cli.nix
    ./modules/env-vars.nix
    ./modules/node-modules.nix
    ./modules/pems.nix
    ./modules/shortcuts.nix
  ];
}
