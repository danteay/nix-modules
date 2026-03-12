#!/usr/local/env bash

# Check if at least one argument is provided
if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <repository-url> [target-folder]"
  exit 1
fi

REPO_URL="$1"
TARGET_FOLDER="$2"

# Extract the repository name from the URL if no target folder is provided
if [ -z "$TARGET_FOLDER" ]; then
  TARGET_FOLDER=$(basename "$REPO_URL" .git)
fi

# Clone the repository
if git clone "$REPO_URL" "$TARGET_FOLDER"; then
  echo "Repository cloned into $TARGET_FOLDER."
else
  echo "Failed to clone the repository."
  exit 1
fi

# Navigate to the cloned repository folder
cd "$TARGET_FOLDER" || { echo "Failed to enter the directory $TARGET_FOLDER."; exit 1; }

# Check if .husky folder exists and execute husky install
if [ -d ".husky" ]; then
  echo "Detected .husky folder. Running 'husky install'."
  if husky install; then
    echo "Husky installed successfully."
  else
    echo "Failed to run 'husky install'."
    exit 1
  fi
elif [ -f ".pre-commit.yaml" ] then;
  echo "Detected .pre-commit.yaml file. Running 'pre-commit install'."
  if pre-commit install; then
    echo "Pre-commit hooks installed successfully."
  else
    echo "Failed to run 'pre-commit install'."
    exit 1
  fi
else
  echo "No .husky folder or .pre-commit.yaml file found. Skipping hook installation."
fi

