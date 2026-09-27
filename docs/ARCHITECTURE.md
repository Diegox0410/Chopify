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
