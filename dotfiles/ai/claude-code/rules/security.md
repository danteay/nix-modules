# Security Rules

## Secrets Management

- Never commit secrets, API keys, or passwords to version control
- Use environment variables for sensitive configuration
- Leverage 1Password, sops-nix, or similar for secret management
- Rotate credentials regularly
- Use unique credentials per environment

## Code Security

- Validate and sanitize all user inputs
- Use parameterized queries to prevent SQL injection
- Implement proper authentication and authorization
- Keep dependencies updated and scan for vulnerabilities
- Follow OWASP security best practices

## Infrastructure Security

- Apply principle of least privilege for IAM roles
- Enable encryption at rest and in transit
- Implement network segmentation and firewalls
- Enable audit logging for all infrastructure
- Use security groups and network policies restrictively

## Development Practices

- Review security implications of code changes
- Run security scanners in CI/CD pipelines
- Never disable SSL/TLS verification in production
- Implement rate limiting and DDOS protection
- Keep security-sensitive dependencies minimal
