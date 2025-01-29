{ pkgs, ... }:
{
  home.packages = with pkgs; [
    (writeShellScriptBin "deploy-func" ''
        env FUNCTION_NAME=$1 STAGE=dev AWS_ACCOUNT=776658659836 SLS_PARAMS="--aws-profile=draftea-dev" npm run deploy:function
    '')

    (writeShellScriptBin "sls-update-plugins" ''
      npx npm-check-updates '/serverless-.*/' -u && npm install
    '')
  ];
}