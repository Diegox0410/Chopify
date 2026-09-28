# H6 — Omnichannel Customer Identity

`CustomerIdentityResolver` makes customer identity tenant-scoped and channel-aware.

Rules:
- WhatsApp identifiers are normalized to digits.
- Other external channel identifiers are trimmed and lower-cased.
- Exact tenant + channel + externalIdentifier wins.
- If the identity is new, an existing tenant customer may be linked by normalized phone or normalized email.
- Otherwise a new LEAD customer and identity are created.
- Identical external identifiers in different tenants remain independent.
- No cross-tenant identity resolution is allowed.

Channels remain: WHATSAPP, INSTAGRAM, FACEBOOK, WEB, OTHER.
