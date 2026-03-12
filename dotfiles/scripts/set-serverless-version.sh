#!/usr/bin/env bash

# Find all package.json files recursively and process each one
fd --glob "**/package.json" --exclude "**/node_modules/**" | while read -r package_file; do
    # Get the absolute directory path of the package.json file
    dir_path=$(dirname "$(realpath "$package_file")")

    echo "Processing $dir_path"

    # Change to the directory
    cd "$dir_path" || exit

    # Install latest serverless v3
    npm install --save-dev serverless@^3

    # Return to original directory
    cd - > /dev/null
done
