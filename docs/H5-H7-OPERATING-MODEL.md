# H5–H7 — Operating model

Baseline: H4 `548c728`.

## H5 Super Admin
`/businesses` convierte el shell de Negocios en portafolio multi-tenant. `/users` muestra roles tenant-aware. La capa sigue SAMPLE y no crea usuarios reales ni credenciales.

## H6 Billing / Settlements
`/managed-sales` deriva únicamente pedidos `PAID` y gestionados. La base gestionada usa producto menos descuentos y excluye pass-through. El fee usa el snapshot de tasa del pedido. `/settlements` representa obligaciones administrativas; no implica que dinero haya sido debitado, cobrado o conciliado en un banco.

## H7 Content Operations
`/calendar`, `/publications` y `/campaigns` modelan planificación editorial y estado multi-canal. `PUBLISHED` es SAMPLE; H7 no llama Instagram, Facebook ni TikTok. Los adapters externos pertenecen a hitos posteriores.

FLOES se usa como smoke test, pero todos los modelos y consultas están aislados por `tenantId` y comparten el mismo motor.
