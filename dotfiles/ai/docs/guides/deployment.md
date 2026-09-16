# Deployment Guide

> AWS serverless deployment using Serverless Framework, PKL config, and IaaC principles.

## Core Principles

- **Infrastructure as Code** — every resource defined in version-controlled files; zero click-ops
- **Serverless first** — Lambda + managed services over containers where it fits
- **Containers** — use ECS/Fargate or Docker when Lambda limitations (15min timeout, 10GB memory, no persistent connections) don't fit the workload
- **Least privilege IAM** — each function gets its own role with minimal permissions
- **Immutable deploys** — every deploy is a complete artifact replacement, not an incremental patch

---

## Serverless Framework

### Standard `serverless.yml`

```yaml
service: ${self:custom.serviceName}
frameworkVersion: '3'

plugins:
  - serverless-export-env

custom:
  serviceName: my-service
  stage: ${opt:stage, 'dev'}
  logLevel:
    dev: debug
    prod: info

provider:
  name: aws
  runtime: provided.al2023   # Go custom runtime
  architecture: arm64         # Graviton2 — better price/perf
  region: us-east-2
  stage: ${self:custom.stage}
  logRetentionInDays: 30
  tracing:
    apiGateway: true
    lambda: true
  environment:
    SERVICE_NAME: ${self:service}
    STAGE: ${self:custom.stage}
    LOG_LEVEL: ${self:custom.logLevel.${self:custom.stage}}
  iam:
    role:
      statements: ${file(config/sls/iam.yml):statements}

package:
  individually: true
  patterns:
    - "!**"
    - "!node_modules/**"

functions:
  - ${file(cmd/http/create-order/lambda-config.yml):function}
  - ${file(cmd/http/get-order/lambda-config.yml):function}
  - ${file(cmd/events/order-placed/lambda-config.yml):function}

resources:
  Resources: ${file(config/sls/resources.yml):Resources}
```

### Per-Function Config (`lambda-config.yml`)

```yaml
function:
  create-order:
    handler: cmd/http/create-order/bootstrap
    memorySize: 256
    timeout: 30
    package:
      artifact: dist/create-order.zip
    environment:
      TABLE_NAME: { Ref: OrdersTable }
      TOPIC_ARN: { Ref: OrderEventsTopic }
    events:
      - httpApi:
          path: /v1/orders
          method: POST
          authorizer:
            name: jwtAuthorizer
```

### IAM (`config/sls/iam.yml`)

```yaml
statements:
  - Effect: Allow
    Action:
      - dynamodb:GetItem
      - dynamodb:PutItem
      - dynamodb:UpdateItem
      - dynamodb:DeleteItem
      - dynamodb:Query
    Resource:
      - arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${self:service}-${self:provider.stage}
      - arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${self:service}-${self:provider.stage}/index/*

  - Effect: Allow
    Action:
      - sns:Publish
    Resource:
      - { Ref: OrderEventsTopic }
```

### Resources (`config/sls/resources.yml`)

```yaml
Resources:
  OrdersTable:
    Type: AWS::DynamoDB::Table
    DeletionPolicy: Retain  # ALWAYS retain prod tables
    Properties:
      TableName: ${self:service}-${self:provider.stage}
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: pk, AttributeType: S }
        - { AttributeName: sk, AttributeType: S }
      KeySchema:
        - { AttributeName: pk, KeyType: HASH }
        - { AttributeName: sk, KeyType: RANGE }
      PointInTimeRecoverySpecification:
        PointInTimeRecoveryEnabled: true  # always enable for prod
      SSESpecification:
        SSEEnabled: true

  OrderEventsTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: ${self:service}-order-events-${self:provider.stage}

  OrderEventsQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: ${self:service}-order-events-${self:provider.stage}
      VisibilityTimeout: 180  # must be >= Lambda timeout * 6
      RedrivePolicy:
        deadLetterTargetArn: { "Fn::GetAtt": [OrderEventsDLQ, Arn] }
        maxReceiveCount: 3

  OrderEventsDLQ:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: ${self:service}-order-events-dlq-${self:provider.stage}
      MessageRetentionPeriod: 1209600  # 14 days
```

---

## PKL in Deployment

Evaluate PKL configs as part of the deploy step:

```bash
# In Taskfile.yml deploy target
deploy:dev:
  cmds:
    - pkl eval config/pkl/dev.pkl -f json -o .config.json
    - serverless deploy --stage dev --region us-east-2
```

The evaluated `.config.json` is bundled into the Lambda artifact and read at cold start.

---

## Container Deployments (When Needed)

Use containers when Lambda constraints don't fit:
- Long-running tasks (> 15 min)
- WebSocket servers (persistent connections)
- Services requiring large binaries or runtimes not supported by Lambda

**Preferred:** ECS Fargate (serverless containers — no EC2 management)

```yaml
# Fargate task definition skeleton (via CloudFormation)
TaskDefinition:
  Type: AWS::ECS::TaskDefinition
  Properties:
    RequiresCompatibilities: [FARGATE]
    NetworkMode: awsvpc
    Cpu: 256
    Memory: 512
    ContainerDefinitions:
      - Name: my-service
        Image: !Sub "${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com/my-service:${ImageTag}"
        PortMappings: [{ ContainerPort: 8080 }]
        Environment:
          - { Name: STAGE, Value: !Ref Stage }
        Secrets:
          - { Name: DB_PASSWORD, ValueFrom: !Ref DBPasswordSecret }
```

---

## Multi-Stage Strategy

| Stage | Purpose | Deploy trigger |
|-------|---------|---------------|
| `dev` | Development, fast iteration | Every push to feature branch |
| `staging` | Pre-prod validation, E2E tests | Every push to `main` |
| `prod` | Production | Manual promotion or tag |

---

## Deployment Commands

```bash
# Recommended: Nix shortcuts
dev-deploy              # Deploy all to dev
prod-deploy             # Deploy all to prod
dev-deploy-func <fn>    # Single function to dev

# Serverless CLI
serverless deploy --stage dev
serverless deploy function -f create-order --stage dev
serverless info --stage dev
serverless remove --stage dev   # DANGER: destroys all resources
```

---

## Post-Deploy Verification

After every deploy, run smoke tests:

```bash
task test:smoke STAGE=dev BASE_URL=$(serverless info --stage dev | grep endpoint)
```

---

## Anti-Patterns

| Wrong | Right |
|-------|-------|
| `DeletionPolicy: Delete` on DynamoDB | `DeletionPolicy: Retain` always |
| Wildcard IAM `Resource: "*"` | Scoped ARNs |
| Shared Lambda IAM roles | One role per function |
| Hardcoded ARNs in code | CloudFormation `{ Ref: }` / env vars |
| No DLQ on SQS queues | Always configure DLQ |
| No PITR on DynamoDB | Enable `PointInTimeRecoveryEnabled: true` |
| Click-ops in AWS console | All changes via IaaC |

---

## Cross-References

→ [Architecture Overview](../reference/architecture-overview.md) | [Secrets Management](./secrets-management.md) | [CI/CD](./ci-cd.md)
