{ pkgs, ... }:
{
  home.packages = with pkgs; [
    (writeShellScriptBin "dev-bastion" ''
      aws ssm start-session --target i-0b82a7a6418fbbf10 --profile draftea-dev --region us-east-2

    '')

    (writeShellScriptBin "prod-bastion" ''
      aws ssm start-session --target i-03a6fae1cef1ae877 --profile draftea-prod --region us-east-2
    '')
  ];
}