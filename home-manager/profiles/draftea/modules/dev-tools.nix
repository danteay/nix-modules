{ pkgs, ... }:
{
  home.packages = with pkgs; [
    act
    upx
    ejson
    goimports-reviser
    go-mockery
    awscli2
    pkl
    protoc-gen-go
    protobuf_29

    (import ../../../modules/derivations/go-migrate.nix { inherit pkgs; })
  ];
}
