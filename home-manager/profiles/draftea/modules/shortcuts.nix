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

      command="env STAGE=dev AWS_ACCOUNT=776658659836 ./node_modules/.bin/sls deploy function -f \"$1\" --stage dev --verbose --aws-profile draftea-dev"

      if ! eval "$command"; then
        echo "Error deploying code for lambda `$1`"
        exit 1
      fi

      command_with_flag="$command --update-config"

      if ! eval "$command_with_flag"; then
        echo "Error deploying new configuration for lambda `$1`"
        exit 1
      fi
    '')

    (writeShellScriptBin "prod-deploy-func" ''
      npm install

      command="env STAGE=prod AWS_ACCOUNT=632258128187 ./node_modules/.bin/sls deploy function -f \"$1\" --stage prod --verbose --aws-profile draftea-prod"

      if ! eval "$command"; then
        echo "Error deploying code for lambda `$1`"
        exit 1
      fi

      command_with_flag="$command --update-config"

      if ! eval "$command_with_flag"; then
        echo "Error deploying new configuration for lambda `$1`"
        exit 1
      fi
    '')

    (writeShellScriptBin "sls-print" ''
      npm install
      env AWS_ACCOUNT=776658659836 npm run print:dev
    '')
  ];
}