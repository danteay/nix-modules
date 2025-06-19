{ pkgs, ... }:
{
    home.packages = with pkgs; [
        (writeShellScriptBin "docstop" ''
            if [ -z "$1" ]; then
                # No parameter provided, stop all containers
                docker stop $(docker ps -a -q)
            else
                # Parameter provided, stop specific container
                docker stop "$1"
            fi
        '')
    ];
}