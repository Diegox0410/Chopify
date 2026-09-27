# Ciclo comercial

`Customer → Conversation → Opportunity → Order → ManagedSale → Settlement`

1. Una oportunidad registra intención antes del pedido y aplica transiciones deterministas.
2. El pedido referencia, sin reemplazar, al pedido externo del tenant.
3. Attribution separa adquisición, canal de conversión y quién gestionó la venta.
4. ManagedSale congela el acuerdo comercial usado y calcula la base sobre subtotal de productos menos descuentos atribuibles. Envío e impuestos quedan fuera.
5. El comprobante recibido deja el pago en `PROOF_RECEIVED`; solo una aprobación humana explícita produce `PAID`.
6. Settlement agrupa fees en líneas auditables; no es facturación fiscal.

## Pipeline operativo H2

`OPEN → QUALIFIED → CART_STARTED → ORDER_CREATED → WON`

Las etapas `OPEN`, `QUALIFIED` y `CART_STARTED` pueden terminar en `LOST` o `ABANDONED`. `ORDER_CREATED` puede terminar en `WON` o `LOST`. `WON` y `LOST` son terminales. Solo la operación explícita `reopenOpportunity` permite `ABANDONED → OPEN`.

Las transiciones son funciones puras y no se permite asignar el estado desde React. Cada caso de uso persiste el resultado y agrega un `CommercialActivity` visible en el timeline.

`ORDER_CREATED` no crea un pedido: la creación y atribución de `Order` pertenecen a H3.

## H3: ciclo transaccional del pedido

El flujo operativo implementado es:

`Opportunity ORDER_CREATED → Order PENDING → InventoryReservation ACTIVE → Payment UNPAID → PaymentProof RECEIVED → Payment UNDER_REVIEW → Payment PAID → Reservation COMMITTED → Fulfillment PREPARING → READY → DISPATCHED → DELIVERED`

Reglas:

1. `createOrderFromOpportunity` requiere una oportunidad en `ORDER_CREATED` y evita crear más de un pedido para la misma oportunidad.
2. El pedido congela líneas, precio, descuentos, totales, atribución, acuerdo comercial y cálculo de fee.
3. Para artículos físicos elegibles se crea una reserva antes del pago. MADE_TO_ORDER no requiere reservar stock disponible.
4. Recibir un comprobante produce `PROOF_RECEIVED`; iniciar revisión produce `UNDER_REVIEW`.
5. Revisar un comprobante no confirma el pago, no hace commit de inventario y no marca la oportunidad como ganada.
6. Solo un actor autorizado puede aprobar el pago. La aprobación produce `PAID`, compromete la reserva ACTIVE y marca la oportunidad `WON`.
7. Rechazar un comprobante no libera automáticamente la reserva; puede recibirse un comprobante de reemplazo.
8. Cancelar un pedido libera una reserva todavía ACTIVE. Una reserva COMMITTED no se restaura ingenuamente.
9. Expirar una reserva ACTIVE la libera una sola vez; repetir la operación sobre una reserva no activa no vuelve a tocar inventario.
10. Fulfillment avanza únicamente sobre pedidos pagados en el flujo SAMPLE.

### Base administrada

La base administrada es el subtotal de productos menos descuentos atribuibles. Envío, impuestos, propinas y otros importes pass-through quedan fuera. El fee se calcula con la tasa congelada en basis points dentro del snapshot comercial del pedido.

Ejemplo: productos $100, descuento $20, envío $6, impuestos $4 y tasa 5% producen una base administrada de $80 y un fee de $4.
