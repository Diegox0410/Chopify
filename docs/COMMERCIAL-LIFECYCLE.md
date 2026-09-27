# Ciclo comercial

`Customer → Conversation → Opportunity → Order → ManagedSale → Settlement`

1. Una oportunidad registra intención antes del pedido y aplica transiciones deterministas.
2. El pedido referencia, sin reemplazar, al pedido externo del tenant.
3. Attribution separa adquisición, canal de conversión y quién gestionó la venta.
4. ManagedSale congela el acuerdo comercial usado y calcula la base sobre subtotal de productos menos descuentos atribuibles. Envío e impuestos quedan fuera.
5. El comprobante recibido deja el pago en `PROOF_RECEIVED`; solo una aprobación humana explícita produce `PAID`.
6. Settlement agrupa fees en líneas auditables; no es facturación fiscal.
