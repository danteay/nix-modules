#!/usr/bin/env bash

# Find all package.json files recursively and process each one
fd --glob "**/package.json" --exclude "**/node_modules/**" | while read -r package_file; do
    # Get the absolute directory path of the package.json file
    dir_path=$(dirname "$(realpath "$package_file")")

    echo "Processing $dir_path"

    # Change to the directory
    cd "$dir_path" || exit

    # Run npm-check-updates and npm install
    npx npm-check-updates -u --install always && npm install && npm audit fix

    # Return to original directory
    cd - > /dev/null
done

