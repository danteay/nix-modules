{ pkgs, ... }:
{
  home.packages = with pkgs; [
    libyaml
  ];

  home.file.".envs/libyaml-vars.sh" = with pkgs; {
    text = ''
      export LIB_YAML_DEV=${libyaml.dev}
      export LIB_YAML_HOME=${libyaml}
      export LIB_YAML_SOURCE=${libyaml.src}
    '';
  };
}
