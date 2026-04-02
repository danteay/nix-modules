# Testing Guide (Nix)

> Testing Nix expressions, flake checks, home-manager modules, and NixOS module tests.

---

## Overview

Nix testing happens at several levels:

| Level | Tool | What it tests |
|-------|------|---------------|
| Expression evaluation | `nix eval` | Types, values, derivation attrs |
| Flake checks | `nix flake check` | All outputs type-check and build |
| NixOS VM tests | `nixosTest` | Full system behavior in a VM |
| Home-manager | `home-manager switch --dry-run` | Module activation without applying |
| Format | `alejandra --check` / `nixfmt` | Code style |

---

## Flake Checks

Add checks to your flake for CI validation:

```nix
# nix/checks.nix
{ inputs, ... }: {
  perSystem = { pkgs, config, ... }: {
    checks = {
      # Format check
      format = pkgs.runCommand "check-format" {} ''
        cd ${../.}
        ${pkgs.alejandra}/bin/alejandra --check . && touch $out
      '';

      # Build the default package
      build = config.packages.default;

      # Run unit tests (if any Go/Rust code in the flake)
      tests = pkgs.runCommand "run-tests" {
        buildInputs = [ pkgs.go ];
      } ''
        cd ${../.}
        go test ./... && touch $out
      '';
    };
  };
}
```

Run: `nix flake check`

---

## NixOS Module Tests (nixosTest)

```nix
# tests/module-test.nix
{ pkgs, ... }:

pkgs.nixosTest {
  name = "my-service-test";

  nodes.machine = { config, pkgs, ... }: {
    imports = [ ../modules/my-service.nix ];

    services.myService = {
      enable = true;
      port = 8080;
    };
  };

  testScript = ''
    machine.start()
    machine.wait_for_unit("my-service.service")
    machine.wait_for_open_port(8080)

    # Test HTTP response
    result = machine.succeed("curl -sf http://localhost:8080/health")
    assert "ok" in result, f"Expected 'ok' in response, got: {result}"

    # Test service restart
    machine.systemctl("restart my-service")
    machine.wait_for_unit("my-service.service")
  '';
}
```

Add to flake checks:

```nix
checks.module-test = import ./tests/module-test.nix { inherit pkgs; };
```

---

## Home-Manager Module Testing

### Dry-Run Validation

```bash
# Validate config without applying
home-manager switch --dry-run

# Build generation without activating
home-manager build

# Check a specific user config
nix build .#homeConfigurations.danteay.activationPackage
```

### Unit-Style Evaluation Tests

```nix
# tests/hm-options-test.nix
{ pkgs, lib, home-manager, ... }:

let
  evalHmConfig = modules: (home-manager.lib.homeManagerConfiguration {
    inherit pkgs;
    modules = modules ++ [{
      home.username = "testuser";
      home.homeDirectory = "/home/testuser";
      home.stateVersion = "25.05";
    }];
  }).config;

  testConfig = evalHmConfig [
    ../modules/my-tool.nix
    { programs.myTool.enable = true; }
  ];

in pkgs.runCommand "hm-options-test" {} ''
  # Check that the package is installed
  ${lib.optionalString (!builtins.elem pkgs.myTool testConfig.home.packages)
    "echo 'FAIL: myTool not in home.packages' && exit 1"}

  echo "PASS: all home-manager option tests passed"
  touch $out
''
```

---

## Expression Evaluation Tests

```nix
# tests/lib-test.nix — test pure Nix functions
{ pkgs, lib, ... }:

let
  myLib = import ../lib/default.nix { inherit lib; };

  tests = {
    "listDirModules returns nix files" =
      builtins.length (myLib.listDirModules ./fixtures/modules) == 3;

    "listDirModules skips .skip.nix files" =
      builtins.all
        (p: !(lib.hasSuffix ".skip.nix" p))
        (myLib.listDirModules ./fixtures/modules);

    "makeModule preserves name" =
      (myLib.makeModule { name = "test"; }).name == "test";
  };

  failedTests = lib.filterAttrs (_name: result: !result) tests;

in pkgs.runCommand "lib-tests" {} ''
  ${lib.optionalString (failedTests != {})
    "echo 'FAILED tests:'; echo '${builtins.toJSON (lib.attrNames failedTests)}'; exit 1"}
  echo "All ${toString (builtins.length (lib.attrNames tests))} tests passed"
  touch $out
''
```

---

## Linting and Formatting

```bash
# Format check (CI)
alejandra --check .

# Format in-place
alejandra .

# Alternative formatter
nixfmt --check flake.nix
nixfmt flake.nix

# Linting with statix
statix check .
statix fix .

# Dead code detection with deadnix
deadnix --fail .
deadnix --edit .
```

Integrate into flake checks:

```nix
checks.lint = pkgs.runCommand "nix-lint" {} ''
  ${pkgs.statix}/bin/statix check ${../.} && touch $out
'';

checks.deadcode = pkgs.runCommand "deadnix" {} ''
  ${pkgs.deadnix}/bin/deadnix --fail ${../.} && touch $out
'';
```

---

## CI Pipeline

```yaml
# .github/workflows/nix.yml
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: DeterminateSystems/nix-installer-action@v14
      - uses: DeterminateSystems/magic-nix-cache-action@v8

      - name: Check flake
        run: nix flake check --all-systems

      - name: Build default package
        run: nix build

      - name: Check formatting
        run: nix run nixpkgs#alejandra -- --check .
```

---

## Common Test Patterns

### Assert a File is Generated

```nix
testScript = ''
  machine.start()
  machine.wait_for_unit("multi-user.target")

  # Assert config file exists
  machine.succeed("test -f /etc/my-service/config.toml")

  # Assert file content
  content = machine.succeed("cat /etc/my-service/config.toml")
  assert "port = 8080" in content
'';
```

### Test Service is Enabled and Running

```nix
testScript = ''
  machine.start()
  machine.wait_for_unit("my-service.service")
  machine.succeed("systemctl is-active my-service.service")
  machine.succeed("systemctl is-enabled my-service.service")
'';
```

---

## Cross-References

→ [Conventions (Nix)](../../conventions/nix/index.md) | [Nix Code Patterns](../../patterns/nix/code.md) | [Dev Environment Guide](../../guides/dev-environment.md)
