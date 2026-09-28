# H6 — Omnichannel Identity Gateway

`resolveCustomerIdentity` is now a first-class authenticated Commerce Gateway operation.

Flow:
GanoBot `commerce.resolveCustomerIdentity` → `ChopifyHttpAdapter` → `/api/commerce` → `CommerceGateway` → `CustomerIdentityResolver` → persistent Commerce state.

Security and consistency:
- tenant is accepted only from the authenticated server header;
- supported channels are WHATSAPP, INSTAGRAM, FACEBOOK, WEB and OTHER;
- identity resolution is tenant-scoped;
- the operation is treated as a mutation and persisted by `PersistentCommerceRuntime`;
- existing identities are reused;
- new channel identities can link to an existing tenant customer by normalized phone/email;
- no cross-tenant resolution is permitted.
