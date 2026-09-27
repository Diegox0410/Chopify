# CRM + Opportunities

## Modelo operacional

`Customer` mantiene identidad comercial mínima: nombre, contacto opcional, estado (`LEAD`, `ACTIVE`, `INACTIVE`, `ARCHIVED`), origen, tags y marcas temporales. No almacena información médica, bancaria ni secretos.

`CustomerIdentity` vincula un identificador externo con un Customer mediante `tenantId + channel + externalIdentifier`. El mismo identificador en MG y DGNG puede resolver clientes distintos. Es la frontera preparada para futuros Channel Gateway, Chopify Ingress, Tenant Resolver y Customer Resolver; H2 no conecta canales.

`Conversation` conserva canal, estado, modo asignado, responsable y tiempos. Las operaciones puras son requerir humano, asignar humano, cerrar y reabrir explícitamente. No existe historial ficticio de mensajes.

`CommercialActivity` es el timeline visible de Customer, Conversation y Opportunity. No reemplaza `AuditEvent`. `CommercialNote` acepta texto plano no vacío. `CommercialTask` tiene prioridad y pasa de `OPEN` a `COMPLETED` o `CANCELLED` con operaciones explícitas.

## Opportunity

El estado sigue esta máquina:

```text
OPEN → QUALIFIED → CART_STARTED → ORDER_CREATED → WON
  └──────────────→ LOST
  └──────────────→ ABANDONED → OPEN (solo reopen explícito)
```

`QUALIFIED` y `CART_STARTED` también pueden terminar en `LOST` o `ABANDONED`; `ORDER_CREATED` puede terminar en `LOST`. `WON` y `LOST` son terminales. Las pérdidas usan razones tipadas: `PRICE`, `NO_STOCK`, `NO_RESPONSE`, `CUSTOMER_CHANGED_MIND`, `DELIVERY`, `PAYMENT`, `COMPETITOR`, `NOT_QUALIFIED`, `DUPLICATE`, `OTHER`. `OTHER` exige detalle. El dinero siempre usa cents enteros no negativos.

## Pipeline y métricas

El pipeline abierto incluye solamente `OPEN`, `QUALIFIED`, `CART_STARTED` y `ORDER_CREATED`. `WON`, `LOST` y `ABANDONED` se muestran como resultados separados y nunca suman valor abierto.

- `qualificationRate = (QUALIFIED + CART_STARTED + ORDER_CREATED + WON) / totalOpportunities`.
- `orderCreationRate = (ORDER_CREATED + WON) / totalOpportunities`.
- `closedOpportunities = WON + LOST`.
- `winRate = WON / (WON + LOST)`.
- `ABANDONED` se informa aparte y no se mezcla con `LOST`.
- Un denominador cero produce `0`, nunca `NaN` ni infinito.

Estas métricas indican progresión de oportunidades SAMPLE; no representan ventas ni revenue real.

## Aislamiento y agregación PLATFORM

Los contratos Customer, CustomerIdentity, Conversation, Opportunity, CommercialActivity, CommercialNote y CommercialTask requieren `tenantId`. El adapter valida de nuevo el tenant en cada escritura. Una consulta por otro tenant devuelve `null` o una lista vacía. El scope “Todos los negocios” obtiene la lista de tenants de plataforma y agrega consultas independientes; no omite el tenant.

## Adapter SAMPLE y compatibilidad futura

Los fixtures ficticios viven únicamente en `src/data/sample`. React consume `CommercialApplication`, que depende de contratos y no del fixture. El adapter en memoria puede sustituirse por persistencia real sin mover las reglas a UI. Opportunity puede ser creada por cualquier actor autorizado futuro y Conversation admite asociación posterior con mensajes inbound/outbound sin convertir H2 en un inbox.
