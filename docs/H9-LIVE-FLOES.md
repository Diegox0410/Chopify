# Chopify H9 LIVE — FLOES (server-only overlay)

## Alcance y límites verificables

Este ZIP se copia **encima** del checkout limpio de Chopify H9 `4073270`. Agrega funciones Vercel `/api/webhook` y `/api/dispatch`, almacenamiento durable Firestore mediante API REST, validación de firma Meta HMAC SHA-256, deduplicación de `wamid`, mapeo exclusivo del número FLOES, outbox durable y envío Cloud API. No modifica las pantallas SAMPLE ni conecta por sí solo el núcleo comercial React a una base de datos real.

**Importante:** `GANOBOT_LIVE_URL` es un contrato para un backend REAL autenticado, no la URL de la SPA ni del GANO_SIM. Si no existe ese backend, el sistema responde únicamente un acuse de recibo con derivación humana; no inventa precios, existencias ni pedidos. Esto permite verificar el primer ciclo real Meta → Chopify → Meta de forma segura, pero **no** afirmar que GanoBot comercial ni los pedidos LIVE están integrados hasta implementar el adaptador comercial persistente y su endpoint. El dashboard `/whatsapp` sigue mostrando datos SAMPLE, no mensajes reales.

## Requisitos previos

1. Tener un proyecto Firebase/Firestore **dedicado a Chopify LIVE**, con facturación/cuotas adecuadas, y una cuenta de servicio con acceso restringido a Firestore. No usar credenciales del frontend.
2. Tener el número FLOES correctamente registrado/activo para Cloud API en Meta; en capturas anteriores el número figuraba PENDIENTE. Haber solicitado el nombre comercial no prueba registro/activación.
3. Desplegar **el repositorio Chopify** en un proyecto Vercel propio; no sobrescribir `floes-commerce.vercel.app`.
4. Configurar en Vercel → Project → Settings → Environment Variables (Production) los valores del archivo `.env.live.example`. `FIREBASE_SERVICE_ACCOUNT_JSON` es el JSON íntegro en una variable secreta. `META_WHATSAPP_ACCESS_TOKEN` debe ser un token adecuado de servidor, no temporal de prueba. Nunca compartir tokens, App Secret, JSON de cuenta de servicio ni `CHOPIFY_DISPATCH_SECRET` en chats, GitHub o capturas.
5. `META_GRAPH_VERSION` debe verificarse con la versión Cloud API actualmente soportada en la consola Meta antes del primer envío. El valor `v23.0` es el valor histórico de H9, no una afirmación sobre la versión más reciente.

## Meta

En la aplicación **Chopify FLOES**, configurar WhatsApp → Configuración → Webhooks:

- URL de devolución de llamada: `https://<TU-PROYECTO-CHOPIFY>.vercel.app/api/webhook`
- Token de verificación: exactamente el valor de `META_WHATSAPP_VERIFY_TOKEN` configurado en Vercel.
- Suscribirse al campo `messages` de la cuenta WhatsApp Business correcta. Confirmar el `phone_number_id` real del número FLOES. El valor inicial del ZIP es `1294544567080136`, leído de la captura del administrador.

**No** colocar el App Secret como verify token. El GET challenge usa el verify token; cada POST firmado usa el App Secret.

## Endpoint GanoBot LIVE opcional

`GANOBOT_LIVE_URL` debe ser HTTPS y aceptar POST con `Authorization: Bearer <GANOBOT_LIVE_BEARER_TOKEN>`, body:

```json
{"tenantId":"tenant-floes","channel":"WHATSAPP","providerMessageId":"wamid...","customer":{"phone":"593...","name":"..."},"text":"Hola"}
```

Respuesta: `{"reply":"Texto validado y autorizado por el backend comercial"}`. Ese backend debe implementar idempotencia y las reglas H3: no confirmar pagos automáticamente, usar catálogo/precios/stock reales, y escalar a humano. **No** apuntar a un endpoint improvisado ni exponer el token al navegador. En ausencia de este backend, dejar `GANOBOT_LIVE_URL` vacío.

## Operación, reintentos y auditoría

- POST Meta: firma sobre bytes originales, tamaño máximo 1 MiB en stream, solo mensajes de texto para `phone_number_id` FLOES; `wamid` se almacena una vez.
- Firestore `chopifyWhatsAppLive/in_<sha256(wamid)>`: entrada. `out_<sha256(wamid)>`: salida. `claim_<sha256(outId)>`: reserva durable antes de enviar.
- Los envíos que quedan `UNKNOWN` o `SENDING` **no** se reintentan automáticamente: primero reconciliar contra Meta, para evitar duplicar mensajes cuando un timeout ocurrió después de un envío aceptado. Los errores del endpoint GanoBot quedan `NEEDS_HUMAN`; revisar manualmente.
- Si se cae el webhook antes de procesar una entrada ya persistida, el reenvío Meta se reconoce como duplicado; hay que revisar el documento de entrada y resolverlo operativamente. Esta versión no garantiza entrega exactamente una vez de extremo a extremo.
- `POST /api/dispatch` con header `Authorization: Bearer <CHOPIFY_DISPATCH_SECRET>` envía hasta 20 salidas `PENDING`. Programar invocación externa protegida solo después de validar el primer envío. No usar un cron público sin autorización.
- Las notificaciones de estado `delivered/read` y los medios (imagen/audio) todavía requieren adaptadores y bandeja humana. No presentar el piloto como sistema omnicanal terminado.

## Pruebas y comandos

Desde CMD en `C:\Users\User\Desktop\Chopify`:

```cmd
node --test tests/live-webhook.test.mjs
npx tsc --noEmit
npm run lint
npm test -- --run
npm run build
git diff --check
git status --short --branch
```

Después de configurar variables en Vercel, desplegar; probar GET challenge desde Meta, luego enviar **un** WhatsApp real de un teléfono externo al número FLOES y verificar en Firestore `in_`, `out_`, `claim_`. Si el número sigue pendiente, completar su registro antes de probar. No hacer `git add .` hasta comprobar que ningún `.env` ni JSON de cuenta de servicio esté en el árbol de trabajo.

## Revisión previa a producción

El primer envío de prueba debe supervisarse. Revisar Firestore IAM y cuotas, políticas de privacidad/retención de números y mensajes, ventanas de conversación/plantillas, consentimiento, calidad del número y manejo humano. La conexión GanoBot/Commerce LIVE necesita backend y repositorios persistentes; este ZIP entrega el puente seguro sin fingir que esos componentes ya existen.
