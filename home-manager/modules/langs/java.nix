{ lib, pkgs, ... }:
{
  home.packages = with pkgs; [
    jdk24
    gradle
    maven
  ];

  home.file.".envs/java.sh" = {
    text = ''
      export JAVA_HOME=${pkgs.jdk24}
    '';
  };
}
