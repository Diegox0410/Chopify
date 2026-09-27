# H8 — GanoBot Integration

H8 conecta un agente comercial SAMPLE a los puertos autoritativos de Chopify. GanoBot interpreta intención y orquesta herramientas tipadas; precios, disponibilidad, oportunidades, pedidos y estados provienen del núcleo determinista.

## Límites
- No WhatsApp/Meta real: eso pertenece a H9.
- No confirma pagos. La aprobación permanece en el flujo humano autorizado de H3.
- No escribe directamente en Firebase ni conoce catálogos dentro del prompt.
- El adapter de comercio SAMPLE es la única fuente de precio/disponibilidad usada por H8.
- Un pedido creado por GanoBot queda UNPAID y sigue el lifecycle normal de Chopify.

## Flujo SAMPLE
Inbound simulado → tenant/customer/conversation conocidos → clasificación → typed tools → Commerce Adapter / CommercialApplication / OrderApplication → respuesta → tool trace.

## H9
H9 reemplazará el inbound simulado por WhatsApp Business Platform, resolverá identidad externa de forma idempotente y conectará outbound a la outbox de H4.
