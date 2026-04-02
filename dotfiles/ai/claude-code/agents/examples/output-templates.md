# Output Templates

> Standard output formats for different agent types. Load on-demand when structured output is needed.

## Developer Implementation Output

```markdown
## Implementation: [Feature Name]

### Overview
[Brief description]

### Affected Layers
- **Domain Models** (`go/domains/{domain}/domain/models.go`)
- **Repository** (`go/domains/{domain}/repository/`)
- **Service** (`go/domains/{domain}/service/`)
- **Handler** (`go/services/{service}/cmd/{type}/{endpoint}/`)

### Implementation
[Code for each layer with comments]

### Tests
[Unit, integration, handler tests]

### Checklist
- [ ] All tests pass (`task test`)
- [ ] Linters pass (`task lint`)
- [ ] Format code (`task format`)
- [ ] Mocks generated (`draft mockery --staged`)
```

## Architect Design Output

```markdown
## Architecture: [Feature Name]

### Problem Analysis
[What challenge are we solving?]

### Proposed Solution
[High-level design]

### Layer Breakdown
- **Handler**: [Responsibilities]
- **Worker**: [Responsibilities]
- **UseCase**: [Responsibilities]
- **Service**: [Responsibilities]
- **Repository**: [Responsibilities]

### Event Flow
[Diagram or description]

### Database Strategy
[Which databases, why, access patterns]

### Trade-offs
**Pros:** [Benefits]
**Cons:** [Limitations]
**Risks:** [Potential issues]

### Implementation Plan
1. [Step 1]
2. [Step 2]
```

## Code Review Output

```markdown
## PR Review Summary

**Overall:** [APPROVE / REQUEST CHANGES / COMMENT]

### Critical Issues (🔴)
1. [Issue with file:line and fix]

### Suggestions (🟡)
1. [Suggestion with rationale]

### Good Practices (🟢)
1. [Highlight quality work]

### Checklist Results
- ✅ Architecture compliance
- ❌ Testing patterns (issues found)
```

## Tester Test Plan Output

```markdown
## Test Plan: [Feature/Component]

### Test Strategy
[Unit/Integration/Handler and why]

### Test Scenarios

#### Happy Path
1. [Scenario]: [Expected result]

#### Error Path
1. [Scenario]: [Expected error]

#### Edge Cases
1. [Scenario]: [Expected behavior]

### Implementation
[Test code examples]

### Coverage
- Expected: [XX%]
- Critical paths: 100%
```

## Debugger Analysis Output

```markdown
## Bug Analysis: [Issue Summary]

### Problem Statement
[Description of the bug]

### Investigation Findings
**Log Analysis:** [What logs reveal]
**Trace Analysis:** [What OpenTelemetry traces show]
**Code Analysis:** [Relevant code inspection]

### Root Cause
[Clear explanation]

### Proposed Fix
**Immediate:** [Code changes]
**Prevention:** [How to prevent recurrence]

### Testing Plan
1. [Verify locally]
2. [Verify in dev]
```

## Refactorer Plan Output

```markdown
## Refactoring Plan: [Code Component]

### Current Issues
- [Code smell 1]
- [Code smell 2]

### Proposed Refactoring

#### Step 1: [Name]
**Before:**
\`\`\`go
// Current code
\`\`\`

**After:**
\`\`\`go
// Refactored code
\`\`\`

**Benefits:** [Improvements]

### Checklist
- [ ] Tests exist and pass
- [ ] Linters pass
- [ ] Coverage maintained
```

## DevOps Infrastructure Output

```markdown
## Infrastructure: [Feature Name]

### Resources
- **Lambda:** `{service}-{stage}-{function}`
- **DynamoDB:** `{table}-{stage}`
- **SQS:** `{queue}[Dead]-{stage}`

### IAM Permissions
\`\`\`yaml
[IAM policy]
\`\`\`

### Deployment
\`\`\`bash
dev-deploy
dev-deploy-func
\`\`\`
```
