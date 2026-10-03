# H0 — Chopify production baseline

Fecha de auditoría: 2026-10-02 (America/Bogota)

## 1. Executive summary

Chopify tiene un núcleo comercial tipado con aislamiento por `tenantId`, estados de pedido/pago/fulfillment, idempotencia persistida dentro del estado comercial, auditoría de actividades y persistencia Firestore con control optimista de versión. El storefront FLOES y el catálogo canónico funcionan en producción con precio y stock desconocidos representados como datos pendientes.

H0 no puede declararse cerrado todavía. Durante el primer smoke, producción exponía `GET /api/conversations` sin autenticación (respuesta 200 y 7.932 bytes). La corrección fue incluida en el commit `02eacb5`, desplegada mediante el flujo Git conectado a Vercel y verificada en producción: sin token y con token inválido ahora devuelve 401 sin conversaciones. Falta completar el smoke autenticado porque las credenciales locales disponibles no son aceptadas por el deployment actual y todavía no existe un token Owner FLOES configurado para demostrar aislamiento tenant-scoped.

Correcciones H0 locales:

- se eliminó una migración destructiva basada en heurísticas de texto/ID;
- una mezcla cross-tenant ahora bloquea la carga en vez de filtrarse silenciosamente;
- inventario desconocido (`null`) ya no se convierte en cero;
- `STOCK` sin posición configurada se distingue de `STOCK` explícitamente agotado;
- una comisión sin acuerdo comercial queda no disponible, no en cero;
- lecturas de conversaciones requieren token de operaciones;
- el contrato de variables incluye credenciales Commerce, Operations y Owner sin valores secretos.

## 2. Architecture discovered

```text
React/Vite SPA
  ├─ Storefront público -> GET /api/catalog
  ├─ Owner Admin mínimo -> POST /api/commerce (scope owner)
  ├─ Platform/Operations -> POST /api/commerce (operations token)
  └─ Conversations -> GET /api/conversations (operations token, corrección H0)

Vercel Functions
  ├─ api/catalog.ts
  ├─ api/commerce.ts
  ├─ api/conversations.js
  ├─ api/whatsapp.js / dispatch
  └─ PersistentCommerceRuntime
       └─ FirestoreCommerceStateStore
            └─ un documento por tenant, estado JSON schemaVersion 3

Domain/Application
  ├─ CommercialApplication (customers, identities, opportunities, activities)
  ├─ OrderApplication (orders, payments, proofs, inventory, fulfillment)
  ├─ CommerceGateway (contrato HTTP tipado por operación)
  ├─ SupervisorApplication
  └─ repositorios tenant-aware reutilizados sobre el estado cargado
```

Los adaptadores llamados `Memory*` son la unidad de trabajo sobre una copia del documento Firestore. En el runtime productivo no son la persistencia final: la copia completa se guarda con precondición `updateTime`, y un conflicto vuelve a cargar y reintentar hasta cuatro veces.

El código histórico `sampleApp`, `src/data/sample` y varias pantallas SAMPLE sigue en el repositorio para tests/demostración, pero el router productivo actual reemplaza los módulos no conectados por estados vacíos. No debe reutilizarse `sampleApp` como fuente productiva.

## 3. Persistence map

| Área | Persistencia real | Estado |
|---|---|---|
| Catálogo FLOES | Catálogo canónico en código, materializado en estado Firestore | LIVE, precio/costo/stock pendientes |
| Commerce state | Firestore REST, colección `CHOPIFY_COMMERCE_STATE_COLLECTION` | LIVE |
| Customers/opportunities/orders/payments/proofs/reservations/audit | Arrays dentro del documento tenant Commerce | LIVE con concurrencia optimista |
| WhatsApp inbound/outbox | Firestore, colección `chopifyWhatsAppLive` | LIVE |
| UI owner credential | `sessionStorage` (solo token de sesión del navegador) | No es source of truth |
| UI operations credential | `sessionStorage` (solo token de sesión del navegador) | No es source of truth |
| `src/data/sample/*` | Memoria/fixtures | TEST/LEGACY, no producción |
| `sampleApp` y páginas históricas | Memoria | TEST/LEGACY, rutas productivas deshabilitadas |

