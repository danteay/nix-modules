#!/usr/bin/env bash

set -e  # Exit on error

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
username=$(whoami)
nix_daemon_cmd="/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh"

# Track if system rc files have been backed up
rc_files_backed_up=false

# Function to show usage
function show_usage() {
  echo "Usage: $0 [SECTION]"
  echo ""
  echo "SECTION can be one of:"
  echo "  nix_core            - Install Nix core system"
  echo "  configure_nix       - Configure Nix (flakes, NUR)"
  echo "  home_manager        - Install Home Manager"
  echo "  configure_hm        - Configure Home Manager with flake"
  echo "  nix_darwin          - Install nix-darwin (macOS only)"
  echo "  configure_darwin    - Configure nix-darwin (macOS only)"
  echo "  all_install         - Install all tools (without configuration)"
  echo "  all_configure       - Configure all tools"
  echo ""
  echo "If no SECTION is provided, all sections will be executed."
  echo ""
  echo "Examples:"
  echo "  $0                     # Install and configure everything"
  echo "  $0 nix_core            # Install only Nix core"
  echo "  $0 configure_nix       # Configure Nix only"
  echo "  $0 all_install         # Install all tools without configuring"
  echo "  $0 all_configure       # Configure all installed tools"
  echo "  $0 -h                  # Show this help message"
}

# Function to verify if Nix is installed and try to activate it
function verify_nix_installed() {
  # Check if nix command is available
  if command -v nix &> /dev/null; then
    return 0
  fi

  # Try to source nix-daemon.sh if it exists
  if [ -f "$nix_daemon_cmd" ]; then
    . "$nix_daemon_cmd"
    if [ $? -eq 0 ] && command -v nix &> /dev/null; then
      return 0
    fi
  fi

  return 1
}

# Function to backup system shell rc files before Nix installation
function _backup_rc_files() {
  echo "Backing up system shell rc files..."

  if [ "$rc_files_backed_up" = true ]; then
    return
  fi

  # Backup /etc/bashrc if it exists
  if [ -f "/etc/bashrc" ]; then
    # Remove old backup if exists
    if [ -f "/etc/bashrc.backup-before-nix" ]; then
      sudo rm /etc/bashrc.backup-before-nix
    fi
    echo "Creating backup: /etc/bashrc -> /etc/bashrc.backup-before-nix"
    sudo mv "/etc/bashrc" "/etc/bashrc.backup-before-nix"
  fi

  # Backup /etc/zshrc if it exists
  if [ -f "/etc/zshrc" ]; then
    # Remove old backup if exists
    if [ -f "/etc/zshrc.backup-before-nix" ]; then
      sudo rm /etc/zshrc.backup-before-nix
    fi
    echo "Creating backup: /etc/zshrc -> /etc/zshrc.backup-before-nix"
    sudo mv "/etc/zshrc" "/etc/zshrc.backup-before-nix"
  fi

  rc_files_backed_up=true
}

function install_nix_core() {
  echo "Installing Nix Core..."

  # Check if Nix is already installed or can be activated
  verify_nix_installed
  if [ $? -eq 0 ]; then
    echo "Nix is already installed at: $(command -v nix)"
    echo "Skipping installation. Run 'configure_nix' to update configuration."
    return 0
  fi

  # Backup system rc files before installation
  _backup_rc_files

  # Install Nix Core
  echo "Downloading and installing Nix..."
  curl -L https://nixos.org/nix/install | sh
  if [ $? -ne 0 ]; then
    echo "Error installing nix"
    exit 1
  fi

  # Source nix in current shell
  if [ -f "$nix_daemon_cmd" ]; then
    . "$nix_daemon_cmd"
  fi

  # Check if the OS is Linux and add to shell rc files
  if [ "$(uname -s)" == "Linux" ]; then
    local daemon_line="if [ -f $nix_daemon_cmd ]; then . $nix_daemon_cmd; fi"

    # Add to bashrc if not already present
    if [ -f "$HOME/.bashrc" ]; then
      if ! grep -F "$nix_daemon_cmd" "$HOME/.bashrc" >/dev/null 2>&1; then
        echo "" >> "$HOME/.bashrc"
        echo "# Nix" >> "$HOME/.bashrc"
        echo "$daemon_line" >> "$HOME/.bashrc"
      fi
    else
      echo "$daemon_line" >> "$HOME/.bashrc"
    fi

    # Add to zshrc if zsh is available
    if [ -f "$HOME/.zshrc" ]; then
      if ! grep -F "$nix_daemon_cmd" "$HOME/.zshrc" >/dev/null 2>&1; then
        echo "" >> "$HOME/.zshrc"
        echo "# Nix" >> "$HOME/.zshrc"
        echo "$daemon_line" >> "$HOME/.zshrc"
      fi
    fi
  fi

  echo "Nix Core installation completed successfully!"
  echo "You may need to restart your shell or source your profile."
}

