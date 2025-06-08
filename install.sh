#!/usr/bin/env bash

username=$(whoami)

# Create github ssh key
if [ ! -f "./dotfiles/$username/ssh/github" ]; then
  ssh-keygen -t ed25519 -f "./dotfiles/$username/ssh/github"
  if [ $? -ne 0 ]; then
    echo "Error generating SSH key for GitHub"
  fi
  echo "SSH key for GitHub created successfully!"
fi

function install_nix_core() {
  # Install Nix Core
  curl -L https://nixos.org/nix/install | sh
  if [ $? -ne 0 ]; then
    echo "Error installing nix"
    exit 1
  fi

  nix_daemon_cmd=". '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh'"

  #execute the command in the current shell
  eval "$nix_daemon_cmd"

  # Check if the OS is Linux and set additional commands to bashrc file
  if [ "$(uname -s)" == "Linux" ]; then
    echo ~/.bashrc >> "$nix_daemon_cmd"

    echo ~/.bashrc >> "if command -v "zsh" &> /dev/null; then
    zsh
  fi"
  fi

  # Add flakes to nix
  mkdir -p ~/.config/nix
  echo "experimental-features = nix-command flakes" > ~/.config/nix/nix.conf

  # Add NUR repository
  mkdir -p ~/.config/nixpkgs
  echo "{
    allowUnfree = true;

    packageOverrides = pkgs: {
      nur = import (builtins.fetchTarball "https://github.com/nix-community/NUR/archive/master.tar.gz") {
        inherit pkgs;
      };
    };
  }" > ~/.config/nixpkgs/config.nix
}

function install_home_manager() {
  # Enable home manager channel
  nix-channel --add https://github.com/nix-community/home-manager/archive/master.tar.gz home-manager
  if [ $? -ne 0 ]; then
    echo "Error adding Nix channel for home-manager"
    exit 1
  fi

  nix-channel --update -v
  if [ $? -ne 0 ]; then
    echo "Error updating nix channels"
    exit 1
  fi

  # Install home manager
  nix-shell '<home-manager>' -A install
  if [ $? -ne 0 ]; then
    echo "Error installing home-manager"
    exit 1
  fi

  # Activate home-manager
  home-manager switch -b backup --impure --flake "$HOME/.config/nix-modules/home-manager#$username"
  if [ $? -ne 0 ]; then
    echo "Error activating home-manager"
    echo "Please check your home-manager configuration file and try again."
    echo
    echo "  home-manager switch -b backup --impure --flake ~/.config/nix-modules/home-manager#$username"
    echo
  fi
}

function install_nix_darwin() {
  # Install nix darwin
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "This script is intended to be run on macOS (Darwin) systems only."
    echo "Skipping nix-darwin installation."
    return
  fi

  # copy configuration.nix file to the correct location
  cp nix-darwin/configuration.nix /etc/nix-darwin/configuration.nix

  # Add nix-darwin channel
  sudo nix-channel --add https://github.com/nix-darwin/nix-darwin/archive/master.tar.gz darwin
  if [ $? -ne 0 ]; then
    echo "Error adding nix-darwin channel"
    exit 1
  fi

  sudo nix-channel --update
  if [ $? -ne 0 ]; then
    echo "Error updating channels for nix-darwin"
    exit 1
  fi

  # Install nix-darwin
  nix-build '<darwin>' -A darwin-rebuild
  if [ $? -ne 0 ]; then
    echo "Error installing nix-darwin"
    exit 1
  fi

  # Move the darwin-rebuild binary to /usr/local/bin

  # check if /usr/local/bin exists, if not create it
  if [ ! -d /usr/local/bin ]; then
    sudo mkdir -p /usr/local/bin
  fi

  cp ./result/bin/darwin-rebuild /usr/local/bin/darwin-rebuild
  if [ $? -ne 0 ]; then
    echo "Error moving darwin-rebuild binary to /usr/local/bin"
    exit 1
  fi

  # remove the result directory
  rm -rf ./result

  sudo /usr/local/bin/darwin-rebuild switch -I darwin-config=~/.config/configuration.nix

  if [ $? -ne 0 ]; then
    echo "Error activating nix-darwin"
    echo "Please check your configuration.nix file and try again."
    echo
    echo "  sudo darwin-rebuild switch -I darwin-config=~/.config/configuration.nix"
    exit 1
  else
    echo "nix-darwin installed successfully!"
  fi
}
