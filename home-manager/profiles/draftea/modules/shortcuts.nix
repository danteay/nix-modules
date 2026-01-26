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

    (writeShellScriptBin "deploy" ''
      if [ $# -lt 2 ]; then
        echo "Usage: deploy <stage> <aws-profile>"
        echo "Example: deploy dev draftea-dev"
        exit 1
      fi

      STAGE="$1"
      AWS_PROFILE="$2"

      echo "Getting AWS account ID for profile: $AWS_PROFILE"
      AWS_ACCOUNT=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)

      if [ -z "$AWS_ACCOUNT" ]; then
        echo "Error: Failed to get AWS account ID for profile $AWS_PROFILE"
        exit 1
      fi

      echo "Deploying to stage: $STAGE, AWS Account: $AWS_ACCOUNT"
      npm install
      env STAGE="$STAGE" AWS_ACCOUNT="$AWS_ACCOUNT" SLS_PARAMS="--aws-profile=$AWS_PROFILE" npm run deploy
    '')

    (writeShellScriptBin "deploy-func" ''
      if [ $# -lt 3 ]; then
        echo "Usage: deploy-func <function-name> <stage> <aws-profile>"
        echo "Example: deploy-func myFunction dev draftea-dev"
        exit 1
      fi

      FUNCTION_NAME="$1"
      STAGE="$2"
      AWS_PROFILE="$3"

      echo "Getting AWS account ID for profile: $AWS_PROFILE"
      AWS_ACCOUNT=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)

      if [ -z "$AWS_ACCOUNT" ]; then
        echo "Error: Failed to get AWS account ID for profile $AWS_PROFILE"
        exit 1
      fi

      echo "Deploying function: $FUNCTION_NAME to stage: $STAGE, AWS Account: $AWS_ACCOUNT"
      npm install

      command="env STAGE=$STAGE AWS_ACCOUNT=$AWS_ACCOUNT ./node_modules/.bin/sls deploy function -f \"$FUNCTION_NAME\" --stage $STAGE --verbose --aws-profile $AWS_PROFILE"

      if ! eval "$command"; then
        echo "Error deploying code for lambda $FUNCTION_NAME"
        exit 1
      fi

      command_with_flag="$command --update-config"

      if ! eval "$command_with_flag"; then
        echo "Error deploying new configuration for lambda $FUNCTION_NAME"
        exit 1
      fi

      echo "Successfully deployed function: $FUNCTION_NAME"
    '')
  ];
}