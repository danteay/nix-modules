#!/usr/bin/env bash

set -e  # Exit on error

# Default configuration
MY_OP_ADDRESS="my.1password.com"
MY_OP_EMAIL="dante.aguilar41@gmail.com"
DRAFTEA_OP_ADDRESS="draftea.1password.com"
DRAFTEA_OP_EMAIL="eduardo.aguilar@draftea.com"

# Function to show usage
function show_usage() {
  echo "Usage: $0 [SECTION]"
  echo ""
  echo "SECTION can be one of:"
  echo "  setup_op_accounts    - Add 1Password accounts"
  echo "  signin_op_accounts   - Sign in to 1Password accounts"
  echo "  setup_ssh_keys       - Download SSH keys from 1Password"
  echo "  setup_aws_creds      - Download AWS credentials from 1Password"
  echo "  setup_draftea_pems   - Download Draftea PEM files from 1Password"
  echo "  all_credentials      - Set up all credentials"
  echo ""
  echo "If no SECTION is provided, all sections will be executed."
  echo ""
  echo "Examples:"
  echo "  $0                      # Set up everything"
  echo "  $0 setup_op_accounts    # Only add 1Password accounts"
  echo "  $0 setup_ssh_keys       # Only download SSH keys"
  echo "  $0 -h                   # Show this help message"
}

# Function to check if 1Password CLI is installed
function verify_op_installed() {
  if ! command -v op &> /dev/null; then
    echo "Error: 1Password CLI (op) is not installed."
    echo "Please install it first: https://developer.1password.com/docs/cli/get-started/"
    exit 1
  fi
}

# Function to backup a file if it exists
function backup_file() {
  local file="$1"
  if [ -f "$file" ]; then
    local backup="${file}.backup-$(date +%Y%m%d-%H%M%S)"
    echo "Backing up existing file: $file -> $backup"
    cp "$file" "$backup"
  fi
}

# Function to set up 1Password accounts
function setup_op_accounts() {
  echo "Setting up 1Password accounts..."

  verify_op_installed

  # Check if 'my' account already exists
  if op account list 2>/dev/null | grep -q "$MY_OP_ADDRESS"; then
    echo "1Password account '$MY_OP_ADDRESS' already configured."
  else
    echo "Adding 1Password account: $MY_OP_ADDRESS"
    op account add --address "$MY_OP_ADDRESS" --email "$MY_OP_EMAIL"
    if [ $? -ne 0 ]; then
      echo "Warning: Failed to add 'my' account. It may already exist or credentials may be incorrect."
    fi
  fi

  # Check if 'draftea' account already exists
  if op account list 2>/dev/null | grep -q "$DRAFTEA_OP_ADDRESS"; then
    echo "1Password account '$DRAFTEA_OP_ADDRESS' already configured."
  else
    echo "Adding 1Password account: $DRAFTEA_OP_ADDRESS"
    op account add --address "$DRAFTEA_OP_ADDRESS" --email "$DRAFTEA_OP_EMAIL"
    if [ $? -ne 0 ]; then
      echo "Warning: Failed to add 'draftea' account. It may already exist or credentials may be incorrect."
    fi
  fi

  echo "1Password accounts configured."
}

# Function to sign in to 1Password accounts
function signin_op_accounts() {
  echo "Signing in to 1Password accounts..."

  verify_op_installed

  # Sign in to 'my' account
  echo "Signing in to $MY_OP_ADDRESS..."
  if ! op account get --account my &> /dev/null; then
    # Not signed in, attempt to sign in
    op signin --account my
    if [ $? -ne 0 ]; then
      echo "Error: Failed to sign in to 'my' account."
      exit 1
    fi
  else
    echo "Already signed in to $MY_OP_ADDRESS"
  fi

  # Sign in to 'draftea' account
  echo "Signing in to $DRAFTEA_OP_ADDRESS..."
  if ! op account get --account draftea &> /dev/null; then
    # Not signed in, attempt to sign in
    op signin --account draftea
    if [ $? -ne 0 ]; then
      echo "Error: Failed to sign in to 'draftea' account."
      exit 1
    fi
  else
    echo "Already signed in to $DRAFTEA_OP_ADDRESS"
  fi

  echo "Successfully signed in to all 1Password accounts."
}