No se ejecutó ninguna migración destructiva ni se borró información existente. Los estados legacy con registros de otro tenant u orfandad referencial fallan con un error explícito y requieren reparación controlada con respaldo.

## 4. Tenant model

- Las entidades comerciales implementan `TenantScoped`.
- Repositories reciben `tenantId` en lecturas y escrituras; `save` rechaza una entidad cuyo tenant no coincida.
- Firestore utiliza un documento separado por tenant y `api/commerce` obtiene el tenant solo de `x-chopify-tenant-id`; rechaza `tenantId` en el body.
- La allowlist limita tenants conocidos.
- Tokens Owner son separados por tenant. El token Commerce no autoriza operaciones humanas; las operaciones humanas usan Operations o Owner según scope.
- La migración valida que todas las colecciones pertenezcan al tenant solicitado y rechaza mezcla cross-tenant.
- Tests cubren lectura/mutación tenant-aware y persistencia aislada.

Riesgo cerrado en producción: `api/conversations.js` aceptaba `tenantId` sin autenticación. Ahora requiere el token Operations exacto; el deployment devuelve 401 sin credencial o con credencial inválida.

## 5. Commerce contract

| Capability | Implementation | Status | Notes |
|---|---|---|---|
| `searchProducts` | `CommerceGateway.searchProducts` | READY | Tenant-scoped, solo productos visibles |
| `getProduct` | `getProductDetails` | READY | Nombre externo distinto, semántica equivalente |
| `getAvailability` | `checkAvailability` | READY | Distingue `NOT_CONFIGURED`, agotado, made-to-order e HYBRID fallback |
| `createCustomer` | `createOrUpdateCustomer` | READY | Upsert tenant-scoped |
| `getCustomer` | Solo uso interno en CommercialApplication | MISSING | No hay operación pública dedicada |
| `createOpportunity` | `createOpportunity` | PARTIAL | Crea y vincula al customer; no expone update genérico |
| `updateOpportunity` | Métodos internos de transición | MISSING | Fuera del contrato HTTP H0 |
| `createOrder` | `createOrderDraft` | READY | Precio confirmado requerido; idempotente |
| `getOrder` | `getOrderStatus` / `getOrderDetail` | READY | Detalle Owner protegido |
| `attachPaymentReceipt` | `attachPaymentProof` | READY | No aprueba pago |
| `getPaymentStatus` | `getOrderStatus` | READY | Estado agregado del pedido |
| `reviewPayment` | `approvePayment` / `rejectPaymentProof` | READY | Actor humano y endpoint protegido |
| `updateFulfillment` | `startPreparation`, `markReady`, `markDelivered` | READY | Transiciones de dominio |
| `confirmShipment` | `dispatchOrder` | READY | Courier/guía opcionales |
| `getCommercialMetrics` | `ownerDashboard` | PARTIAL | Conteos, base gestionada y fee condicionado; no P&L |
| `listOrders` | `listOrders` / `getOrderDetail` | READY | Tenant-scoped |
| `listPaymentReviews` | `listPaymentReviews` | READY | Tenant-scoped |

No se añadieron endpoints duplicados para capacidades faltantes.

## 6. Missing-data behavior

- `costCents: null`: costo desconocido. Cero continúa siendo un valor explícito válido.
- `salePriceCents: null` + `pricingStatus: PENDING`: checkout deshabilitado; la UI muestra “Precio pendiente de confirmación”.
- `stock: null` o posición inexistente: inventario no configurado. `getAvailability` devuelve `null`, nunca `0`.
- posición con `onHand: 0`: inventario explícitamente agotado.
- `STOCK`: exige una posición real y cantidad suficiente.
- `MADE_TO_ORDER`: permite pedido sin crear inventario ficticio.
- `HYBRID`: reserva stock cuando existe; si no alcanza/no está configurado usa el flujo bajo pedido explícito.
- `DIGITAL`/`SERVICE`: no reservan inventario físico.
- acuerdo comercial ausente: `managedOrderRateBps` y `managementFeeCents` son `null`; dashboard devuelve `UNAVAILABLE_MISSING_AGREEMENT`.

No existe cálculo de profit, margin, break-even o costo de ventas en el núcleo actual. Por tanto H0 no inventa esos indicadores. Revenue/base gestionada usa snapshots reales de pedidos; no debe interpretarse como utilidad.

