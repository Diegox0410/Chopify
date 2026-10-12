# FLOES + Chopify + GanoBot — preparación de piloto comercial

**Fecha de auditoría:** 11 de octubre de 2026  
**Alcance:** lectura de configuración local y código, pruebas sintéticas existentes y preparación de datos.  
**Resultado:** preparación parcial. Las conexiones Preview no se pudieron confirmar y no se hizo ninguna escritura comercial.

## Estado resumido

| Componente | Estado | Evidencia | Bloqueo / acción pendiente |
|---|---|---|---|
| FLOES local → Chopify Preview, `GET /api/catalog?tenant=tenant-floes` | **BLOQUEADO** | Local respondió HTTP 503 con el mensaje de configuración del proxy Vite. | Faltan `FLOES_PREVIEW_BASE_URL` y `FLOES_PREVIEW_BYPASS_SECRET` en el entorno local del repo FLOES. El request no llegó al handler FLOES ni a Chopify. |
| FLOES local → `GET /api/store-config` | **BLOQUEADO** | HTTP 503 generado por el middleware local antes del handler. | Mismo par del proxy FLOES. |
| FLOES Preview vigente | **NO VERIFICADO** | El repo FLOES está enlazado localmente a un proyecto Vercel de nombre `floes-commerce`; la CLI Vercel no está instalada en esta máquina. | No se verificó cuál deployment Preview está READY/Current, su protección ni sus variables runtime. |
| Chopify Preview vigente | **NO VERIFICADO** | El repo local Chopify no tiene enlace Vercel disponible; la CLI Vercel no está instalada. | El propietario debe iniciar sesión con la CLI y enlazar el proyecto Vercel Chopify existente. |
| FLOES → Chopify Preview configurado en backend | **NO VERIFICADO** | El código usa `CHOPIFY_BASE_URL`; el snapshot local viejo `.vercel/.env.preview.local` observado antes no prueba el entorno runtime vigente. | Verificar dominio Preview READY y bypass del proyecto correspondiente. No reutilizar URLs antiguas. |
| Tenant FLOES | **IMPLEMENTADO EN CÓDIGO / RUNTIME NO VERIFICADO** | El backend FLOES fija `tenant-floes`; Chopify solo sirve catálogo público para una lista que incluye ese tenant y en Preview tiene un allowlist predeterminado. | Confirmar configuración runtime actual, sin mezclar otro tenant. |
| WhatsApp público FLOES | **NO VERIFICADO / FALTA EN SNAPSHOTS LOCALES** | `api/store-config.ts` lee `FLOES_WHATSAPP_NUMBER`; el valor falta en `.env.local` y en el snapshot local de Preview examinado. | El propietario debe añadir el número oficial en el proyecto FLOES, scope Preview, y redeployar ese entorno si corresponde. No copiar números de otro tenant. |
| Chopify → Firebase | **LECTURA IMPLEMENTADA / ENTORNO Y CUOTA NO VERIFICADOS** | `api/catalog.ts` lee un estado persistido de tenant en Firestore. | Verificar con el propietario a qué proyecto Firestore apunta cada deployment, que Preview no comparta Production y que la cuota esté disponible antes de probar. |
| GanoBot → Chopify | **CONTRATO IMPLEMENTADO / CONEXIÓN PREVIEW NO VERIFICADA** | El adaptador de GanoBot llama el contrato commerce de Chopify y exige identidad de tenant. | Faltan runtime URLs/auth confirmados, salud de ambos Preview y una prueba segura que no escriba. |
| Catálogo de 12 modelos | **PLANTILLA PREPARADA / DATOS PENDIENTES** | Los 12 nombres están en la hoja Modelos; la hoja Importar no contiene filas de producto. | Esperar fotografías aprobadas, variantes, precios, stock, características y medidas. Mantener todo sin publicar. |
| Pedidos | **NO PROBADO** | No se creó ningún pedido. | Requiere Firebase de prueba aislado y autorización explícita. |

El Vite proxy de FLOES solo autoriza lecturas GET para endpoints configurados y no tiene fallback a Production. En esta auditoría respondió antes de que la llamada llegara a un servicio remoto. No se intentaron escrituras ni se consultaron deployments antiguos.

## Cómo desbloquear Preview sin compartir secretos

La CLI Vercel no está instalada. Cuando el propietario pueda autorizar el acceso desde esta máquina:

1. En PowerShell, instalar e iniciar sesión:
   ```powershell
   npm install --global vercel@latest
   vercel login
   vercel whoami
   ```
