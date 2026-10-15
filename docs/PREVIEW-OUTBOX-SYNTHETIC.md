# Ejecución manual de outbox sintética en Preview

El endpoint existente sirve para ejecución manual autenticada. Para una prueba exclusivamente sintética, configurar estas variables **solo en Preview** del proyecto Chopify:

- `CHANNEL_OUTBOX_ENABLED=true`
- `CHANNEL_OUTBOX_TRANSPORT=synthetic`
- `CRON_SECRET` con un valor generado y guardado directamente en el gestor de secretos
- `CHOPIFY_COMMERCE_STATE_COLLECTION` con la colección aislada de Preview
- `FIREBASE_SERVICE_ACCOUNT_JSON` con una identidad de servicio de mínimo privilegio para el proyecto sandbox confirmado

Vercel provee `VERCEL_ENV=preview` para deployments Preview. El worker rechaza el modo sintético fuera de Preview, exige `POST` y el bearer `CRON_SECRET`, procesa únicamente el tenant `tenant-floes`, no carga sender maps, omite el outbox heredado y no instancia ningún transporte de proveedor. El acuse persistido se identifica como sintético (`SYNTHETIC_PREVIEW`); no representa un mensaje enviado a una persona.

Una vez que las variables anteriores estén configuradas y haya una fila sintética pendiente, la ejecución manual desde una estación con Node es:

```powershell
$env:CHOPIFY_PREVIEW_URL = 'https://<deployment-git-preview>.vercel.app'
$env:CRON_SECRET = '<leer desde el gestor de secretos; no copiar al historial>'
node .\scripts\run-preview-outbox.mjs
Remove-Item Env:CRON_SECRET
```

El script solo acepta hosts HTTPS de deployment Vercel que incluyen `-git-`, nunca el alias productivo. No imprime el secreto. Su respuesta incluye únicamente el modo de transporte, cantidad y contadores de estado.

## Activación continua sin contratar Vercel Pro

- **Ejecución manual:** un scheduler existente puede invocar el endpoint HTTPS con POST y el bearer secreto, usando exclusivamente el URL de deployment Preview y modo `synthetic`. Antes de elegirlo, validar su política de secretos, retención y frecuencia.
- **Vercel Hobby:** la configuración actual conserva una ejecución diaria; no equivale a despacho continuo. No comprar un plan ni cambiar la frecuencia sin autorización.

No activar mensajes de Meta, TikTok, WEB ni el outbox heredado desde esta ruta. Si se agrega una programación automática, debe limitarse al modo sintético hasta que exista una aprobación separada de proveedores y destinatarios de prueba.
