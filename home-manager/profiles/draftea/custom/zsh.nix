{ pkgs, ... }:
{
  enableP10K = true;

  zshConfig = {
    shellAliases = {
      myip = "ifconfig en0 | grep inet | grep -v inet6 | awk '{print $2}'";
    };

    initContent = ''
      # localstack
      export LOCALSTACK_AUTH_TOKEN=""
      export ACTIVATE_PRO=0
    '';
  };
}