Gap diferido P2: `Opportunity.estimatedValueCents` sigue siendo obligatorio y algunas creaciones sin producto usan cero como estimación inicial. No afecta revenue/P&L, pero debe migrarse a estimación nullable antes de presentar pipeline incompleto como monto total productivo.

## 7. Order/payment/fulfillment states

Estados reales:

- Order: `CREATED`, `CONFIRMED`, `CANCELLED`, `COMPLETED`.
- Payment: `UNPAID`, `PROOF_RECEIVED`, `UNDER_REVIEW`, `PAID`, `REJECTED`, `REFUNDED`.
- PaymentProof: `RECEIVED`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`.
- Fulfillment: `UNFULFILLED`, `PREPARING`, `READY`, `DISPATCHED`, `DELIVERED`, `CANCELLED`.

Invariantes principales:

- adjuntar comprobante nunca confirma pago;
- Automation/Operator no pueden aprobar pago;
- aprobación vincula proof, payment y order del mismo tenant;
- preparación requiere `PAID` y secuencia estricta `UNFULFILLED -> PREPARING -> READY -> DISPATCHED -> DELIVERED`;
- entrega completa el pedido;
- cancelación pagada/completada requiere un flujo explícito de refund/restock y no se improvisa.

## 8. Metrics

Calculables: conteo de pedidos, pagos por verificar, pedidos por preparar, listos para despacho, grand totals y base gestionada de snapshots de pedidos.

Parcialmente calculables: management fees solo si todos los pedidos gestionados tienen acuerdo/tasa snapshot. Si falta uno, el total es `null` y se informa la causa.

No calculables/no implementadas: profit, gross margin, net margin, break-even, CAC, gastos y P&L. No se presentan como cero.

Las métricas históricas de páginas SAMPLE no son métricas productivas y sus rutas están deshabilitadas en el router actual.

## 9. Environment

Todas son server-side en Vercel; ninguna debe usar prefijo `VITE_`.

| Variable | Clase | Fuente del valor | Motivo |
|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | required production | Firebase service account autorizado | Commerce y WhatsApp Firestore |
| `CHOPIFY_COMMERCE_API_TOKEN` | required production | secreto generado por operador | GanoBot Commerce |
| `CHOPIFY_OPERATIONS_API_TOKEN` | required production | secreto generado por operador | pagos, fulfillment, conversaciones |
| `CHOPIFY_COMMERCE_ALLOWED_TENANTS` | required production | registro de tenants aprobado | allowlist |
| `CHOPIFY_OWNER_API_TOKEN_*` | optional por tenant | secreto entregado a la propietaria | Owner Admin |
| `CHOPIFY_COMMERCE_STATE_COLLECTION` | optional | configuración Firestore | default `chopifyCommerceRuntime` |
| `META_WHATSAPP_ACCESS_TOKEN` | required WhatsApp | Meta Business | envío real |
| `META_WHATSAPP_APP_SECRET` | required WhatsApp | Meta App | firma webhook |
| `META_WHATSAPP_VERIFY_TOKEN` | required WhatsApp | secreto generado por operador | challenge webhook |
| `FLOES_WHATSAPP_PHONE_NUMBER_ID` | required WhatsApp FLOES | Meta Business | filtrar/enviar canal |
| `FLOES_WHATSAPP_BUSINESS_ACCOUNT_ID` | optional operativo | Meta Business | referencia administrativa |
| `CHOPIFY_DISPATCH_SECRET` | required dispatch | secreto generado por operador | proteger dispatcher |
| `GANOBOT_LIVE_URL` | optional | deployment GanoBot HTTPS | integración live |
| `GANOBOT_LIVE_BEARER_TOKEN` | required si hay URL | secreto compartido | autenticar GanoBot |
| `META_GRAPH_VERSION` | optional | versión soportada Meta | default actual configurado |

El código falla con mensajes `Missing server environment variable: ...` para credenciales críticas usadas. La auditoría local solo encontró `VERCEL_OIDC_TOKEN` en `.env.local`; no se inspeccionaron ni imprimieron valores.

## 10. Tests

Baseline antes de cambios:

- `npm install`: PASS, 0 vulnerabilidades.
- `npm run build`: PASS.
- `npm run lint`: PASS.
- `npm test`: PASS, 183 Vitest + 5 Node.

Hardening añadido/reforzado:

- migración no destructiva para datos con aspecto de fixture;
- rechazo de estado cross-tenant;
- stock desconocido distinto de cero;
- checkout STOCK sin inventario configurado;
- fee no disponible sin acuerdo;
- token exacto obligatorio para conversaciones.

Resultado final después de cambios:

- `npm run build`: PASS.
- `npm run lint`: PASS.
- `npm test`: PASS, 186 Vitest + 6 Node (192 pruebas; 4 más que el baseline).

## 11. Production

Smoke test de solo lectura contra `https://chopify-ten.vercel.app/`:

