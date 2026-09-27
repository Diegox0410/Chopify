# Inventory Reservations

## Modelo

Cada `InventoryPosition` mantiene:

- `onHand`: unidades físicas registradas.
- `reserved`: unidades apartadas por pedidos aún no comprometidos.
- `available = max(0, onHand - reserved)`.

La reserva evita vender la misma disponibilidad mientras el cliente completa el pago.

## Semántica

Con `onHand = 10` y `reserved = 3`:

- reservar 2 → `onHand = 10`, `reserved = 5`;
- commit de 2 → `onHand = 8`, `reserved = 3`;
- liberar 2 → `onHand = 10`, `reserved = 1` si se parte del estado reservado correspondiente.

`reserve` modifica solo `reserved`. `commit` descuenta simultáneamente `onHand` y `reserved`. `release` reduce solo `reserved`.

## InventoryReservation

Estados:

`ACTIVE → COMMITTED`

`ACTIVE → RELEASED`

`ACTIVE → EXPIRED`

Solo una reserva ACTIVE puede producir una mutación nueva de inventario.

## Creación de pedido

STOCK requiere disponibilidad suficiente y crea reserva. MADE_TO_ORDER no reserva stock. HYBRID puede reservar cuando la disponibilidad permite cubrir la cantidad; la política definitiva por tenant puede evolucionar detrás del adapter.

## Pago

Aprobar un Payment compromete una reserva ACTIVE. Recibir o revisar un comprobante no toca inventario.

## Cancelación y expiración

Cancelar libera una reserva ACTIVE. Expirar también la libera. Repetir expiración/cancelación no debe producir una segunda liberación.

Una reserva COMMITTED no se “deshace” con release. Devoluciones futuras deberán registrar un movimiento explícito de inventario.

## Atomicidad

El adapter SAMPLE calcula primero todas las posiciones resultantes y luego aplica las mutaciones, evitando una actualización parcial dentro de esa operación en memoria. Esto no sustituye una transacción distribuida en un backend real.