# Function to set up SSH keys
function setup_ssh_keys() {
  echo "Setting up SSH keys..."

  verify_op_installed

  # Create .ssh folder if it doesn't exist
  if [ ! -d "$HOME/.ssh" ]; then
    echo "Creating $HOME/.ssh directory..."
    mkdir -p "$HOME/.ssh"
    chmod 700 "$HOME/.ssh"
  fi

  local ssh_key="$HOME/.ssh/github"
  local ssh_pub="$HOME/.ssh/github.pub"

  # Backup existing keys if they exist
  backup_file "$ssh_key"
  backup_file "$ssh_pub"

  # Download github ssh keys
  echo "Downloading SSH private key from 1Password..."
  op document get ssh-github --vault Development --account "$MY_OP_ADDRESS" --output "$ssh_key"
  if [ $? -ne 0 ]; then
    echo "Error: Failed to download SSH private key."
    exit 1
  fi

  echo "Downloading SSH public key from 1Password..."
  op document get ssh-github-pub --vault Development --account "$MY_OP_ADDRESS" --output "$ssh_pub"
  if [ $? -ne 0 ]; then
    echo "Error: Failed to download SSH public key."
    exit 1
  fi

  # Set proper permissions for github certs
  chmod 600 "$ssh_key"
  chmod 644 "$ssh_pub"

  echo "SSH keys set up successfully."
}

# Function to set up AWS credentials
function setup_aws_creds() {
  echo "Setting up AWS configuration files..."

  verify_op_installed

  # Create .aws directory if it doesn't exist
  if [ ! -d "$HOME/.aws" ]; then
    echo "Creating $HOME/.aws directory..."
    mkdir -p "$HOME/.aws"
    chmod 700 "$HOME/.aws"
  fi

  local aws_config="$HOME/.aws/config"
  local aws_creds="$HOME/.aws/credentials"

  # Backup existing AWS files if they exist
  backup_file "$aws_config"
  backup_file "$aws_creds"

  # Download AWS config
  echo "Downloading AWS config from 1Password..."
  op document get aws-config --vault Development --account "$MY_OP_ADDRESS" --output "$aws_config"
  if [ $? -ne 0 ]; then
    echo "Error: Failed to download AWS config."
    exit 1
  fi

  # Download AWS credentials
  echo "Downloading AWS credentials from 1Password..."
  op document get aws-credentials --vault Development --account "$MY_OP_ADDRESS" --output "$aws_creds"
  if [ $? -ne 0 ]; then
    echo "Error: Failed to download AWS credentials."
    exit 1
  fi

  # Set proper permissions
  chmod 600 "$aws_config"
  chmod 600 "$aws_creds"

  echo "AWS credentials set up successfully."
}

# Function to set up Draftea PEM files
function setup_draftea_pems() {
  echo "Setting up Draftea PEM files..."

  verify_op_installed

  # Create .draftea/pems directory if it doesn't exist
  if [ ! -d "$HOME/.draftea/pems" ]; then
    echo "Creating $HOME/.draftea/pems directory..."
    mkdir -p "$HOME/.draftea/pems"
    chmod 700 "$HOME/.draftea/pems"
  fi

  local dev_pem="$HOME/.draftea/pems/dev-bastion.pem"
  local prod_pem="$HOME/.draftea/pems/prod-bastion.pem"

  # Backup existing PEM files if they exist
  backup_file "$dev_pem"
  backup_file "$prod_pem"

  # Download DEV PEM file
  echo "Downloading DEV bastion PEM from 1Password..."
  op document get "Key Bastion DEV" --vault Engineering --account "$DRAFTEA_OP_ADDRESS" --output "$dev_pem"
  if [ $? -ne 0 ]; then
    echo "Error: Failed to download DEV bastion PEM."
    exit 1
  fi

  # Download PROD PEM file
  echo "Downloading PROD bastion PEM from 1Password..."
  op document get "Key Bastion PROD" --vault Engineering --account "$DRAFTEA_OP_ADDRESS" --output "$prod_pem"
  if [ $? -ne 0 ]; then
    echo "Error: Failed to download PROD bastion PEM."
    exit 1
  fi

  # Set proper permissions for the PEM files (SSH keys should be readable only by owner)
  chmod 600 "$dev_pem"
  chmod 600 "$prod_pem"

  echo "Draftea PEM files set up successfully."
}

# Main execution logic
function main() {
  local section="$1"

  case "$section" in
    "setup_op_accounts")
      setup_op_accounts
      ;;
    "signin_op_accounts")
      signin_op_accounts
      ;;
    "setup_ssh_keys")
      signin_op_accounts
      setup_ssh_keys
      ;;
    "setup_aws_creds")
      signin_op_accounts
      setup_aws_creds
      ;;
    "setup_draftea_pems")
      signin_op_accounts
      setup_draftea_pems
      ;;
    "all_credentials")
      setup_op_accounts
      signin_op_accounts
      setup_ssh_keys
      setup_aws_creds
      setup_draftea_pems
      echo ""
      echo "All credentials and keys have been set up successfully!"
      ;;
    "")
      # No parameter provided - set up everything
      echo "Setting up all credentials..."
      echo ""
      setup_op_accounts
      signin_op_accounts
      setup_ssh_keys
      setup_aws_creds
      setup_draftea_pems
      echo ""
      echo "================================================"
      echo "All credentials and keys have been set up successfully!"
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
