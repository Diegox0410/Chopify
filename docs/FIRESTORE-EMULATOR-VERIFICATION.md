# Verificación local del adaptador Firestore

Este procedimiento solo usa Firestore Emulator en loopback y el proyecto `demo-floes-sandbox`. No usa cuenta de servicio ni realiza llamadas a un proyecto remoto.

## Iniciar y escribir el fixture

En una consola PowerShell:

```powershell
java -jar "$env:USERPROFILE\.cache\firebase\emulators\cloud-firestore-emulator-v1.22.0.jar" --host=127.0.0.1 --port=8081 --project_id=demo-floes-sandbox
```

En otra consola desde la raíz de Chopify:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8081'
$env:FIREBASE_PROJECT_ID = 'demo-floes-sandbox'
node --import tsx .\scripts\verify-firestore-emulator.ts seed
```

Se espera `SYNTHETIC_STATE_WRITE_READ=PASS` para el documento sintético `tenant-floes`.

## Exportar, reiniciar e importar

Con el emulador aún ejecutándose, exportar a una carpeta temporal local:

```powershell
$exportDir = Join-Path $env:TEMP 'floes-emulator-api-export'
$body = @{ database = 'projects/demo-floes-sandbox/databases/(default)'; export_directory = $exportDir; export_name = 'firestore_export' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8081/emulator/v1/projects/demo-floes-sandbox:export' -ContentType 'application/json' -Body $body
```

Detener el proceso del emulador y reiniciarlo con el archivo `firestore_export.overall_export_metadata` generado:

```powershell
java -jar "$env:USERPROFILE\.cache\firebase\emulators\cloud-firestore-emulator-v1.22.0.jar" --host=127.0.0.1 --port=8081 --project_id=demo-floes-sandbox --seed_from_export="$env:TEMP\floes-emulator-api-export\firestore_export\firestore_export.overall_export_metadata"
```

En la consola Chopify, conservar las dos variables anteriores y ejecutar:

```powershell
node --import tsx .\scripts\verify-firestore-emulator.ts recover
```

Se espera `EXPORTED_STATE_RECOVERY=PASS`. El script valida host/proyecto exactos y nunca crea o modifica Production.

## Resultado y límites conocidos

Round-trip, recuperación tras export/import, y escritura posterior con precondición de versión pasaron contra Firestore Emulator 1.22.0. La primera implementación intentó `PATCH` con `currentDocument.updateTime`; el emulador devolvió HTTP 400 `FAILED_PRECONDITION`. Se cambió a `documents:commit` con `currentDocument.updateTime`, que sí aplicó el control y la nueva versión correctamente. La prueba unitaria también confirma que el adapter manda esa precondición al endpoint de commit.

El archivo de reglas encontrado en `ganobot-commerce/firestore.rules` está vacío, así que este procedimiento no valida reglas ni roles de Auth. La recuperación y control de concurrencia demostrados son locales; no acreditan el Firestore de Preview.
