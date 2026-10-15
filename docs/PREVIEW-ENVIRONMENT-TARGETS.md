# Vercel Preview environment target names

This document records integration variable names only. Do not store values here or commit a populated `.env` file.

For Preview branch `codex/preview-final-chopify`, scope Preview credentials to that branch and use the dedicated Firebase sandbox project. Keep Production values in the Production scope only. Never copy the sandbox service account into Production or a Production account into Preview.

GanoBot inbound integration is configured per tenant with server-only variables:

- `CHOPIFY_GANOBOT_INBOUND_TOKEN_FLOES`, `CHOPIFY_GANOBOT_INBOUND_TOKEN_MG`, `CHOPIFY_GANOBOT_INBOUND_TOKEN_DGNG`
- `CHOPIFY_API_BASE_URL_FLOES`, `CHOPIFY_API_BASE_URL_MG`, `CHOPIFY_API_BASE_URL_DGNG`

For this FLOES Preview acceptance, configure only the FLOES pair and restrict tenant allowlists to `tenant-floes`. Leave MG and DGNG values unset in this Preview deployment. Do not enable a real messaging destination. Configure and verify secret values only in Vercel's environment settings; this repository intentionally contains names, not values.

Before deployment, verify Preview and Production scopes separately and confirm the Preview branch resolves to the approved sandbox Firebase project. The prior scope inspection showed the sandbox settings on a different branch; that mismatch must be corrected before deployment.
