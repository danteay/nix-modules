{ pkgs, lib, ... }:

let
  version = "1.26.3";

  # Replace each `lib.fakeHash` with the real SRI hash printed by the first
  # failed build attempt (`hms`). Hashes are platform-specific because we
  # download the official prebuilt tarball from https://go.dev/dl/.
  platforms = {
    "aarch64-darwin" = {
      suffix = "darwin-arm64";
      hash = lib.fakeHash;
    };
    "x86_64-darwin" = {
      suffix = "darwin-amd64";
      hash = lib.fakeHash;
    };
    "aarch64-linux" = {
      suffix = "linux-arm64";
      hash = lib.fakeHash;
    };
    "x86_64-linux" = {
      suffix = "linux-amd64";
      hash = lib.fakeHash;
    };
  };

  system = pkgs.stdenv.hostPlatform.system;
  platform = platforms.${system}
    or (throw "go.nix: unsupported system ${system}");
in
pkgs.stdenvNoCC.mkDerivation {
  pname = "go";
  inherit version;

  src = pkgs.fetchurl {
    url = "https://go.dev/dl/go${version}.${platform.suffix}.tar.gz";
    hash = platform.hash;
  };

  dontConfigure = true;
  dontBuild = true;
  dontPatchShebangs = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/go
    cp -R . $out/share/go/

    mkdir -p $out/bin
    for bin in go gofmt; do
      ln -s $out/share/go/bin/$bin $out/bin/$bin
    done

    runHook postInstall
  '';

  meta = with lib; {
    description = "The Go programming language (pinned official binary release)";
    homepage = "https://go.dev";
    license = licenses.bsd3;
    platforms = builtins.attrNames platforms;
  };
}
