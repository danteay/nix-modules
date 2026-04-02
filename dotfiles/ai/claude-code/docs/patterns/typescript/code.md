# TypeScript Code Patterns

> Discriminated unions, branded types, result pattern, DI, and service configuration.

---

## Discriminated Unions

Model domain state exhaustively without runtime errors:

```typescript
type OrderStatus =
  | { kind: "placed";    placedAt: Date }
  | { kind: "confirmed"; confirmedAt: Date }
  | { kind: "shipped";   shippedAt: Date; trackingNumber: string }
  | { kind: "delivered"; deliveredAt: Date }
  | { kind: "cancelled"; cancelledAt: Date; reason: string }

function describeOrder(status: OrderStatus): string {
  switch (status.kind) {
    case "placed":    return `Placed on ${status.placedAt.toISOString()}`
    case "shipped":   return `Shipped: tracking ${status.trackingNumber}`
    case "cancelled": return `Cancelled: ${status.reason}`
    default:          return status.kind  // TypeScript enforces exhaustiveness
  }
}
```

---

## Branded Types (Nominal Typing)

Prevent mixing IDs of different types:

```typescript
declare const __brand: unique symbol
type Brand<T, B> = T & { [__brand]: B }

type OrderID    = Brand<string, "OrderID">
type CustomerID = Brand<string, "CustomerID">
type ProductSKU = Brand<string, "ProductSKU">

const toOrderID    = (id: string): OrderID    => id as OrderID
const toCustomerID = (id: string): CustomerID => id as CustomerID

// Compiler catches mistakes:
const orderId: OrderID = toOrderID("ord-123")
const custId:  CustomerID = toCustomerID("cust-456")

findOrder(custId)  // TS error: Argument of type 'CustomerID' is not assignable to 'OrderID'
```

---

## Result Type (Typed Error Handling)

Explicit success/failure without exceptions for expected domain outcomes:

```typescript
type Ok<T>  = { readonly ok: true;  readonly value: T }
type Err<E> = { readonly ok: false; readonly error: E }
type Result<T, E = Error> = Ok<T> | Err<E>

const ok  = <T>(value: T): Ok<T>   => ({ ok: true, value })
const err = <E>(error: E): Err<E>  => ({ ok: false, error })

// Usage in service
async function placeOrder(cmd: PlaceOrderCmd): Promise<Result<Order, DomainError>> {
  const customer = await customerRepo.findById(cmd.customerId)
  if (!customer) {
    return err(new CustomerNotFoundError(cmd.customerId))
  }
  const order = Order.create(cmd)
  await orderRepo.save(order)
  return ok(order)
}

// Consumption
const result = await placeOrder(cmd)
if (!result.ok) {
  return { statusCode: 422, body: JSON.stringify({ error: result.error.code }) }
}
return { statusCode: 201, body: JSON.stringify(result.value) }
```

---

## Constructor Injection

```typescript
// Port (interface at consumer side)
interface OrderRepository {
  save(order: Order): Promise<void>
  findById(id: OrderID): Promise<Order | null>
  findByCustomer(customerId: CustomerID): Promise<Order[]>
}

interface EventPublisher {
  publish(event: DomainEvent): Promise<void>
}

// Service with injected deps
class OrderService {
  constructor(
    private readonly repo: OrderRepository,
    private readonly publisher: EventPublisher,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async place(cmd: PlaceOrderCmd): Promise<Order> {
    const order = Order.create(cmd, this.clock())
    await this.repo.save(order)
    await this.publisher.publish(new OrderPlaced(order))
    return order
  }
}

// Composition root (Lambda handler module)
const config     = Config.load()
const dynamoRepo = new DynamoOrderRepository(dynamoClient, config.tableName)
const snsPublish = new SNSEventPublisher(snsClient, config.topicArn)
const service    = new OrderService(dynamoRepo, snsPublish)
const handler    = new CreateOrderHandler(service)

export const lambdaHandler = handler.handle.bind(handler)
```

---

## Zod for Runtime Validation

Validate external inputs (request bodies, event payloads) at boundaries:

```typescript
import { z } from "zod"

// Schema = runtime validator + TypeScript type (single source of truth)
const PlaceOrderCmdSchema = z.object({
  customerId: z.string().min(1),
  items: z.array(z.object({
    sku: z.string().min(1),
    quantity: z.number().int().positive(),
  })).min(1),
  couponCode: z.string().optional(),
})

type PlaceOrderCmd = z.infer<typeof PlaceOrderCmdSchema>

// Handler validates at boundary, domain receives typed cmd
function parseCmd(body: unknown): PlaceOrderCmd {
  const result = PlaceOrderCmdSchema.safeParse(body)
  if (!result.success) {
    throw new ValidationError(result.error.flatten())
  }
  return result.data
}
```

---

## Service Configuration

```typescript
import { z } from "zod"

const ConfigSchema = z.object({
  tableName:   z.string().min(1),
  topicArn:    z.string().min(1),
  queueUrl:    z.string().url(),
  region:      z.string().default("us-east-2"),
  logLevel:    z.enum(["debug", "info", "warn", "error"]).default("info"),
  serviceName: z.string().default("order-service"),
  maxRetries:  z.coerce.number().int().positive().default(3),
})

type Config = z.infer<typeof ConfigSchema>

export function loadConfig(): Config {
  const result = ConfigSchema.safeParse({
    tableName:  process.env["TABLE_NAME"],
    topicArn:   process.env["TOPIC_ARN"],
    queueUrl:   process.env["QUEUE_URL"],
    region:     process.env["AWS_REGION"],
    logLevel:   process.env["LOG_LEVEL"],
    maxRetries: process.env["MAX_RETRIES"],
  })

  if (!result.success) {
    throw new Error(`Invalid config: ${JSON.stringify(result.error.flatten())}`)
  }
  return result.data
}
```

---

## Domain Errors

```typescript
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }
}

export class OrderNotFoundError extends DomainError {
  constructor(orderId: string) {
    super(`Order ${orderId} not found`, "order_not_found", { orderId })
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super(
      `Cannot transition from ${from} to ${to}`,
      "invalid_state_transition",
      { from, to },
    )
  }
}

// Handler mapping
function mapError(err: DomainError): { statusCode: number; body: string } {
  const statusMap: Record<string, number> = {
    order_not_found:          404,
    invalid_state_transition: 422,
    insufficient_funds:       422,
  }
  return {
    statusCode: statusMap[err.code] ?? 500,
    body: JSON.stringify({ error: err.code, message: err.message }),
  }
}
```

---

## Cross-References

→ [General Code Patterns](../general/code.md) | [TypeScript Conventions](../../conventions/typescript/index.md) | [TypeScript Concurrency](./concurrency.md) | [TypeScript Testing](./testing.md)
