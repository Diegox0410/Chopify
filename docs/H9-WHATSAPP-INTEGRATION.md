# H9 — WhatsApp Business Platform

H9 introduce la frontera WhatsApp de Chopify sobre el checkpoint H8.

## Flujo
Meta webhook → extracción de mensajes de texto → `phone_number_id` → tenant → idempotencia por `wamid` → identidad WhatsApp → customer find/create → conversación activa find/create → GanoBot H8 → typed tools Chopify → respuesta → outbound adapter.

## Seguridad y autoridad
- El negocio se resuelve por `phone_number_id`; nunca por texto enviado por el cliente.
- La identidad externa se normaliza y queda aislada por tenant.
- El mismo provider message id no se procesa dos veces.
- GanoBot sigue sin autoridad para confirmar pagos.
- `MetaCloudWhatsAppAdapter` solo conoce envío HTTP; el token no pertenece al dominio ni debe persistirse en el cliente.
- Para producción, el webhook debe vivir en un runtime servidor/edge que mantenga secretos fuera del bundle Vite.
- El endpoint de verificación debe usar `verifyWebhookChallenge`.
- Antes de producción debe validarse la firma del webhook en la capa HTTP con el App Secret y conservar el body crudo. Esa validación deliberadamente no se simula en el navegador.

## SAMPLE vs producción
La pantalla `/whatsapp` utiliza `SampleWhatsAppAdapter`: no llama Meta ni envía mensajes reales. El adapter `MetaCloudWhatsAppAdapter` está listo para ser instanciado exclusivamente desde backend con un access token real.

## Configuración real necesaria
Para conectar FLOES: Meta Business / WhatsApp Business Account, `phone_number_id`, access token de servidor, verify token, App Secret, URL HTTPS pública del webhook y suscripción al campo `messages`.

## Criterio de cierre
H9 queda técnicamente cerrado cuando TypeScript, lint, tests, build y diff check pasan y el simulador demuestra tenant resolution, identidad, conversación, GanoBot, idempotencia y outbound. El primer envío real de Meta requiere credenciales y endpoint backend; no se deben introducir secretos en el frontend.