function configure_nix() {
  echo "Configuring Nix..."

  # Check if Nix is installed or can be activated
  verify_nix_installed
  if [ $? -ne 0 ]; then
    echo "Error: Nix is not installed. Please run 'nix_core' first."
    exit 1
  fi

  # Add flakes to nix
  echo "Enabling experimental features (flakes)..."
  mkdir -p ~/.config/nix

  local nix_conf="$HOME/.config/nix/nix.conf"
  if [ -f "$nix_conf" ]; then
    # Check if flakes are already enabled
    if grep -q "experimental-features.*nix-command.*flakes" "$nix_conf" || grep -q "experimental-features.*flakes.*nix-command" "$nix_conf"; then
      echo "Flakes already enabled in $nix_conf"
    else
      echo "Warning: $nix_conf already exists but doesn't have flakes enabled."
      echo "Creating backup at ${nix_conf}.backup"
      cp "$nix_conf" "${nix_conf}.backup"
      echo "experimental-features = nix-command flakes" > "$nix_conf"
      echo "Updated $nix_conf with flakes configuration."
    fi
  else
    echo "experimental-features = nix-command flakes" > "$nix_conf"
    echo "Created $nix_conf with flakes configuration."
  fi

  # Add NUR repository
  echo "Configuring NUR (Nix User Repository)..."
  mkdir -p ~/.config/nixpkgs

  local nixpkgs_config="$HOME/.config/nixpkgs/config.nix"
  if [ -f "$nixpkgs_config" ]; then
    # Check if NUR is already configured
    if grep -q "nur = import" "$nixpkgs_config"; then
      echo "NUR already configured in $nixpkgs_config"
    else
      echo "Warning: $nixpkgs_config already exists."
      echo "Creating backup at ${nixpkgs_config}.backup"
      cp "$nixpkgs_config" "${nixpkgs_config}.backup"
      echo "{
    allowUnfree = true;

    packageOverrides = pkgs: {
      nur = import (builtins.fetchTarball \"https://github.com/nix-community/NUR/archive/master.tar.gz\") {
        inherit pkgs;
      };
    };
  }" > "$nixpkgs_config"
      echo "Updated $nixpkgs_config with NUR configuration."
    fi
  else
    echo "{
    allowUnfree = true;

    packageOverrides = pkgs: {
      nur = import (builtins.fetchTarball \"https://github.com/nix-community/NUR/archive/master.tar.gz\") {
        inherit pkgs;
      };
    };
  }" > "$nixpkgs_config"
 us   echo "Created $nixpkgs_config with NUR configuration."
  fi

  echo "Nix configuration completed successfully!"
}

