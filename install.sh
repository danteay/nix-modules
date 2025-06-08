#!/usr/bin/env bash

username=$(whoami)

# Function to show usage
show_usage() {
  echo "Usage: $0 [SECTION]"
  echo ""
  echo "SECTION can be one of:"
  echo "  nix_core      - Install Nix core system"
  echo "  home_manager  - Install and configure Home Manager"
  echo "  nix_darwin    - Install nix-darwin (macOS only)"
  echo ""
  echo "If no SECTION is provided, all sections will be executed."
  echo ""
  echo "Examples:"
  echo "  $0               # Install everything"
  echo "  $0 ssh_key       # Create GitHub SSH key"
  echo "  $0 nix_core      # Install only Nix core"
  echo "  $0 home_manager  # Install only Home Manager"
  echo "  $0 nix_darwin    # Install only nix-darwin"
  echo "  $0 -h            # Show this help message"
}

# Create github ssh key
function create_ssh_key() {
  if [ ! -f "$HOME/.ssh/github" ]; then
    ssh-keygen -t ed25519 -f "$HOME/.ssh/github"
    if [ $? -ne 0 ]; then
      echo "Error generating SSH key for GitHub"
      exit 1
    fi
    echo "SSH key for GitHub created successfully!"
  fi
}

function install_nix_core() {
  echo "Installing Nix Core..."

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

    echo ~/.bashrc >> "if command -v \"zsh\" &> /dev/null; then
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
      nur = import (builtins.fetchTarball \"https://github.com/nix-community/NUR/archive/master.tar.gz\") {
        inherit pkgs;
      };
    };
  }" > ~/.config/nixpkgs/config.nix

  echo "Nix Core installation completed successfully!"
}

function install_home_manager() {
  echo "Installing Home Manager..."

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
  else
    echo "Home Manager installation completed successfully!"
  fi
}

function install_nix_darwin() {
  echo "Installing nix-darwin..."

  # Install nix darwin
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "This script is intended to be run on macOS (Darwin) systems only."
    echo "Skipping nix-darwin installation."
    return
  fi

  # install homebrew if not installed
  if ! command -v brew &> /dev/null; then
    echo "Homebrew not found. Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [ $? -ne 0 ]; then
      echo "Error installing Homebrew"
      exit 1
    fi
  fi

  # copy configuration.nix file to the correct location
  if [ ! -d /etc/nix-darwin ]; then
    sudo mkdir -p /etc/nix-darwin
  fi

  # Remove existing file/symlink if it exists
  if [ -e /etc/nix-darwin/configuration.nix ]; then
    sudo rm /etc/nix-darwin/configuration.nix
  fi

  # Create symlink to our configuration file
  sudo ln -s "$PWD/nix-darwin/configuration.nix" /etc/nix-darwin/configuration.nix

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

  sudo ./result/bin/darwin-rebuild switch -I darwin-config=/etc/nix-darwin/configuration.nix

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

# Main execution logic
main() {
  local section="$1"

  # Always create SSH key first
  create_ssh_key

  case "$section" in
    "ssh_key")
      create_ssh_key
      ;;
    "nix_core")
      install_nix_core
      ;;
    "home_manager")
      install_home_manager
      ;;
    "nix_darwin")
      install_nix_darwin
      ;;
    "")
      # No parameter provided - install everything
      echo "No section specified. Installing all components..."
      create_ssh_key
      install_nix_core
      install_home_manager
      install_nix_darwin
      ;;
    "-h"|"--help"|"help")
      show_usage
      exit 0
      ;;
    *)
      echo "Error: Unknown section '$section'"
      echo ""
      show_usage
      exit 1
      ;;
  esac
}

# Run main function with all arguments
main "$@"