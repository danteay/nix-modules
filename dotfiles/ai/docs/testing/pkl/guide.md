# Testing Guide (PKL)

> Validating PKL schemas, testing amend chains, CI evaluation, and generated output testing.

---

## Overview

PKL testing focuses on three areas:

| Goal | Approach |
|------|----------|
| Schema validity | `pkl eval` succeeds without error |
| Constraint enforcement | `pkl eval` fails as expected on invalid input |
| Output correctness | Compare rendered JSON/YAML to expected snapshots |

PKL does not have a built-in unit test framework — validation is done via eval and output comparison.

---

## Basic Validation

```bash
# Validate a single file (fails with non-zero exit on error)
pkl eval config/prod.pkl

# Validate all config files
pkl eval config/*.pkl

# Validate and render to JSON (check output + type correctness)
pkl eval --format json config/prod.pkl > /dev/null

# Dry run (parse and type-check only, no output)
pkl eval config/prod.pkl --dry-run
```

---

## Constraint Violation Testing

Verify that invalid configs are rejected. Use in CI to ensure schema enforcement:

```bash
#!/usr/bin/env bash
# scripts/test-pkl-validation.sh

set -euo pipefail

assert_fails() {
  local file="$1"
  local description="$2"
  if pkl eval "$file" 2>/dev/null; then
    echo "FAIL: expected '$description' to fail validation, but it passed"
    exit 1
  else
    echo "PASS: '$description' correctly rejected"
  fi
}

assert_passes() {
  local file="$1"
  local description="$2"
  if pkl eval "$file" > /dev/null 2>&1; then
    echo "PASS: '$description' is valid"
  else
    echo "FAIL: '$description' failed unexpectedly"
    pkl eval "$file"
    exit 1
  fi
}

# Valid configs
assert_passes "config/dev.pkl"    "dev config"
assert_passes "config/prod.pkl"   "prod config"

# Invalid configs (should fail)
assert_fails "tests/fixtures/invalid-port.pkl"    "port out of range"
assert_fails "tests/fixtures/missing-required.pkl" "missing required field"
assert_fails "tests/fixtures/bad-url.pkl"          "invalid URL format"
```

---

## Test Fixtures for Invalid Configs

```pkl
// tests/fixtures/invalid-port.pkl
amends "../../config/base.pkl"

http {
  port = 80  // violates Int(isBetween(1024, 65535))
}
```

```pkl
// tests/fixtures/missing-required.pkl
amends "../../config/base.pkl"

// Intentionally omit `name` — a required field
env = "dev"
```

```pkl
// tests/fixtures/bad-url.pkl
amends "../../config/base.pkl"

queue {
  url = "not-a-url"   // violates String(startsWith("https://"))
  dlqUrl = "also-not-a-url"
}
```

---

## Snapshot Testing

Generate expected output and diff against it in CI:

```bash
#!/usr/bin/env bash
# scripts/update-snapshots.sh
# Run this to regenerate expected output files

pkl eval --format json config/dev.pkl  -o tests/snapshots/dev.json
pkl eval --format json config/prod.pkl -o tests/snapshots/prod.json
```

```bash
#!/usr/bin/env bash
# scripts/test-pkl-snapshots.sh
set -euo pipefail

TEMP=$(mktemp -d)
trap "rm -rf $TEMP" EXIT

pkl eval --format json config/dev.pkl  -o "$TEMP/dev.json"
pkl eval --format json config/prod.pkl -o "$TEMP/prod.json"

diff tests/snapshots/dev.json  "$TEMP/dev.json"  || { echo "FAIL: dev snapshot mismatch";  exit 1; }
diff tests/snapshots/prod.json "$TEMP/prod.json" || { echo "FAIL: prod snapshot mismatch"; exit 1; }

echo "All PKL snapshot tests passed"
```

---

## Nix-Based PKL Checks

When using Nix, add PKL validation as a flake check:

```nix
# nix/checks.nix
{ pkgs, ... }: {
  perSystem = { ... }: {
    checks.pkl-validation = pkgs.runCommand "pkl-validation" {
      buildInputs = [ pkgs.pkl ];
    } ''
      cd ${../.}

      # Validate all configs
      pkl eval config/dev.pkl config/prod.pkl

      # Test constraint violations
      for fixture in tests/fixtures/invalid-*.pkl; do
        if pkl eval "$fixture" 2>/dev/null; then
          echo "FAIL: $fixture should have failed validation"
          exit 1
        fi
      done

      touch $out
    '';

    checks.pkl-snapshots = pkgs.runCommand "pkl-snapshots" {
      buildInputs = [ pkgs.pkl pkgs.diffutils ];
    } ''
      cd ${../.}
      pkl eval --format json config/dev.pkl  -o /tmp/dev.json
      pkl eval --format json config/prod.pkl -o /tmp/prod.json

      diff tests/snapshots/dev.json  /tmp/dev.json  || { echo "dev snapshot mismatch";  exit 1; }
      diff tests/snapshots/prod.json /tmp/prod.json || { echo "prod snapshot mismatch"; exit 1; }

      touch $out
    '';
  };
}
```

---

## CI Integration

```yaml
# .github/workflows/pkl.yml
name: PKL Validation

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install PKL
        run: |
          curl -sL https://github.com/apple/pkl/releases/latest/download/pkl-linux-amd64 \
            -o /usr/local/bin/pkl
          chmod +x /usr/local/bin/pkl

      - name: Validate configs
        run: pkl eval config/*.pkl

      - name: Test constraint violations
        run: bash scripts/test-pkl-validation.sh

      - name: Test snapshots
        run: bash scripts/test-pkl-snapshots.sh
```

With Nix:

```yaml
- name: Run flake checks (includes PKL)
  run: nix flake check
```

---

## Updating Snapshots in CI (PR workflow)

```yaml
- name: Generate snapshots
  run: bash scripts/update-snapshots.sh

- name: Check for snapshot drift
  run: |
    if ! git diff --quiet tests/snapshots/; then
      echo "PKL snapshots are out of date. Run scripts/update-snapshots.sh"
      git diff tests/snapshots/
      exit 1
    fi
```

---

## PKL Version Pinning

Pin the PKL version in your project:

```bash
# .pkl-version (or specify in Nix)
0.27.0
```

```nix
# In a flake dev shell
pkgs.pkl  # from nixpkgs — pinned to flake.lock
```

---

## Cross-References

→ [Conventions (PKL)](../../conventions/pkl/index.md) | [PKL Code Patterns](../../patterns/pkl/code.md) | [Configuration Reference](../../reference/configuration.md)