function install_home_manager() {
  echo "Installing Home Manager..."

  # Check if Nix is installed or can be activated
  verify_nix_installed
  if [ $? -ne 0 ]; then
    echo "Error: Nix is not installed. Please run 'nix_core' first."
    exit 1
  fi

  # Check if home-manager is already installed
  if command -v home-manager &> /dev/null; then
    echo "Home Manager is already installed at: $(command -v home-manager)"
    echo "Skipping installation. Run 'configure_hm' to apply configuration."
    return 0
  fi

  # Enable home manager channel
  echo "Adding home-manager channel..."
  nix-channel --add https://github.com/nix-community/home-manager/archive/master.tar.gz home-manager
  if [ $? -ne 0 ]; then
    echo "Error adding Nix channel for home-manager"
    exit 1
  fi

  echo "Updating nix channels..."
  nix-channel --update -v
  if [ $? -ne 0 ]; then
    echo "Error updating nix channels"
    exit 1
  fi

  # Install home manager
  echo "Installing home-manager..."
  nix-shell '<home-manager>' -A install
  if [ $? -ne 0 ]; then
    echo "Error installing home-manager"
    exit 1
  fi

  echo "Home Manager installation completed successfully!"
  echo "Run 'configure_hm' to activate your configuration."
}

function configure_hm() {
  echo "Configuring Home Manager..."

  # Check if home-manager is installed
  if ! command -v home-manager &> /dev/null; then
    echo "Error: Home Manager is not installed. Please run 'home_manager' first."
    exit 1
  fi

  # Check if flake exists
  if [ ! -f "$SCRIPT_DIR/home-manager/flake.nix" ]; then
    echo "Error: Home Manager flake not found at $SCRIPT_DIR/home-manager/flake.nix"
    exit 1
  fi

  # Check if profile exists
  if [ ! -d "$SCRIPT_DIR/home-manager/profiles/$username" ]; then
    echo "Warning: Profile '$username' not found in $SCRIPT_DIR/home-manager/profiles/"
    echo "Available profiles:"
    ls -1 "$SCRIPT_DIR/home-manager/profiles/" 2>/dev/null || echo "  (none)"
    echo ""
    echo "Please create a profile for '$username' or use an existing profile."
    exit 1
  fi

  # Activate home-manager
  echo "Activating home-manager configuration for user '$username'..."
  home-manager switch -b backup --impure --flake "$SCRIPT_DIR/home-manager#$username"

  if [ $? -ne 0 ]; then
    echo ""
    echo "Error activating home-manager configuration."
    echo "Please check your configuration and try again manually:"
    echo ""
    echo "  home-manager switch -b backup --impure --flake $SCRIPT_DIR/home-manager#$username"
    echo ""
    exit 1
  fi

  echo "Home Manager configuration completed successfully!"
}

function install_nix_darwin() {
  echo "Installing nix-darwin..."

  # Check if running on macOS
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "This script is intended to be run on macOS (Darwin) systems only."
    echo "Skipping nix-darwin installation."
    return 0
  fi

  # Check if Nix is installed or can be activated
  verify_nix_installed
  if [ $? -ne 0 ]; then
    echo "Error: Nix is not installed. Please run 'nix_core' first."
    exit 1
  fi

  # Backup system rc files before nix-darwin installation
  _backup_rc_files

  # Check if darwin-rebuild already exists
  if command -v darwin-rebuild &> /dev/null; then
    echo "nix-darwin is already installed at: $(command -v darwin-rebuild)"
    echo "Skipping installation. Run 'configure_darwin' to apply configuration."
    return 0
  fi

  # Install homebrew if not installed
  if ! command -v brew &> /dev/null; then
    echo "Homebrew not found. Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [ $? -ne 0 ]; then
      echo "Error installing Homebrew"
      exit 1
    fi
  else
    echo "Homebrew is already installed."
  fi

  # Add nix-darwin channel
  echo "Adding nix-darwin channel..."
  nix-channel --add https://github.com/nix-darwin/nix-darwin/archive/master.tar.gz darwin
  if [ $? -ne 0 ]; then
    echo "Error adding nix-darwin channel"
    exit 1
  fi

  echo "Updating channels..."
  nix-channel --update
  if [ $? -ne 0 ]; then
    echo "Error updating channels for nix-darwin"
    exit 1
  fi

  # Install nix-darwin
  echo "Building nix-darwin..."
  nix-build '<darwin>' -A darwin-rebuild
  if [ $? -ne 0 ]; then
    echo "Error building nix-darwin"
    exit 1
  fi

  echo "nix-darwin installed successfully!"
  echo "Run 'configure_darwin' to activate your configuration."
}