2. En `C:\Users\User\floes-commerce`, usar `vercel link` y seleccionar el proyecto FLOES ya existente. El directorio ya conserva su enlace local.
3. En `C:\Users\User\Desktop\Chopify`, usar `vercel link` y seleccionar el proyecto Chopify existente. No crear un proyecto nuevo ni ejecutar `vercel deploy`.
4. En cada repo enlazado, `vercel ls` permite revisar deployments recientes. Inspeccionar el dominio del deployment objetivo y su estado antes de usarlo.
5. En el Dashboard, confirmar protección y crear/copiar el bypass de automatización del proyecto correspondiente. El bypass debe guardarse localmente, en un archivo ignorado, nunca en el navegador ni en el chat. FLOES y Chopify tienen bypasses distintos.
6. Preparar el archivo local de variables Preview solo cuando no vaya a sobrescribir un archivo existente. No mostrar sus valores. Confirmar URL, target, presencia y longitud de valores de forma redactada.
7. Solo después de verificar que Preview no comparte el Firebase de Production, repetir las lecturas GET y confirmar la ruta observada hasta Chopify.

Vercel documenta que el bypass se puede enviar como el header `x-vercel-protection-bypass`; el uso de query parameter se reserva para servicios que no pueden enviar headers, porque expone el secreto en la URL. [Documentación de bypass de Vercel](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation), [CLI Vercel](https://vercel.com/docs/cli).

## Importación de catálogo

### Contrato que consume Chopify

El parser encuentra la primera hoja con encabezados `nombre_producto` y `sku` dentro de las primeras 30 filas. La hoja **Importar** del XLSX usa los 31 encabezados exactos del importador. Está vacía debajo de la fila de encabezado; no se debe cargar el workbook vacío.

| Campo | Regla verificada |
|---|---|
| `nombre_producto` | Obligatorio; usar el nombre del modelo autorizado. |
| `sku` | Obligatorio y único por variante. Reimportar el mismo SKU actualiza esa variante; no repetir un SKU en el archivo. El SKU de variante no puede coincidir con el SKU padre del producto. |
| `color` | Etiqueta comercial aprobada; variantes del mismo nombre de modelo se agrupan en una ficha de producto. |
| `talla` | Lista que reconoce el importador. Para stock actual por talla y color, `stock_individual_por_talla_y_por_color` replica el mismo número a todas las tallas listadas. No usarlo cuando el inventario de tallas sea distinto. |
| `precio_venta`, `precio_promocional`, `moneda` | La moneda ISO es obligatoria. Los precios son opcionales en el esquema, pero sin un precio confirmado el producto queda pendiente de precio/no debe venderse. La promoción debe ser menor al precio regular. |
| `activo` | Obligatorio. Usar `NO` mientras el propietario no autorice publicación. `SI` hace que una variante quede activa/visible; no importar como activa antes de la autorización. |
| `disponible`, `tipo_entrega`, stock | Stock positivo no debe declararse hasta que exista una cantidad aprobada. El importador convierte entrega en modo de fulfillment; no inferir “bajo pedido” por ausencia de stock. |
| `imagen_1`–`imagen_4` | Acepta URL HTTPS o referencias resueltas por el manifiesto de activos. El importador conserva imágenes de una variante reimportada si la fila no proporciona otras. |
| `guia_tallas` | Texto o JSON validado. JSON requiere `measurement: "FLAT_GARMENT_CM"`; filas por talla con `measurementsCm` y valores numéricos positivos. |
| Notas y material | Características y material se convierten en datos comerciales; `notas_ganobot` son contexto para el asesor. No poner información interna en campos públicos. |

### Riesgos que impiden usar ya la carga

- **Stock diferente por talla:** el importador solo distribuye un stock común a todas las tallas de esa variante. Crear una fila por talla con el mismo color generaría variantes duplicadas/ambiguas y no está aprobado como workaround. Hace falta una mejora acotada del contrato/importador para aceptar cantidades individuales por talla.
- **Tres fotografías:** el esquema permite hasta cuatro imágenes por variante, pero el flujo UI actual no envía los bytes de los archivos seleccionados al endpoint `catalog-assets`. El proveedor estático resuelve un archivo único por `modelo/color.jpeg`; el proveedor Firebase guarda por `modelo/color/hash` y su lectura de referencia elige el objeto más reciente. No hay una asociación validada de tres vistas editoriales distintas para una misma variante. No cargar fotos hasta definir/validar una clave de vista o una galería estable.
- **Publicación:** `activo=SI` publica la variante. La importación persiste el catálogo; no usarla como “guardar borrador” si los datos no están completos. El checklist mantiene `NO PUBLICAR`.
- **Guías:** la vista de catálogo aplica una guía global de FLOES cuando faltan componentes de la guía del producto. Cada modelo debe tener guía propia confirmada antes de publicar si sus medidas difieren; no aceptar silenciosamente el fallback genérico.

### Idempotencia comprobada en código/tests

La vista previa coteja SKU de variante, identifica el modelo por nombre/slug y agrupa filas por modelo. El adaptador existente conserva el inventario vendido/reservado al reimportar el mismo SKU y rechaza un stock inicial cambiado tras actividad. Los tests sintéticos existentes cubren importación repetida, SKU duplicado, aislamiento de tenant, stock por talla común y reserva/venta de una talla. Esos tests usan memoria/fakes; **no prueban Firestore Preview ni una importación real**.

## Fotografías y catálogo

La plantilla incluye tres campos por modelo para registrar los nombres de las tres fotografías que entregará el propietario. No incluye fotografías ni filas importables con precios o stock. Las rutas originales no se alteraron.

Para cargar cada foto de manera segura se debe cerrar primero el contrato de galería: identificador de modelo + variante/color + posición (principal, secundaria, detalle), URL pública aprobada y fallback de imagen existente. No sobrescribir `catalogo/floes/<modelo>/<color>.jpeg` para guardar vistas alternativas.

## Esquema de guía de medidas

Usar una guía por modelo en la hoja **Guías de talla**, con solo medidas entregadas y aprobadas. La representación que acepta el importador es:

- `measurement`: literal `FLAT_GARMENT_CM`.
- `instructions`: cómo colocar y medir la prenda.
- `blouse`: lista de registros con `size` y `measurementsCm`.
- `trousers`: lista de registros con `size` y `measurementsCm`.
- Claves de medidas: los nombres que entregue FLOES para ese modelo; cada valor debe ser número positivo en centímetros.

Explicar que las medidas se toman horizontalmente con la prenda extendida y en plano. Son medidas de la prenda, no contornos corporales. Si la medida fue tomada de lado a lado en plano, **no multiplicar por dos** al compararla con la guía existente. No recomendar talla cuando faltan valores comparables o la guía no corresponde a ese modelo.

## GanoBot como asesor comercial

**Implementado en el contrato/código inspeccionado:** GanoBot consume datos de catálogo de Chopify, filtra variantes activas/visibles y consulta tallas/disponibilidad entregadas por el adaptador; el contrato de herramientas cubre consulta, preparación de pedido y seguimiento. El runtime hosted configura repositorio de conversaciones, limitador y auditoría en Firestore.

**Configuración conversacional a confirmar con los datos reales:**

1. Saludar y preguntar necesidad de uso/ajuste sin adivinar preferencia.
2. Recomendar solo modelos/materiales/características que aparezcan verificados en catálogo.
3. Mostrar solo colores y variantes que Chopify devuelva activas.
4. Consultar de nuevo la combinación modelo + color + talla antes de afirmar disponibilidad.
5. Explicar guía del modelo, unidades y método plano; solicitar ayuda humana si faltan medidas.
6. Confirmar modelo, color, talla, cantidad, precio y moneda antes de iniciar una operación comercial.
7. No declarar pago aprobado; el comprobante queda pendiente de revisión humana.
8. No descontar inventario fuera del flujo de Chopify ni crear oportunidad/pedido solo por preguntas informativas.
9. Limitar datos a `tenant-floes`; no usar notas internas en mensajes al cliente.
10. Si catálogo o servicio no está disponible, decirlo y escalar sin inventar una alternativa.

Los scripts/harnesses de conversación revisados usan fixtures. No simulan conexión real a WhatsApp Meta ni prueban el runtime GanoBot Preview.

## Auditoría y estimación de Firestore Spark

### Lo que puede afirmarse por código

- Chopify `GET /api/catalog` llama el runtime persistente para el tenant; el store REST lee un documento de estado completo por tenant desde Firestore.
- Una lectura sin estado guardado o con esquema legado puede inicializar/migrar y guardar estado aun al ejecutar una operación de lectura. Por eso, antes de habilitar Preview hay que revisar el estado destino con solo lectura y demostrar que usa un proyecto Firestore de prueba.
- Una mutación exitosa normalmente hace lectura del documento + escritura de estado. Los conflictos pueden volver a leer/reintentar hasta cuatro intentos.
- El runtime hosted de GanoBot conecta el repositorio de conversaciones, limitador de solicitudes y auditoría con Firestore. Un turno puede tocar varios documentos/transacciones y el costo varía con reintentos y configuración; no hay telemetría medida aquí.
- No se pudo leer el usage dashboard del propietario. No hay conteos reales de lecturas/escrituras que sustenten un pronóstico de facturación.

### Escenario solo catálogo

Supuesto explícito: cada visita carga el catálogo exactamente una vez, el documento de estado ya existe y está en el esquema actual; no hay chats, login, filtros que disparen nuevas peticiones, ni checkout. Bajo ese supuesto el backend Chopify hace 1 lectura de documento por llamada `/api/catalog` y 0 escrituras.

| Visitas/día | GET de catálogo/día (supuesto) | Lecturas Firestore estimadas/día | Escrituras estimadas/día | % de cuota gratis de lecturas |
|---:|---:|---:|---:|---:|
| 100 | 100 | 100 | 0 | 0,2 % |
| 500 | 500 | 500 | 0 | 1,0 % |
| 1.000 | 1.000 | 1.000 | 0 | 2,0 % |

Si el navegador vuelve a solicitar catálogo dos veces por visita, duplicar las lecturas de la tabla. Si falta el documento o hay migración, sumar la inicialización/escritura que aplique. Conversaciones, rate limiting, auditoría, importación, login, seguimiento y pedidos quedan fuera de este escenario. No es telemetría observada y no demuestra que la cuota actual esté disponible.

Firebase documenta para Firestore Standard una cuota sin costo de 50.000 lecturas/día, 20.000 escrituras/día, 20.000 eliminaciones/día, 1 GiB almacenado y 10 GiB/mes de egreso; la cuota se reinicia alrededor de la medianoche del Pacífico y aplica a una sola base de datos por proyecto. La actividad de todos los servicios/apps del proyecto comparte el consumo. [Cuotas y facturación de Firestore](https://firebase.google.com/docs/firestore/pricing), [planes Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

### Optimización segura recomendada

- Mantener catálogo público como GET cacheable con TTL/invalidation solo después de confirmar la fuente de verdad y sin cachear inventario mutable más allá del límite aceptable.
- Cargar configuración pública desde env y mantenerla independiente de lecturas Firestore.
- Evitar cargar catálogo de nuevo por cada render; medir peticiones reales con Network y deduplicar por sesión si no compromete stock/precio.
- Mantener lecturas del backend en consultas por tenant y limitar campos/tamaño; el documento actual guarda estado serializado completo, un posible límite de tamaño/costo.
- Revalidar stock/precio en Chopify al crear pedido; no confiar en el catálogo cacheado para reservar.
- Medir después del reset de cuota y en Firebase de prueba: reads, writes, bytes del estado, conflictos, número de turnos, eventos de rate limit y logs. No repetir llamadas contra Production mientras la cuota esté agotada.

## Matriz de prueba comercial segura

**Precondición para cualquier escritura:** proyectos Firebase aislados de Production, deployment Preview identificado, protección/bypass verificados, datos de prueba autorizados y botón de importación deshabilitado hasta aprobar catálogo.

| # | Caso | Resultado esperado | Tipo de prueba / estado |
|---:|---|---|---|
| 1 | Importar un modelo con `activo=NO` y SKU aprobado | Se guarda sin hacerlo visible ni comprable; previsualización sin errores. | Sintética de importer parcialmente cubierta; runtime Preview pendiente. |
| 2 | Publicar con aprobación explícita del propietario | Aparece una sola ficha FLOES con variantes reales. | Pendiente; requiere sandbox aislado y autorización. |
| 3 | Elegir color existente | Nombre/color e imágenes vinculados a esa variante. | Pendiente; galería de tres vistas bloqueada por el contrato de activos. |
| 4 | Elegir talla existente | Talla mostrada solo si corresponde a variante real. | Lógica sintética cubierta en parte; frontend Preview pendiente. |
| 5 | Consultar stock de combinación | Cantidad viene de inventario Chopify actual. | Memoria/fake cubierta en parte; runtime Preview pendiente. |
| 6 | Añadir al carrito | Solo variante/talla válida y stock suficiente. | Frontend local/manual y Preview pendientes. |
| 7 | Validar checkout | Revalidación de precio e inventario; no enviar pedido en esta fase. | Pendiente; no ejecutar en Production. |
| 8 | Registrar cliente | Escritura únicamente en Firestore de prueba. | Pendiente; una operación mutante. |
| 9 | Adjuntar comprobante pendiente | Estado pendiente; sin aprobar pago ni inventario. | Pendiente; requiere storage/backend de prueba. |
| 10 | Revisión humana | Admin aprueba/rechaza con identidad y auditoría. | Pendiente; usar fixture/usuario de prueba. |
| 11 | Preparar y despachar | Solo transición posterior a pago aprobado y pedido de prueba. | Pendiente; no hacer envíos reales. |
| 12 | GanoBot consulta estado | Devuelve el estado real del mismo tenant/pedido y escala si falta. | Harness sintético; endpoint Preview y aislamiento pendientes. |

## Implementado, probado y pendiente

**Implementado en código inspeccionado**

- Contrato GET de catálogo con tenant explícito y `tenant-floes`.
- Importador valida nombres, SKU, moneda, activo, tallas y datos monetarios; las reimportaciones empatan por SKU de variante.
- Chopify mantiene la fuente de verdad comercial y el runtime GanoBot usa el adaptador commerce.
- Configuración pública de WhatsApp se sirve por `/api/store-config` desde `FLOES_WHATSAPP_NUMBER`.
- Los repositorios conservan los cambios previos; no se editaron archivos de la tienda en esta preparación.

**Probado en esta sesión**

- GET local a `/api/catalog?tenant=tenant-floes`: HTTP 503 del pre-handler proxy Vite, sin llegar a Chopify.
- GET local a `/api/store-config`: HTTP 503 del mismo pre-handler.
- Inspección de parser/importer, persistencia de estado, almacenamiento de activos, guías y conexiones GanoBot.
- La plantilla XLSX se exportó, se inspeccionaron sus hojas/rangos y se renderizaron para control visual.
- Sin Vercel CLI autenticada no se probaron endpoints Preview protegidos.
- No se tocó Production, no se desplegó, no se importó, no se escribió en Firestore y no se creó pedido.

**Pendiente**

1. Propietario instala/inicia sesión Vercel CLI y enlaza el proyecto Chopify existente; obtener deployment READY vigente y protección/bypass de cada proyecto sin publicar secretos.
2. Confirmar URLs Preview runtime y que Preview use Firestore aislado; comprobar que GET catalog/store-config llega a sus handlers y a Chopify.
3. Configurar `FLOES_WHATSAPP_NUMBER` solo en FLOES Preview con el número público oficial y comprobar el CTA generado.
4. Corregir/validar carga de tres imágenes por variante, sin sobrescribir rutas de activos.
5. Ampliar el importador para existencias desiguales por talla o confirmar que todas las tallas de cada variante parten del mismo stock.
6. Sustituir fallback de talla por validación explícita por modelo cuando las medidas difieran.
7. Completar el catálogo con datos aprobados, mantener `activo=NO`, revisar vista previa y obtener autorización antes de publicar.
8. Correr matriz de compra únicamente en Firebase sandbox. La cuota de Production agotada no se debe retestar hasta su reset.

## Recomendación de aislamiento mínimo

Crear un proyecto Firebase de prueba y credenciales de Preview independientes para Chopify y GanoBot; configurar allí los servicios Preview. FLOES Preview debe apuntar únicamente a esos Preview. Confirmar por IDs de proyecto (no por nombres de deployment), reglas y service account que ningún Preview escribe en los proyectos de Production. Después seedear datos sintéticos no comerciales en sandbox y probar importación, reservas y pedido de prueba. No usar un tenant separado dentro del mismo proyecto Production como sustituto del aislamiento.

## Archivos/referencias examinados

- Chopify: `src/application/catalogImport.ts`, `src/application/catalogFiles.ts`, `src/application/commerceRuntime.ts`, `src/infrastructure/firestoreCommerceStateStore.ts`, `src/infrastructure/catalogImageStorage.ts`, `src/infrastructure/publicCatalogStorage.ts`, `api/catalog.ts`, `api/catalog-assets.ts`, `src/features/catalog/CatalogImportPanel.tsx`, `src/application/catalogImport.test.ts`.
- FLOES: `vite.config.ts`, `api/catalog.ts`, `api/store-config.ts`, `api/_lib/chopify.ts`.
- GanoBot: `apps/functions/src/commerce/catalogTools.ts`, `apps/functions/src/commerce/chopifyHttpAdapter.ts`, `scripts/gano-hosted-runtime.mjs`, `apps/functions/src/integrations/firestoreConversationRepository.ts`, `apps/functions/src/integrations/firestoreRateLimiter.ts`, `apps/functions/src/integrations/firestoreRequestAuditSink.ts`.
