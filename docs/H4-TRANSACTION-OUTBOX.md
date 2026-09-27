# H4 — Frontera transaccional y Outbox

El motor nunca llama directamente a un canal externo mientras evalúa reglas. Primero persiste un `OutboxEvent`; un executor separado consume ese trabajo. En producción, la persistencia del cambio de negocio y del evento durable deberá coordinarse mediante una frontera transaccional adecuada al adapter.

En SAMPLE todo vive en memoria. No se afirma atomicidad distribuida. Los reintentos incrementan `attempts`; fallos recuperables quedan `FAILED`; el límite produce `DEAD_LETTER`. Una ejecución `SENT` no se vuelve a ejecutar.

H4 no contiene credenciales, SDK de Meta, Firebase productivo ni scheduler remoto. Esas implementaciones deben respetar estos contratos.