function configure_darwin() {
  echo "Configuring nix-darwin..."

  # Check if running on macOS
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "This script is intended to be run on macOS (Darwin) systems only."
    echo "Skipping nix-darwin configuration."
    return 0
  fi

  # Check if darwin-rebuild exists
  if ! command -v darwin-rebuild &> /dev/null; then
    echo "Error: nix-darwin is not installed. Please run 'nix_darwin' first."
    exit 1
  fi

  # Check if configuration exists
  if [ ! -f "$SCRIPT_DIR/nix-darwin/configuration.nix" ]; then
    echo "Error: nix-darwin configuration not found at $SCRIPT_DIR/nix-darwin/configuration.nix"
    exit 1
  fi

  # Create /etc/nix-darwin directory if needed
  if [ ! -d /etc/nix-darwin ]; then
    echo "Creating /etc/nix-darwin directory..."
    sudo mkdir -p /etc/nix-darwin
  fi

  local target_config="/etc/nix-darwin/configuration.nix"
  local source_config="$SCRIPT_DIR/nix-darwin/configuration.nix"

  # Check if configuration already exists
  if [ -e "$target_config" ]; then
    # Check if it's a symlink pointing to our config
    if [ -L "$target_config" ]; then
      local current_target=$(readlink "$target_config")
      if [ "$current_target" = "$source_config" ]; then
        echo "Configuration already linked correctly to $source_config"
      else
        echo "Warning: $target_config is a symlink to a different location:"
        echo "  Current: $current_target"
        echo "  Desired: $source_config"
        echo "Creating backup at ${target_config}.backup"
        sudo cp -L "$target_config" "${target_config}.backup"
        echo "Updating symlink..."
        sudo rm "$target_config"
        sudo ln -s "$source_config" "$target_config"
        echo "Symlink updated to $source_config"
      fi
    else
      # It's a regular file, not a symlink
      echo "Warning: $target_config exists as a regular file (not a symlink)."
      echo "Creating backup at ${target_config}.backup"
      sudo cp "$target_config" "${target_config}.backup"
      echo "Replacing with symlink..."
      sudo rm "$target_config"
      sudo ln -s "$source_config" "$target_config"
      echo "Replaced with symlink to $source_config"
    fi
  else
    # Create symlink to our configuration file
    echo "Creating symlink to $source_config..."
    sudo ln -s "$source_config" "$target_config"
  fi

  # Activate nix-darwin
  echo "Activating nix-darwin configuration..."
  sudo darwin-rebuild switch -I darwin-config=/etc/nix-darwin/configuration.nix

  if [ $? -ne 0 ]; then
    echo ""
    echo "Error activating nix-darwin configuration."
    echo "Please check your configuration and try again manually:"
    echo ""
    echo "  sudo darwin-rebuild switch -I darwin-config=/etc/nix-darwin/configuration.nix"
    echo ""
    exit 1
  fi

  echo "nix-darwin configuration completed successfully!"
}

# Main execution logic
function main() {
  local section="$1"

  case "$section" in
    "nix_core")
      install_nix_core
      ;;
    "configure_nix")
      configure_nix
      ;;
    "home_manager")
      install_home_manager
      ;;
    "configure_hm")
      configure_hm
      ;;
    "nix_darwin")
      install_nix_darwin
      ;;
    "configure_darwin")
      configure_darwin
      ;;
    "all_install")
      echo "Installing all tools..."
      install_nix_core
      configure_nix
      install_home_manager
      install_nix_darwin
      echo ""
      echo "All tools installed successfully!"
      echo "Run '$0 all_configure' to configure all tools."
      ;;
    "all_configure")
      echo "Configuring all tools..."
      configure_hm
      configure_darwin
      echo ""
      echo "All configurations applied successfully!"
      ;;
    "")
      # No parameter provided - install and configure everything
      echo "No section specified. Installing and configuring all components..."
      echo ""
      install_nix_core
      configure_nix
      install_home_manager
      configure_hm
      install_nix_darwin
      configure_darwin
      echo ""
      echo "================================================"
      echo "Installation and configuration complete!"
      echo "================================================"
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