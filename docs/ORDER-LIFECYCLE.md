# Order Lifecycle

## Propósito

H3 convierte una Opportunity en un pedido autoritativo de Chopify sin mezclar estados comerciales, financieros y logísticos.

## Máquinas de estado separadas

### Opportunity

`OPEN → QUALIFIED → CART_STARTED → ORDER_CREATED → WON`

La creación del Order exige `ORDER_CREATED`. La oportunidad se marca `WON` cuando el pago es aprobado, no cuando se recibe un comprobante.

### Payment

`UNPAID → PROOF_RECEIVED → UNDER_REVIEW → PAID`

Un comprobante puede ser rechazado. El rechazo no equivale a cancelación del pedido y permite recibir un comprobante de reemplazo. `REFUNDED` y, cuando corresponda, `PARTIALLY_REFUNDED` modelan estados posteriores; no implican restauración automática de inventario.

### Fulfillment

`UNFULFILLED → PREPARING → READY → DISPATCHED → DELIVERED`

En SAMPLE, fulfillment requiere Payment `PAID`.

## Creación

`createOrderFromOpportunity`:

1. valida tenant y autorización;
2. exige Opportunity `ORDER_CREATED`;
3. evita duplicados por oportunidad e idempotency key;
4. obtiene producto/precio/disponibilidad mediante `BusinessCommerceAdapter`;
5. construye snapshots de líneas y totales;
6. congela Attribution y CommercialAgreement;
7. calcula managed revenue base y management fee;
8. reserva inventario físico elegible;
9. crea Payment `UNPAID`;
10. persiste y registra actividad/auditoría.

## Snapshots históricos

El Order no depende de que el catálogo conserve mañana el mismo nombre o precio. Cada línea conserva los datos necesarios para explicar el pedido histórico. También se congelan atribución, acuerdo comercial y cálculo administrado.

## Pago

`PaymentProof` y `Payment` son entidades distintas. Recibir evidencia no prueba que el dinero llegó.

`submitPaymentProof → PROOF_RECEIVED`

`startPaymentReview → UNDER_REVIEW`

`approvePayment → PAID`

La aprobación exige permiso y coherencia `proof.paymentId`, `proof.orderId`, `payment.orderId` y `order.id`. Solo entonces se compromete una reserva ACTIVE y la Opportunity pasa a `WON`.

## Cancelación y devolución

Cancelar libera únicamente una reserva ACTIVE. Si el inventario ya fue COMMITTED, no se repone mediante la cancelación simple: una devolución/reintegro necesita un flujo explícito posterior para conservar trazabilidad.

## Idempotencia

H3 define claves para CREATE_ORDER, SUBMIT_PAYMENT_PROOF, APPROVE_PAYMENT, REJECT_PAYMENT y CANCEL_ORDER. `COMPLETED` permite responder sin repetir efectos. `STARTED` bloquea un retry inseguro y requiere recuperación explícita.

## Fuera de H3

No hay gateway de pago, lectura bancaria, courier, scheduler, Firebase productivo ni mensajería externa.
