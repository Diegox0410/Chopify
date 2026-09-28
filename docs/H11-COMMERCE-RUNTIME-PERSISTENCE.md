# H11 — Commerce Runtime & Persistence

H11 removes the serverless in-memory state boundary from `/api/commerce`. Every tenant now has a durable Commerce Runtime state in Firestore.

## Runtime
`/api/commerce -> PersistentCommerceRuntime -> CommerceGateway -> CommercialApplication / OrderApplication`

The runtime loads only the authenticated tenant state, executes the typed operation and persists mutations using Firestore optimistic concurrency. A conflicting write reloads the latest state and retries the operation. Read operations never write state.

## Persisted state
Customers, identities, conversations, opportunities, activities, notes, tasks, escalations, orders, payments, payment proofs, inventory reservations, idempotency records, inventory, agreements and audit events are persisted per tenant. Product definitions remain the existing authoritative Commerce Adapter source until the real storefront catalog adapters replace SAMPLE catalog data.

## Invariants
- Tenant comes only from the authenticated `x-chopify-tenant-id` header.
- One Firestore document is used per tenant, preventing cross-tenant state mixing.
- Writes use Firestore `updateTime` preconditions and bounded conflict retries.
- Runtime IDs are UUID-based so cold starts cannot overwrite previous entities.
- `PaymentProof` remains `pending_review`; persistence never implies payment approval.
- Order idempotency survives serverless cold starts because idempotency records are persisted.
- No client-side Firebase credentials are introduced. The runtime uses the existing server-only Firebase service account environment variable.

## Environment
Optional: `CHOPIFY_COMMERCE_STATE_COLLECTION`. Default: `chopifyCommerceRuntime`.

## Remaining boundary
This milestone makes the commercial workflow durable, but the current product catalog is still SAMPLE. Replacing catalog/product/inventory sources with each storefront's real adapter is a later migration and does not change `CommercePort`.
