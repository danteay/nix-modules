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

    ./modules/zsh-powerlevel10k.nix
    ./modules/helix.nix
  ];
}
