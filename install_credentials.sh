#!/usr/bin/env bash

# Create .ssh folder
if [ ! -d "$HOME/.ssh" ]; then
  mkdir -p "$HOME/.ssh"
fi

echo "Setting up SSH github certs"

# Download github ssh keys
op document get ssh-github --vault Development --account my.1password.com --output "$HOME/.ssh/github"
op document get ssh-github-pub --vault Development --account my.1password.com --output "$HOME/.ssh/github.pub"

# Set proper permissions for github certs
chmod 600 "$HOME/.ssh/github"
chmod 600 "$HOME/.ssh/github.pub"

# Create .aws directory if it doesn't exist
if [ ! -d "$HOME/.aws" ]; then
  mkdir -p "$HOME/.aws"
fi

# Install credentials file
echo "Settingup AWS configuration files..."
op document get aws-config --vault Development --account my.1password.com --output "$HOME/.aws/config"
op document get aws-credentials --vault Development --account my.1password.com --output "$HOME/.aws/credentials"

echo "Setting up Draftea Pems..."

# Create .draftea/pems directory if it doesn't exist
if [ ! -d "$HOME/.draftea/pems" ]; then
  mkdir -p "$HOME/.draftea/pems"
fi

# Download the PEM file from 1Password using the content_path
op document get "Key Bastion DEV" --vault Engineering --account draftea.1password.com --output "$HOME/.draftea/pems/dev-bastion.pem"
op document get "Key Bastion PROD" --vault Engineering --account draftea.1password.com --output "$HOME/.draftea/pems/prod-bastion.pem"

# Set proper permissions for the PEM file (SSH keys should be readable only by owner)
chmod 600 "$HOME/.draftea/pems/dev-bastion.pem"
chmod 600 "$HOME/.draftea/pems/prod-bastion.pem"

echo "All credentials and keys have been set up successfully!"