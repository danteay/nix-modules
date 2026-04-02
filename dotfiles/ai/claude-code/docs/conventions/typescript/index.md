# TypeScript Conventions

> Naming, strict types, error handling, project structure, and tooling for TypeScript services.

## Version

Always use **TypeScript 5.x** (latest stable) with **Node.js LTS (22+)**:

```nix
packages = [ pkgs.nodejs_22 pkgs.nodePackages.typescript pkgs.pnpm ];
```

```json
{ "engines": { "node": ">=22" } }
```

---

## tsconfig.json (Minimum)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "esModuleInterop": true,
    "skipLibCheck": false,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**`strict: true` is non-negotiable.** Never disable individual strict flags.

---

## Naming

| Construct | Convention | Example |
|-----------|-----------|---------|
| File | kebab-case | `order-service.ts`, `dynamo-repository.ts` |
| Class | PascalCase | `OrderService`, `EventPublisher` |
| Interface | PascalCase (no `I` prefix) | `OrderRepository`, `Config` |
| Type alias | PascalCase | `OrderID`, `CustomerID` |
| Enum | PascalCase (values: PascalCase) | `OrderStatus.Placed` |
| Function / method | camelCase | `placeOrder`, `findById` |
| Variable | camelCase | `orderId`, `customerId` |
| Constant (module-level) | UPPER_SNAKE_CASE | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |
| Private fields | `#` (native private) or `_` prefix | `#repo`, `_config` |
| Generic type param | Single uppercase or descriptive | `T`, `TItem`, `TKey` |

---

## Type System Rules

### Never Use `any`

```typescript
// WRONG
function process(data: any) { return data.id }

// CORRECT — use unknown and narrow
function process(data: unknown): string {
  if (!isOrder(data)) throw new TypeError("expected Order")
  return data.id  // narrowed to Order here
}

// Type guard
function isOrder(v: unknown): v is Order {
  return (
    typeof v === "object" && v !== null &&
    "id" in v && typeof (v as Order).id === "string"
  )
}
```

### Prefer `type` over `interface` for Data Shapes

```typescript
// Data shapes → type alias
type Order = {
  readonly id: OrderID
  readonly customerId: CustomerID
  readonly items: readonly OrderItem[]
  readonly status: OrderStatus
  readonly createdAt: Date
}

// Extensible contracts → interface
interface OrderRepository {
  save(order: Order): Promise<void>
  findById(id: OrderID): Promise<Order | null>
}
```

### Branded Types for IDs

```typescript
declare const __brand: unique symbol
type Brand<T, B> = T & { readonly [__brand]: B }

type OrderID    = Brand<string, "OrderID">
type CustomerID = Brand<string, "CustomerID">

// Constructors
const toOrderID    = (s: string): OrderID    => s as OrderID
const toCustomerID = (s: string): CustomerID => s as CustomerID
```

---

## Zod for External Validation

All external inputs (request bodies, event payloads, env vars) are validated with zod:

```typescript
import { z } from "zod"

const PlaceOrderCmdSchema = z.object({
  customerId: z.string().min(1),
  items: z.array(z.object({
    sku: z.string().min(1),
    quantity: z.number().int().positive(),
  })).min(1),
})

type PlaceOrderCmd = z.infer<typeof PlaceOrderCmdSchema>

function parseBody(body: unknown): PlaceOrderCmd {
  const result = PlaceOrderCmdSchema.safeParse(body)
  if (!result.success) {
    throw new ValidationError(result.error.flatten())
  }
  return result.data
}
```

---

## Error Handling

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

// Never swallow errors
try {
  await riskyOp()
} catch (err) {
  // WRONG:
  // } catch (_) {}
  // CORRECT:
  logger.error("risky op failed", { err })
  throw new ServiceError("operation failed", { cause: err })
}
```

---

## Module Exports

Always use **named exports**:

```typescript
// CORRECT
export class OrderService { ... }
export type { Order, OrderStatus }
export { toOrderID }

// WRONG
export default class OrderService { ... }
```

---

## Async Rules

```typescript
// Always await — never leave floating promises
const order = await repo.findById(id)

// Parallel I/O — never sequential awaits for independent operations
// WRONG:
const a = await repo.findA(id)
const b = await repo.findB(id)  // waits for a unnecessarily

// CORRECT:
const [a, b] = await Promise.all([repo.findA(id), repo.findB(id)])

// Mark intentional fire-and-forget
void notify(order).catch(err => logger.error("notify failed", { err }))
```

---

## Logging with pino

```typescript
import pino from "pino"

const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  formatters: { level: label => ({ level: label }) },
})

// Structured, contextual logging
const log = logger.child({ orderId: order.id, customerId: order.customerId })
log.info("order placed")
log.error({ err }, "failed to publish event")
```

---

## Tooling

| Tool | Purpose | Command |
|------|---------|---------|
| `eslint` + `@typescript-eslint` | Linting | `eslint src/` |
| `prettier` | Formatting | `prettier --write src/` |
| `tsc` | Type checking | `tsc --noEmit` |
| `vitest` | Testing (preferred) | `vitest run` |
| `tsx` | Run TS directly in dev | `tsx src/index.ts` |
| `tsup` | Build / bundle | `tsup src/index.ts` |

**`.eslintrc` minimum:**

```json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/strict-type-checked"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-unnecessary-condition": "error"
  }
}
```

---

## Cross-References

→ [TypeScript Code Patterns](../../patterns/typescript/code.md) | [TypeScript Concurrency Patterns](../../patterns/typescript/concurrency.md) | [TypeScript Testing Patterns](../../patterns/typescript/testing.md) | [TypeScript Testing Guide](../../testing/typescript/guide.md) | [Common Pitfalls](../general/common-pitfalls.md)
