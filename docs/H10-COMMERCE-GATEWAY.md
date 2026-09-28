# H10 / GanoBot H3 — Commerce Gateway

Este endpoint es la frontera HTTP server-to-server entre GanoBot Commerce y Chopify.

## Seguridad
- `Authorization: Bearer <CHOPIFY_COMMERCE_API_TOKEN>`.
- Tenant exclusivamente en `X-Chopify-Tenant-Id`; se rechaza `tenantId` en el body.
- Allowlist `CHOPIFY_COMMERCE_ALLOWED_TENANTS`.
- `X-Request-Id`, `X-Correlation-Id` e `idempotencyKey` viajan hasta la aplicación.
- Los secretos son server-side; nunca `VITE_*`.

## Operaciones
`searchProducts`, `getProductDetails`, `checkAvailability`, `createOrUpdateCustomer`, `createOpportunity`, `createOrderDraft`, `attachPaymentProof`, `getOrderStatus`.

## Invariantes
Chopify sigue siendo autoridad comercial. Un order draft nace UNPAID. Un PaymentProof queda `pending_review`; el gateway no aprueba pagos. El inventario se reserva únicamente mediante `OrderApplication`.

## Estado de H3
La frontera y el contrato son reales y reutilizan `CommercialApplication`, `OrderApplication` y `BusinessCommerceAdapter`. La composición actual de Chopify continúa usando repositorios SAMPLE/in-memory para CRM/órdenes; por ello H3 valida integración y contrato, pero no convierte esos repositorios en persistencia productiva. La persistencia productiva debe sustituir los adapters SAMPLE sin cambiar el contrato HTTP.
