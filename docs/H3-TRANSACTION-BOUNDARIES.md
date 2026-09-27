# H3 Transaction Boundaries

## Objetivo

H3 hace explícito dónde empiezan y terminan los efectos de una operación. El adapter SAMPLE permite validar reglas, pero no pretende ofrecer garantías ACID distribuidas.

## Principio

Las reglas puras calculan el siguiente estado. Application coordina autorización, idempotencia, adapter, repositorios, actividad y auditoría.

No se delega una decisión financiera a React, GanoBot ni al adapter del tenant.

## CREATE_ORDER

Frontera lógica:

1. validar Opportunity y catálogo;
2. calcular snapshots y totales;
3. detectar retry/duplicado;
4. registrar idempotencia STARTED;
5. reservar inventario cuando corresponda;
6. persistir Order, Payment y InventoryReservation;
7. publicar referencia;
8. registrar actividad/auditoría;
9. marcar idempotencia COMPLETED.

Si una ejecución queda en STARTED después de un efecto, el retry automático se bloquea en SAMPLE para no duplicar la mutación. La recuperación durable pertenece a una evolución posterior.

## SUBMIT_PAYMENT_PROOF

La idempotencia comienza antes de persistir los cambios. El efecto financiero es cero: Payment queda en PROOF_RECEIVED y el comprobante se conserva como evidencia.

## START_PAYMENT_REVIEW

Es una transición de revisión, no una aprobación. No cambia inventario ni Opportunity y no produce `PAID`. Es idempotente a nivel de estado cuando Payment y Proof ya están UNDER_REVIEW.

## APPROVE_PAYMENT

Antes del commit se valida autorización, coherencia proof/payment/order y estado. La operación idempotente se marca STARTED antes de `commitInventory`. Solo una reserva ACTIVE se compromete.

Después se persisten Payment `PAID`, Proof aprobado, Order actualizado, Reservation `COMMITTED`, Opportunity `WON` y trazabilidad.

## REJECT_PAYMENT

Rechaza la evidencia/pago según la máquina de estado, pero no libera la reserva. El pedido puede continuar con un comprobante de reemplazo.

## CANCEL_ORDER

La idempotencia comienza antes de liberar inventario. Solo una reserva ACTIVE se libera. El retry COMPLETED no repite el efecto.

## EXPIRE_RESERVATION

Solo ACTIVE ejecuta release. Una reserva RELEASED, EXPIRED o COMMITTED no vuelve a mutar inventario.

## Limitación SAMPLE y evolución H4

La memoria no ofrece una transacción durable que abarque repositorios y sistemas externos. H4 incorporará Automation/Policy/Outbox; un backend productivo deberá implementar transacciones locales, claves idempotentes durables y/o outbox para efectos externos, con recuperación observable de operaciones STARTED.

Nunca debe resolverse esta limitación permitiendo que un agente generativo repita ciegamente una operación financiera o de inventario.
