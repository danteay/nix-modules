# CI/CD Guide

> Pipeline design, stage gates, and best practices for continuous integration and deployment.

## Principles

- **Every commit is potentially deployable** — CI must validate this
- **Fast feedback** — lint and tests should complete in < 5 minutes for feature branches
- **Fail fast** — cheapest checks first (lint → unit → integration → e2e)
- **Immutable artifacts** — build once, promote the same artifact across stages
- **No click-ops** — all deployments via pipeline; no manual `sls deploy` to prod
- **Secrets from CI vault** — never hardcode secrets in pipeline files

---

## Pipeline Stages

```
Push → Lint & Format → Unit Tests → Build → Integration Tests → Deploy Dev → Smoke Tests
                                                                                   │
                                                                     (on main only)
                                                                                   ↓
                                                           Deploy Staging → E2E Tests
                                                                                   │
                                                                    (manual approval)
                                                                                   ↓
                                                                   Deploy Prod → Smoke Tests
```

---

## AWS OIDC Authentication (No Long-Lived Keys)

**Never** use static AWS access keys in CI. Use OIDC for temporary credentials:

```yaml
# In GitHub Actions
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::123456789:role/github-deploy-role
    aws-region: us-east-2
```

IAM trust policy for the role:
```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::123456789:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:sub": "repo:org/repo:environment:prod"
    }
  }
}
```

---

## ejson in CI

```yaml
- name: Decrypt secrets
  run: |
    mkdir -p ~/.ejson/keys
    echo "${{ secrets.EJSON_PRIVATE_KEY }}" > ~/.ejson/keys/${{ secrets.EJSON_PUBLIC_KEY }}
    chmod 600 ~/.ejson/keys/${{ secrets.EJSON_PUBLIC_KEY }}
    ejson decrypt secrets/${STAGE}.ejson | jq -r 'to_entries[] | "export \(.key)=\(.value)"' >> $GITHUB_ENV
```

---

## Branch Strategy

| Branch | Purpose | Deploy to |
|--------|---------|-----------|
| `feat/` | Feature development | Nothing (CI only) |
| `fix/` | Bug fixes | Nothing (CI only) |
| `main` | Stable, production-ready | dev → staging → prod |

**Protect `main`:** require PR + CI pass + 1 reviewer approval.

---

## Nix in CI

Use deterministic CI by running commands inside `nix develop`:

```yaml
# Reproducible: uses exact same tool versions as developers
- run: nix develop --command golangci-lint run ./...
- run: nix develop --command go test ./...
```

Cache the Nix store with `DeterminateSystems/magic-nix-cache-action` to avoid rebuilding on every run.

---

## Coverage Gates

Fail CI if coverage drops below threshold:

```yaml
- name: Check coverage
  run: |
    coverage=$(nix develop --command go tool cover -func=coverage.out | awk '/total:/ {print $3}' | tr -d '%')
    if (( $(echo "$coverage < 80" | bc -l) )); then
      echo "Coverage ${coverage}% is below 80% threshold"
      exit 1
    fi
```

---

## Cross-References

→ [Deployment Guide](./deployment.md) | [Secrets Management](./secrets-management.md) | [Testing Strategies](../testing/general/strategies.md)
