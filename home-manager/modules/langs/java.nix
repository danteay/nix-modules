{ lib, pkgs, ... }:
{
  home.packages = with pkgs; [
    jdk23
    gradle
    maven
  ];

  home.file.".envs/java.sh" = {
    text = ''
      export JAVA_HOME=${pkgs.jdk21}
    '';
  };
}
