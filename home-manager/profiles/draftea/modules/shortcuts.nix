{ pkgs, ... }:
{
  home.packages = with pkgs; [
    (writeShellScriptBin "prod-deploy" ''
      npm install
      env STAGE=prod AWS_ACCOUNT=632258128187 SLS_PARAMS="--aws-profile=draftea-prod" npm run deploy
    '')

    (writeShellScriptBin "dev-deploy" ''
      npm install
      env STAGE=dev AWS_ACCOUNT=776658659836 SLS_PARAMS="--aws-profile=draftea-dev" npm run deploy
    '')

    (writeShellScriptBin "feat-deploy" ''
      npm install
      env STAGE=$1 AWS_ACCOUNT=636385746594 SLS_PARAMS="--aws-profile=draftea-feature --params=\"stage=feature\"" npm run deploy
    '')

    (writeShellScriptBin "dev-deploy-func" ''
      npm install
      env STAGE=dev AWS_ACCOUNT=776658659836 ./node_modules/.bin/sls deploy function -f $1 --stage dev --update-config --verbose --aws-profile draftea-dev
    '')

    (writeShellScriptBin "sls-print" ''
      npm install
      env AWS_ACCOUNT=776658659836 npm run print:dev
    '')
  ];
}