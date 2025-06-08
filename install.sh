#!/usr/bin/env bash

username=$(whoami)

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

# Install nix darwin
if [ "$(uname -s)" == "Darwin" ]; then
  #copy configuration.nix file to the correct location
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

  sudo ./result/bin/darwin-rebuild switch -I darwin-config=~/.config/configuration.nix
  
  echo "nix-darwin installed successfully!"
  echo "You can now activate your configuration with:"
  echo "sudo darwin-rebuild switch"
fi

# Create github ssh key
if [ ! -f "$HOME/.config/dotfiles/$username/ssh/github" ]; then
  ssh-keygen github
  if [ $? -ne 0 ]; then
    echo "Error generating SSH key for GitHub"
  fi
  echo "SSH key for GitHub created successfully!"
fi