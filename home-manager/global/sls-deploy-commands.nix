{ pkgs, ... }:
let
  checkDeployIgnore = ''
    if [ -f ".deployignore" ]; then
      echo "Deploy ignorado: archivo .deployignore encontrado en el directorio actual"
      exit 0
    fi
  '';
  deployLambdaFunction = builtins.readFile ./../../dotfiles/scripts/sls-deploy-lambda-function.sh;
  deployService = builtins.readFile ./../../dotfiles/scripts/sls-deploy-service.sh;
in
{
  home.packages = with pkgs; [
    (writeShellScriptBin "deploy-svc" ''${deployService}'')

    (writeShellScriptBin "prod-deploy" ''
      ${checkDeployIgnore}
      DEPLOY_SVC_WRAPPER=true deploy-svc --stage prod --profile draftea-prod --region us-east-2
    '')

    (writeShellScriptBin "dev-deploy" ''
      ${checkDeployIgnore}
      DEPLOY_SVC_WRAPPER=true deploy-svc --stage dev --profile draftea-dev --region us-east-2
    '')

    (writeShellScriptBin "feat-deploy" ''
      DEPLOY_SVC_WRAPPER=true deploy-svc --stage $1 --profile draftea-feature --region us-east-2
    '')

    (writeShellScriptBin "deploy-func" ''${deployLambdaFunction}'')

    (writeShellScriptBin "dev-deploy-func" ''
      ${checkDeployIgnore}
      DEPLOY_FUNC_WRAPPER=true deploy-func $1 --stage dev --profile draftea-dev --region us-east-2
    '')

    (writeShellScriptBin "feat-deploy-func" ''
      ${checkDeployIgnore}
      DEPLOY_FUNC_WRAPPER=true deploy-func $1 --stage feature --profile draftea-feature --region us-east-2
    '')
  ];
}