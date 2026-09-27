# Modelo de automatización

La foundation define triggers, conditions y actions tipados, sin scheduler ni ejecución externa.

Triggers iniciales: pedido creado, pago confirmado, despacho, entrega, carrito abandonado y ventana de recompra. Actions: crear seguimiento, crear recompra, solicitar escalación y `SEND_MESSAGE_REQUEST`.

`SEND_MESSAGE_REQUEST` es una intención, no un envío. Un adapter de canal o GanoBot podrá consumirla más adelante bajo política y permisos. Verificar pagos siempre requiere una persona autorizada.
