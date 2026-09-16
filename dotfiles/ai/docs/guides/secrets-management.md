# Secrets Management

> ejson for secrets at rest + AWS Secrets Manager for runtime injection.

## Golden Rules

1. **Never commit plaintext secrets** — not in code, not in env files, not in YAML
2. **ejson encrypts secrets for version control** — safe to commit `.ejson` files
3. **AWS Secrets Manager injects secrets at runtime** — Lambda reads from SecretsManager, not filesystem
4. **Rotate secrets without code changes** — Lambda cold start always fetches latest version

---

## ejson (Secrets at Rest)

ejson uses public-key cryptography to encrypt secret values. The public key is committed; the private key lives only in your secure environment (CI, developer machines with 1Password).

### Setup

```bash
# Generate keypair
ejson keygen
# Outputs:
# Public Key: abc123...
# Private Key: xyz789...   ← store in 1Password / CI secrets, never commit
```

### File Format

```json
{
  "_public_key": "abc123...",
  "DB_PASSWORD": "EJ[1:EncryptedValue...]",
  "API_KEY": "EJ[1:EncryptedValue...]",
  "STRIPE_SECRET": "EJ[1:EncryptedValue...]"
}
```

### Workflow

```bash
# Create new secrets file (write plaintext first)
cat > secrets/dev.ejson <<EOF
{
  "_public_key": "abc123...",
  "DB_PASSWORD": "mypassword123",
  "API_KEY": "sk-dev-abc"
}
EOF

# Encrypt (safe to commit after this)
ejson encrypt secrets/dev.ejson

# Decrypt for local use (requires private key in EJSON_KEYDIR)
export EJSON_KEYDIR=~/.ejson/keys
ejson decrypt secrets/dev.ejson

# Decrypt inline
ejson decrypt secrets/dev.ejson | jq '.DB_PASSWORD'
```

### Key Storage

```bash
# Store private key in ~/.ejson/keys/{public-key}
mkdir -p ~/.ejson/keys
echo "xyz789..." > ~/.ejson/keys/abc123...
chmod 600 ~/.ejson/keys/abc123...
```

In CI: inject private key as a CI secret and write to `$EJSON_KEYDIR` before deploy.

### Adding a New Secret

```bash
# 1. Decrypt existing file
ejson decrypt secrets/dev.ejson > /tmp/dev-secrets.json

# 2. Add new plaintext value to decrypted file
# 3. Re-encrypt
ejson encrypt /tmp/dev-secrets.json > secrets/dev.ejson
rm /tmp/dev-secrets.json  # clean up plaintext
```

---

## AWS Secrets Manager (Runtime Injection)

For Lambda functions, use AWS Secrets Manager to inject secrets at cold start.

### Creating a Secret

```bash
# From ejson-decrypted values
aws secretsmanager create-secret \
  --name "myservice/dev/db-password" \
  --secret-string "$(ejson decrypt secrets/dev.ejson | jq -r '.DB_PASSWORD')"
```

### CloudFormation Resource

```yaml
# config/sls/resources.yml
DatabaseSecret:
  Type: AWS::SecretsManager::Secret
  Properties:
    Name: ${self:service}/${self:provider.stage}/db-password
    Description: Database password for ${self:service}
```

### Lambda IAM Permission

```yaml
# config/sls/iam.yml
- Effect: Allow
  Action:
    - secretsmanager:GetSecretValue
  Resource:
    - arn:aws:secretsmanager:${aws:region}:${aws:accountId}:secret:${self:service}/${self:provider.stage}/*
```

### Reading at Cold Start (Go)

```go
func loadSecret(ctx context.Context, secretARN string) (string, error) {
    client := secretsmanager.NewFromConfig(awsCfg)
    result, err := client.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
        SecretId: aws.String(secretARN),
    })
    if err != nil {
        return "", fmt.Errorf("get secret %s: %w", secretARN, err)
    }
    return aws.ToString(result.SecretString), nil
}
```

Cache the value for the Lambda's lifetime (cold start only, not per-invocation):

```go
var (
    dbPassword     string
    dbPasswordOnce sync.Once
)

func getDBPassword(ctx context.Context) string {
    dbPasswordOnce.Do(func() {
        var err error
        dbPassword, err = loadSecret(ctx, os.Getenv("DB_PASSWORD_ARN"))
        if err != nil { log.Fatal("load secret:", err) }
    })
    return dbPassword
}
```

### Lambda Environment Variable (ARN reference)

```yaml
# lambda-config.yml
environment:
  DB_PASSWORD_ARN: { Ref: DatabaseSecret }
```

---

## Secret Rotation

Use AWS Secrets Manager automatic rotation for database credentials:

```yaml
DatabaseSecretRotation:
  Type: AWS::SecretsManager::RotationSchedule
  Properties:
    SecretId: { Ref: DatabaseSecret }
    RotationLambdaARN: !Sub "arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:SecretsManagerRotation"
    RotationRules:
      AutomaticallyAfterDays: 30
```

---

## `.gitignore` Rules

```gitignore
# Never commit plaintext
.env
.env.*
!.env.example
*.pem
*.key
secrets/*.json   # if ever decrypted to JSON locally

# ejson encrypted files ARE safe to commit
# secrets/*.ejson  ← do NOT gitignore these
```

---

## Cross-References

→ [Configuration Reference](../reference/configuration.md) | [Deployment Guide](./deployment.md) | [PKL Conventions](../conventions/pkl.md)