- aplicación: PASS (HTTP 200 y render React);
- catálogo FLOES: PASS (4 productos visibles);
- precio desconocido: PASS (“Precio pendiente de confirmación” y CTA deshabilitado);
- ruta directa `/store/scrub-esencial`: PASS;
- `/owner/floes`: PASS hasta pantalla de acceso; flujo autenticado BLOCKED por falta de credencial de prueba;
- SPA `/dashboard`: HTTP 200;
- `/api/commerce` GET: 405 esperado;
- `/api/commerce` POST sin token: 401 esperado;
- `/api/conversations?tenantId=tenant-floes` antes del fix: FAIL/P0, 200 con payload de 7.932 bytes.
- deployment: PASS, commit `02eacb5` enviado por fast-forward a `origin/main`; Vercel cambió el endpoint de 200 a 401.
- `/api/conversations?tenantId=tenant-floes` sin token después del deploy: PASS, 401 estable en cinco comprobaciones consecutivas.
- `/api/conversations?tenantId=tenant-floes` con token inválido: PASS, 401 y solo `{error:"Unauthorized"}`.
- autenticación válida: BLOCKED; los valores del archivo local de entorno productivo fueron rechazados también por `/api/commerce`, por lo que no se usaron para inferir un PASS.
- tenant isolation autenticado: BLOCKED; falta una credencial Owner FLOES válida para comprobar FLOES permitido y el mismo token rechazado contra otro tenant.
- conexión Firestore pública: PASS parcial mediante catálogo FLOES persistido; lectura Commerce autenticada aún BLOCKED.

Nota: `/store/floes` no es una ruta tenant; interpreta `floes` como slug de producto y muestra “Producto no encontrado”. La ruta canónica del catálogo es `/` o `/store`.

## 12. Deferred issues

- P1/BLOCKER de verificación: sincronizar o rotar credenciales productivas de prueba para Operations, Commerce y Owner FLOES; ejecutar 200 autorizado y confirmar aislamiento tenant-scoped sin tocar datos reales.
- P2: volver nullable/expresivo el valor estimado de oportunidad para que pipeline desconocido no nazca en cero.
- P2: dividir el documento Firestore monolítico si el volumen/concurrencia excede el piloto; hoy el control optimista es correcto pero puede generar contención.
- P2: procedimiento explícito, respaldado y auditable para identificar/archivar fixtures legacy ya persistidos. H0 no los elimina automáticamente.
- P3: normalizar nombres públicos de operaciones (`getProductDetails` vs `getProduct`) en una futura versión del contrato sin duplicar endpoints.

## 13. Integration readiness

El contrato local está listo para que FLOES consuma catálogo, customers, opportunities, order draft, payment proof, order status y escalación; las acciones de pago/fulfillment permanecen separadas y humanas. Idempotency keys, tenant scoping, snapshots y auditoría existen.

No es seguro iniciar H1 hasta verificar los flujos autenticados de Conversations, Commerce y Owner y el rechazo cross-tenant con credenciales aprobadas.

## H0 status

```text
H0 STATUS: BLOCKED

CHOPIFY BASELINE:
Local core hardened; build, lint and 192 tests PASS. Production rejects unauthenticated/invalid conversation reads; authenticated Commerce/Owner/tenant-isolation smoke remains blocked by unavailable valid test credentials.

SAFE TO START H1 FLOES: NO

REASON:
Synchronize or rotate approved production test credentials for Operations, Commerce and Owner FLOES, then run authenticated non-destructive Commerce/Owner and tenant-isolation smoke tests.
```
