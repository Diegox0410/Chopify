# FLOES commercial sandbox activation

This note records the safe local sandbox and the remaining Preview/Firebase work. It contains no credentials.

## Local interactive sandbox

Run two terminals from `C:\Users\User\Desktop\Chopify`:

1. `npm run pilot:sandbox`
2. `npm run dev -- --host 127.0.0.1 --port 5173`

Open `http://127.0.0.1:5173/pilot-sandbox`.

The sandbox listens only on loopback, seeds a conspicuously synthetic Daniela/Vino fixture, uses `MemoryCommerceStateStore`, and blocks outbound network requests. It does not initialize Firebase, Storage, Meta, WhatsApp, or Vercel Preview. Restarting the sandbox clears its data. The FLOES product photo is read from the local FLOES repository without copying or modifying the original asset.

## Firebase inventory and safe target

Dedicated Firebase project `floes-commercial-sandbox-2026` is provisioned with its own default Firestore database in `nam5`; deletion protection is enabled. The `floes-sandbox-runtime` service account has Firestore data access scoped to this project, and its credential is configured only on the sandbox Preview branch in Chopify and GanoBot. The web app configuration also points to this Firebase project.

Cloud Storage was not created because the project has no billing account and enabling paid storage was declined. The pilot represents a receipt with a fake reference and never uploads a file. Firestore records are fixed to `tenant-floes`; production service credentials and Production environment scopes remain unchanged. The server Admin SDK uses the sandbox-only service account; no direct browser writes are required.

Suggested initial client security rules for that dedicated project (server Admin SDK calls still require least-privilege IAM):

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
```

Use the same deny-by-default posture for direct Storage access. If the Preview UI needs proof uploads, expose a tenant- and owner-validated server upload path backed only by the sandbox bucket; do not enable broad client writes. The local sandbox uses a fake in-memory receipt reference and needs no upload bucket.

## Preview targets inspected

Current READY deployments for branch `sandbox/floes-commercial-202610`:

| Project | READY Preview |
|---|---|
| FLOES storefront and Admin | `https://floes-commerce-p1abfserz-diegox-s-proyec.vercel.app` |
| Chopify simulator | `https://chopify-git-sandbox-floes-commercial-202610-diegox-s-proyec.vercel.app/pilot-sandbox` |
| GanoBot runtime | `https://gano-bot-web-git-sandbox-floes-commercia-d6c86f-diegox-s-proyec.vercel.app` |

All three deployments are protected by Vercel Deployment Protection. Server-to-server calls use separate automation bypasses and sandbox-only API bearer tokens; no bypass values are embedded in the links. Vercel environment overrides are scoped to this Git branch and Preview only. Chopify and GanoBot use distinct tokens generated for this sandbox; FLOES and GanoBot call the stable Chopify branch alias, and Chopify calls the stable GanoBot branch alias.

The remote simulator route checks Preview environment isolation before any write. It seeds only the synthetic Daniela/Vino fixture in `floesCommerceSandboxState`.

## Remote Preview verification — 12 October 2026

The following results were observed through the project-specific Vercel protection bypasses. Bypass values and credentials were not logged or added to links.

| Check | Result | Evidence |
|---|---|---|
| Chopify Preview isolation | PASS | `/api/pilot-sandbox?action=health` returned HTTP 200, `ready=true`, Firebase project `floes-commercial-sandbox-2026`, collection `floesCommerceSandboxState`, tenant `tenant-floes`. |
| FLOES → Chopify | PASS | FLOES `/api/catalog?tenant=tenant-floes` returned HTTP 200 with 5 products after fixture seed. `/api/store-config` returned HTTP 200 and `whatsappPurchaseEnabled=true`; a public WhatsApp number is present but not recorded here. |
| GanoBot Preview health/auth | PASS | `/api/health` returned HTTP 200. The live conversation endpoint returned HTTP 200 after aligning the branch-only bearer and commerce credentials. |
| Daniela/Vino/M image and caption | PASS | A new synthetic conversation selected the fixture product, Vino, and M; returned the Chopify Preview image and a caption with the synthetic price/stock data. |
| Stock | PASS | Direct read-only Chopify `checkAvailability` returned M available, quantity 2 before order creation. After one draft order reserved one unit, it returned quantity 1. |
| Order and fake proof | PASS | Test order `order-e7148af3-9e20-4008-a794-0f1abc494004`; fake transfer proof reached `PROOF_RECEIVED` and appeared in Owner payment reviews. |
| Admin operation contract | PASS | The simulator's authenticated Chopify Owner reads/actions approved the fake proof, started preparation, marked ready, recorded fictitious dispatch, and delivered the order. Final status: `PAID` / `DELIVERED` / `COMPLETED`. No money, carrier, or customer message was sent. |
| Post-sale | PASS | GanoBot recorded the synthetic customer's satisfaction follow-up for the delivered order. |
| FLOES Admin route | READY; OWNER UID CONFIGURED | `/admin` returns HTTP 200. The Firebase Owner UID supplied by the user is configured as branch-specific Preview overrides for both `VITE_OWNER_UID` and `FLOES_OWNER_UID`, and the deployment was rebuilt afterward. Login itself remains unverified because the password stays private with the user. |

The Admin page and its branch-scoped Owner configuration are ready. The user must sign in at `/admin` using the Firebase Authentication account created in `floes-commercial-sandbox-2026`; no password was requested or stored. Owner login was not tested from this session.

One earlier live attempt returned `503 LIVE_UNAVAILABLE`: runtime logs identified `GanoBot → Chopify resolveCustomerIdentity` receiving HTTP 401 because Chopify Preview preferred an inherited `CHOPIFY_PREVIEW_E2E_COMMERCE_TOKEN` over the branch token. Preview-only branch overrides were aligned and rebuilt. The simulator also stopped sending `x-vercel-set-bypass-cookie: true` (which caused redirect loops) and now sends bypass credentials only in headers. Production environment scopes and deployments were not changed.

Cloud Storage remains unconfigured because billing was declined. The receipt is a fake reference only. No WhatsApp/Meta, real payment, or Production service was used. A sandbox Firestore document, synthetic customers, fixture, order, payment-review record, fulfillment transitions, and post-sale follow-up were created only in the isolated sandbox project.

Latest functional links (Vercel Deployment Protection still applies):

- FLOES storefront: `https://floes-commerce-p1abfserz-diegox-s-proyec.vercel.app`
- FLOES Admin login: `https://floes-commerce-p1abfserz-diegox-s-proyec.vercel.app/admin`
- Commercial simulator: `https://chopify-git-sandbox-floes-commercial-202610-diegox-s-proyec.vercel.app/pilot-sandbox`

## Read/load minimization

The local interactive harness is in-memory and performs no Firestore reads. The remote Preview simulator uses the sandbox Firestore document and performs server-side state reads/writes when its Owner operations run. Keep Admin lists paginated, request only the current tenant and required fields, avoid realtime listeners for the pilot screens, and cache only safe, short-lived read snapshots. Inventory availability and payment/operation actions must remain fresh server-side checks; do not rely on a client cache for order acceptance.
