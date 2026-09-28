CHOPIFY H9 LIVE FLOES — ZIP de reemplazo sobre commit 4073270

Copiar carpetas api/, docs/, tests/ y archivos vercel.json y .env.live.example a C:\Users\User\Desktop\Chopify.
NO borrar src/. NO sustituir package.json ni package-lock.json. No requiere instalar dependencias nuevas.

Abrir docs/H9-LIVE-FLOES.md ANTES de desplegar.
Este bloque instala un puente LIVE seguro, persistente en Firestore y con salida real Meta; NO convierte el núcleo SAMPLE de GanoBot/CRM/pedidos en producción.
Sin GANOBOT_LIVE_URL, responde un acuse de recibo para derivación humana. Mantener el primer piloto supervisado.

QA local: node --test tests/live-webhook.test.mjs && npx tsc --noEmit && npm run lint && npm test -- --run && npm run build
No hacer commit de secretos.
