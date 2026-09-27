# Arquitectura

## Fronteras

- **Chopify** conserva procesos, estado, reglas, atribución, billing, automatización y auditoría.
- **GanoBot** será un cliente de los puertos de aplicación. Conversa y razona, pero no decide precios, dinero, inventario, permisos ni estados.
- **E-commerce del tenant** seguirá siendo la fuente de catálogo, precio, inventario y operación propia. Los adapters futuros traducirán esos contratos.

## Capas

`UI → application/use cases → domain → repository interfaces → adapters`

- `domain/`: modelos y reglas puras, sin React ni SDKs.
- `application/`: orquestación y puertos consumibles por UI o GanoBot.
- `repositories/`: contratos de persistencia.
- `adapters/`: implementaciones reemplazables; hoy solo SAMPLE en memoria.
- `features/` y `components/`: experiencia Super Admin.
- `stores/`: estado efímero de interfaz.

Toda entidad comercial incluye `tenantId`. Los repositorios reciben el tenant explícitamente para evitar lecturas cruzadas. Dinero usa cents enteros; tasas usan basis points.

## H2: CRM y pipeline

La primera vertical operativa mantiene la misma dirección de dependencias:

`React → CommercialApplication → reglas/proyecciones puras → contratos tenant-aware → adapter SAMPLE`

- La UI nunca importa fixtures ni escribe entidades directamente.
- Cada lectura comercial empieza en `listByTenant(tenantId, ...)` o `getById(tenantId, id)`.
- Cada escritura recibe de nuevo el `tenantId` y el adapter rechaza si no coincide con la entidad.
- La vista PLATFORM “Todos los negocios” enumera tenants conocidos y agrega resultados explícitamente en application; no existe un `listAll()` comercial.
- `CustomerIdentity` usa la clave lógica `tenantId + channel + externalIdentifier`, preparada para un futuro Tenant/Customer Resolver.
- `CommercialActivity` es timeline de negocio; `AuditEvent` continúa siendo auditoría técnica.
- `ORDER_CREATED` es solo una etapa de `Opportunity`; H2 no instancia `Order`.

## H3: pedidos, atribución e inventario

H3 extiende la misma dirección de dependencias:

`React / futuro GanoBot → OrderApplication → domain → repository interfaces + BusinessCommerceAdapter → adapters`

Responsabilidades autoritativas:

- `OrderApplication` orquesta creación de pedido, comprobantes, revisión, aprobación/rechazo, cancelación, expiración de reservas y fulfillment.
- `domain/order.ts` mantiene las máquinas de estado de Order, Payment y Fulfillment y construye snapshots históricos.
- `domain/inventory.ts` define reserva, liberación y commit sin conocer el backend del tenant.
- Los repositorios conservan estado propio de Chopify: Order, Payment, PaymentProof, InventoryReservation, IdempotencyRecord, CommercialAgreement y AuditEvent.
- `BusinessCommerceAdapter` es la frontera con el sistema comercial del tenant para catálogo, precio, disponibilidad e inventario.
- El adapter SAMPLE en memoria es una implementación de prueba; no es una integración productiva.

Order, Payment y Fulfillment son estados separados. Un comprobante no confirma dinero. `PROOF_RECEIVED` y `UNDER_REVIEW` no autorizan preparación ni commit de inventario; solo una aprobación autorizada produce `PAID`.

La atribución, el acuerdo comercial y los importes administrados se congelan dentro del pedido. Los cambios posteriores en catálogo, precio o contrato no reescriben el histórico del pedido.

La vista multi-tenant continúa agregando datos desde application. Las operaciones mutables siempre reciben un tenant explícito y los adapters rechazan mutaciones cruzadas.

### Frontera con GanoBot

GanoBot no accede directamente a Firebase, repositorios, inventario ni estados financieros. En H8 consumirá puertos autenticados de Chopify. Para comercio, la ruta prevista es:

`GanoBot → Chopify application port → policy/authorization → BusinessCommerceAdapter → e-commerce del tenant`

La aprobación de pagos permanece fuera de la autoridad del agente conversacional.

### Límites actuales de H3

H3 usa memoria SAMPLE y no implementa transacciones distribuidas, outbox, scheduler, persistencia remota, gateway de pago, banco, courier ni APIs externas. Una operación idempotente que queda en `STARTED` después de un efecto requiere recuperación explícita; H4 deberá formalizar outbox/retry y fronteras transaccionales durables.
