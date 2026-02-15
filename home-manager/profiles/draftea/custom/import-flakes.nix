{
  system
  , draft
  , taskrun
  , modcheck
  , ...
}:
{
  home.packages = [
    draft.packages.${system}.default
    taskrun.packages.${system}.default
    modcheck.packages.${system}.default
  ];
}