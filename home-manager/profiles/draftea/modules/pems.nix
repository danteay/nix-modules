{ pkgs, ... }:
let
  dotfilesPath = ../../../dotfiles;

  fileExists = path: builtins.pathExists path;

  createFileIfExists = name: sourcePath:
    if fileExists sourcePath
    then { "${name}".source = sourcePath; }
    else { };

  filesToCreate = [
    { name = ".draftea/pems/dev-bastion.pem"; source = "${dotfilesPath}/draftea/pems/dev-bastion.pem"; }
    { name = ".draftea/pems/prod-bastion.pem"; source = "${dotfilesPath}/draftea/pems/prod-bastion.pem"; }
  ];

  createdFiles = builtins.foldl' (acc: file: acc // createFileIfExists file.name file.source) { } filesToCreate;
in
{
  home.file = {
    ".envs/draftea-aliases.sh".text = ''
      alias prod-bastion="ssh -i ~/.draftea/pems/prod-bastion.pem ubuntu@ec2-3-140-150-23.us-east-2.compute.amazonaws.com"
      alias dev-bastion="ssh -i ~/.draftea/pems/dev-bastion.pem ubuntu@ec2-18-223-167-16.us-east-2.compute.amazonaws.com"
    '';
  } // createdFiles;
}
