# Business Commerce Adapter

## Propósito

`BusinessCommerceAdapter` desacopla Chopify del backend comercial de cada tenant. Chopify define el caso de uso; el adapter traduce hacia el e-commerce correspondiente.

## Responsabilidades

La frontera comercial contempla:

- `searchProducts`
- `getProduct`
- `getPrice`
- `getAvailability`
- `reserveInventory`
- `releaseInventory`
- `commitInventory`
- resolución/upsert de Customer cuando la integración lo requiera
- publicación de una referencia de Order cuando el backend externo necesite conocerla

H3 implementa una versión SAMPLE en memoria para catálogo, precio, disponibilidad, inventario y publicación de referencia.

## Proyección segura

Los consumidores externos reciben una `CommerceProduct` apropiada para operación comercial. Costos privados, reglas internas, credenciales y estructuras específicas del backend del tenant no forman parte del contrato público del producto.

## Autoridad

Chopify es autoridad sobre Opportunity, Order, Attribution, Payment/PaymentProof, reglas de autorización, idempotencia, auditoría y snapshots comerciales.

El e-commerce del tenant continúa siendo autoridad de su catálogo, precio vigente e inventario operativo. El adapter reconcilia esas fronteras sin hacer que Chopify conozca Firebase, Shopify u otra implementación concreta.

## Tenant isolation

Cada llamada recibe `tenantId`. Un adapter no puede inferir libremente otro negocio ni mezclar posiciones de inventario entre tenants.

## GanoBot

GanoBot no debe llamar al backend del tenant directamente. En H8 usará herramientas tipadas de Chopify, que aplicarán autorización/policy antes de llegar al adapter.

## Implementaciones futuras

MG, DGNG y FLOES podrán tener adapters diferentes aun cuando sus backends no compartan esquema. Cambiar un backend no debe alterar las reglas de dominio de Order/Payment/Inventory.
