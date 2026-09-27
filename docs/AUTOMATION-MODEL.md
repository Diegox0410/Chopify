# H4 — Automation Engine + Policy Engine + Outbox

H4 convierte los contratos iniciales de automatización en un motor SAMPLE ejecutable y tenant-aware.

Flujo autoritativo:

`AutomationEvent → active rules → conditions → Policy Engine → Outbox → Executor → execution log`

## Reglas
Cada `AutomationDefinition` pertenece a exactamente un `tenantId`. Un evento de FLOES solo puede evaluar reglas de FLOES. El mismo motor sirve MG, DGNG y tenants futuros; las diferencias pertenecen a configuración, no a forks del producto.

## Política y autonomía
Niveles: 0 observa, 1 requiere humano, 2 automatización segura, 3 proactividad autorizada, 4 recomendaciones optimizadas. H4 SAMPLE usa nivel 2. `SEND_MESSAGE_REQUEST` crea intención de mensaje; no es un envío de WhatsApp. La verificación/aprobación de pagos permanece humana y fuera del Automation Engine.

## Outbox
Estados: `PENDING → PROCESSING → SENT`, o `PROCESSING → FAILED → retry`; al agotar intentos pasa a `DEAD_LETTER`. La clave lógica `tenantId + sourceEventId + automationId + actionType` evita duplicar acciones por reentrega del mismo evento.

## Executor
H4 usa `NoopAutomationExecutor`: valida la frontera y registra ejecución sin tocar servicios externos. H9 sustituirá esta implementación por adapters de canal. Esto evita acoplar reglas de negocio a WhatsApp/Meta.

## SAMPLE
La UI `/automations` permite inspeccionar reglas, simular `PAYMENT_CONFIRMED`, procesar el outbox y pausar/activar reglas. Es demostración en memoria; recargar reinicia el estado.
