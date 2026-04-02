# DevOps Infrastructure Examples

> Complete infrastructure examples for AWS Serverless deployments. Load on-demand when creating infrastructure.

## Example 1: SQS

```yaml
service: order-processing

functions:
  
  process-order:
    handler: cmd/snssqs/process/main.go
    events:
      - sqs:
          arn: '{{pkl:PROCESS_ORDER_QUEUE_ARN}}'
          batchSize: 10
```

## Example 2: Event-Driven with SNS+SQS Fan-out

> lambdas do not subscribe directly, they are subscribed using SQS

```yaml
service: user-events

functions:
  publish-event:
    handler: cmd/http/publish/main.go
    events:
      - httpApi: { path: /events, method: POST }

  send-email:
    handler: cmd/snssqs/email/main.go
    events:
      - sqs:
          arn: '{{pkl:SEND_EMAIL_QUEUE_ARN}}'

  update-analytics:
    handler: cmd/snssqs/analytics/main.go
    events:
      - sqs:
          arn: '{{pkl:UPDATE_ANALITICS_QUEUE_ARN}}'
```

## Example 3: Scheduled Lambda

```yaml
service: report-generator

functions:
  generate-report:
    handler: cmd/cron/report/main.go
    timeout: 600
    memorySize: 1024
    events:
      - schedule:
          rate: cron(0 8 * * ? *)  # Daily at 8 AM UTC
          enabled: true
```

## PKL Configuration Example

Each service has a PKL project in `config/app/` that depends on the shared `baseconfig` package via `@baseconfig/` imports. For full setup instructions, see [PKL Projects Reference](../../docs/reference/pkl-projects.md#adding-a-new-service).

```pkl
# **/app/modules.pkl — service selects shared configs via @baseconfig/

module config.modules

import "@baseconfig/classes.pkl" as classes
import "@baseconfig/queues.pkl" as queues
import "@baseconfig/topics.pkl" as topics

local serviceConfigs: List<classes.ConfEnv> = List(
  queues.someQueue,
  topics.someTopic,
  new classes.ConfEnv {
    name = "SomeConfig"
    prod = "prod-value"
    dev = "dev-value"
    localval = "local-value"
  }
)

config {
  ...classes.getEnvs(serviceConfigs)
}
```

## IAM Policy Template (Least Privilege)

```yaml
# **/config/sls/iam.yml

statements:
  - Effect: Allow
    Action:
      - dynamodb:GetItem
      - dynamodb:PutItem
      - dynamodb:UpdateItem
      - dynamodb:Query
    Resource:
      - arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${self:custom.stage}-my-table

  - Effect: Allow
    Action:
      - sqs:SendMessage
      - sqs:ReceiveMessage
      - sqs:DeleteMessage
    Resource:
      - '{{pkl:SOME_QUEUE_ARN}}'

  - Effect: Allow
    Action: sns:Publish
    Resource: '{{pkl:SOME_TOPIC_ARN}}'
```

```yaml
# **/config/sls/resources.yml

Resources:
  UsersLambdaRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: UsersLambdaRole-${self:custom.stage}
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
      Policies:
        - PolicyName: UsersLambdaRole-${self:custom.stage}
          PolicyDocument:
            Version: '2012-10-17'
            Statement: ${file(./config/sls/iam.yml):role.statements}
```
