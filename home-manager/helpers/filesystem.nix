{
  # listDirModules: path -> list of path
  # Returns all *.nix files in the given directory, excluding *.skip.nix.
  # Returns [] if the directory does not exist or cannot be read.
  listDirModules = path:
    if builtins.pathExists path then
      let
        dirContents = builtins.tryEval (builtins.readDir path);
      in
      if dirContents.success then
        let
          files = builtins.attrNames dirContents.value;
          nixFiles = builtins.filter (name:
            builtins.match ".*\\.nix" name != null &&
            !(builtins.match ".*\\.skip\\.nix" name != null)
          ) files;
        in
        builtins.map (file: path + "/${file}") nixFiles
      else
        []
    else
      [];

  # listProfiles: path -> list of path
  # Returns all subdirectories of the given path.
  # Returns [] if the directory does not exist or cannot be read.
  listProfiles = path:
    if builtins.pathExists path then
      let
        dirContents = builtins.tryEval (builtins.readDir path);
      in
      if dirContents.success then
        let
          items = builtins.attrNames dirContents.value;
          directories = builtins.filter (name:
            let
              itemPath = path + "/${name}";
              pathType = builtins.tryEval (builtins.readFileType itemPath);
            in
            pathType.success && pathType.value == "directory"
          ) items;
        in
        builtins.map (file: path + "/${file}") directories
      else
        []
    else
      [];
}
