# FLOES commercial sandbox activation

This note records the safe local sandbox and the remaining Preview/Firebase work. It contains no credentials.

## Local interactive sandbox

Run two terminals from `C:\Users\User\Desktop\Chopify`:

1. `npm run pilot:sandbox`
2. `npm run dev -- --host 127.0.0.1 --port 5173`

Open `http://127.0.0.1:5173/pilot-sandbox`.

The sandbox listens only on loopback, seeds a conspicuously synthetic Daniela/Vino fixture, uses `MemoryCommerceStateStore`, and blocks outbound network requests. It does not initialize Firebase, Storage, Meta, WhatsApp, or Vercel Preview. Restarting the sandbox clears its data. The FLOES product photo is read from the local FLOES repository without copying or modifying the original asset.

## Firebase inventory and safe target

Firebase CLI lists these active projects: `chopify-f9b1c`, `dgng-store`, `floes-commerce`, `gano-sim-premium`, and `mgtrataseccommerce`. None is explicitly identified as a dedicated FLOES pilot sandbox. `floes-commerce`, `chopify-f9b1c`, and `gano-sim-premium` are associated with existing services; do not use them for commercial sandbox writes. A Preview collection inside Chopify's shared Firebase project is not sufficient isolation because it shares project quota and Storage configuration.

No Firebase project, Firestore database, Storage bucket, service account, or rules were created or changed. To enable remote Preview writes safely, choose or authorize a new dedicated Firebase project, then provision its Firestore and Storage there. Create a distinct server credential scoped to that sandbox project/bucket; never copy Production credentials. Keep all records fixed to `tenant-floes` and reject a tenant supplied by an untrusted client.

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

Latest READY Preview deployments from the current Vercel listing:

| Project | READY Preview |
|---|---|
| FLOES | `https://floes-commerce-jyzgmh1fk-diegox-s-proyec.vercel.app` |
| Chopify | `https://chopify-lpui11ncd-diegox-s-proyec.vercel.app` |
| GanoBot | `https://gano-bot-edc75gy1m-diegox-s-proyec.vercel.app` |

The deployment hosts are SSO protected; no remote API calls were made. The previously inspected GanoBot Preview `CHOPIFY_COMMERCE_BASE_URL` points to an older Chopify Preview. FLOES Preview's `CHOPIFY_BASE_URL` is masked by Vercel as a Secret, so its current target could not be verified. The bypass variables remain server-side and must be the corresponding project-scoped Preview values; never put them in Vite client variables.

After authorization, the Preview-only target value for both service base URL settings should be the Chopify host in the table above. Verify the Vercel env scopes and owner/bypass access first, then deploy only the affected Preview projects to activate them. No Production scope or Production alias should be changed.

## Read/load minimization

The interactive sandbox is in-memory and performs no Firestore reads. For a later remote sandbox, keep Admin lists paginated, request only the current tenant and required fields, avoid realtime listeners for the pilot screens, and cache only safe, short-lived read snapshots. Inventory availability and payment/operation actions must remain fresh server-side checks; do not rely on a client cache for order acceptance.
