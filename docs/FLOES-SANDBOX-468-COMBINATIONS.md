# FLOES sandbox base combinations

The source is the owner-provided `FLOES_Catalogo_Maestro_Bot.xlsx`, sheet `468 combinaciones`. Its SHA-256 is `4189db7aed838e0031c7e444b28683e79c4be2266b9bf1ee661bbbc87376fd45`.

The import preserves all 468 combinations: 12 blouse models × 13 colors × 3 pants types. The size options XS–XL come from the companion product template's documented general size list; the combination sheet does not define model-specific size applicability. They remain unverified options pending Owner validation. Every imported row is marked `PENDING_OWNER_CATALOG_VALIDATION`; price and `stockBySize` are null and `inventoryVerified` is false. This dataset cannot authorize a sale.

The generator reads the workbook and emits a JSON manifest with a deterministic ID for each model/color/pants choice, workbook/sheet traceability, and the workbook hash:

```powershell
npm run build:floes-base-combinations -- 'C:\path\to\FLOES_Catalogo_Maestro_Bot.xlsx'
```

The Firestore importer is hard-limited to `FIRESTORE_EMULATOR_HOST=127.0.0.1:8081` and `FIREBASE_PROJECT_ID=demo-floes-sandbox`. It upserts fixed document IDs in `floesBaseCombinationsSandbox`; reruns do not create duplicates. It refuses any remote host or non-demo project:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8081'
$env:FIREBASE_PROJECT_ID = 'demo-floes-sandbox'
npm run import:floes-combinations:emulator
```

The API variant contract now includes `pantsType` and `inventoryVerified`. A stock variant is marked verified only when the runtime inventory adapter supplies a quantity; each size retains its own `NOT_CONFIGURED`, `AVAILABLE`, or `OUT_OF_STOCK` state. The unverified 468-row source is kept separate from saleable inventory and approved prices.

## Firestore-backed synthetic commercial E2E

`src/application/pilotIntegration.test.ts` can run its existing 17-stage integration against actual local Firestore and Auth Emulators. It uses a short-lived synthetic Owner identity, a synthetic product/stock fixture, an in-memory transport harness for external channels, and the real Chopify/FLOES API handlers plus GanoBot commerce tools. The test's local Owner API calls pass through `requireFloesOwner`, which asks Auth Emulator to validate the ID token and checks the configured Owner UID. It then creates a fresh Firestore store instance and verifies the persisted order, approved test payment, proof, delivery, and satisfied follow-up.

```powershell
$env:PILOT_FIRESTORE_EMULATOR = '1'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8081'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:FIREBASE_PROJECT_ID = 'demo-floes-sandbox'
$env:CHOPIFY_COMMERCE_STATE_COLLECTION = 'chopifyPilotE2eAccepted'
npx vitest run src/application/pilotIntegration.test.ts
```

This is local emulator acceptance, not a connected Preview or browser acceptance. No real payment, carrier, or customer message is involved.
