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
| FLOES storefront and Admin | `https://floes-commerce-git-sandbox-floes-commerc-501a8a-diegox-s-proyec.vercel.app` |
| Chopify simulator | `https://chopify-git-sandbox-floes-commercial-202610-diegox-s-proyec.vercel.app/pilot-sandbox` |
| GanoBot runtime | `https://gano-bot-web-git-sandbox-floes-commercia-d6c86f-diegox-s-proyec.vercel.app` |

All three deployments are protected by Vercel Deployment Protection. Server-to-server calls use separate automation bypasses and sandbox-only API bearer tokens; no bypass values are embedded in the links. Vercel environment overrides are scoped to this Git branch and Preview only. Chopify and GanoBot use distinct tokens generated for this sandbox; FLOES and GanoBot call the stable Chopify branch alias, and Chopify calls the stable GanoBot branch alias.

The simulator route checks Preview environment isolation before any write. It seeds only the synthetic Daniela/Vino fixture in `floesCommerceSandboxState`. No Firestore read or write has been performed yet. Production aliases, environment scopes, Firebase credentials, and Meta/WhatsApp settings were not modified.

## Read/load minimization

The interactive sandbox is in-memory and performs no Firestore reads. For a later remote sandbox, keep Admin lists paginated, request only the current tenant and required fields, avoid realtime listeners for the pilot screens, and cache only safe, short-lived read snapshots. Inventory availability and payment/operation actions must remain fresh server-side checks; do not rely on a client cache for order acceptance.
