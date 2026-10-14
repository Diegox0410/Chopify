# H6 — Omnichannel Identity Gateway

`resolveCustomerIdentity` is now a first-class authenticated Commerce Gateway operation.

Flow:
GanoBot `commerce.resolveCustomerIdentity` → `ChopifyHttpAdapter` → `/api/commerce` → `CommerceGateway` → `CustomerIdentityResolver` → persistent Commerce state.

Security and consistency:
- tenant is accepted only from the authenticated server header;
- supported channels are WHATSAPP, INSTAGRAM, FACEBOOK, WEB, TIKTOK and OTHER;
- identity resolution is tenant-scoped;
- the operation is treated as a mutation and persisted by `PersistentCommerceRuntime`;
- existing identities are reused;
- new channel identities can link to an existing tenant customer by normalized phone/email;
- no cross-tenant resolution is permitted.

## GanoBot channel inbound

GanoBot sends non-WhatsApp inbound messages to `POST /api/channel-inbound`. WhatsApp remains on its existing Meta webhook route. The endpoint accepts only `WEB`, `INSTAGRAM`, `FACEBOOK`, and `TIKTOK`, with the corresponding providers `WEB`, `META`, and `TIKTOK`. Authentication uses a tenant-pinned Bearer token: `CHOPIFY_GANOBOT_INBOUND_TOKEN_FLOES`, `_MG`, or `_DGNG`. A token reused by multiple tenant configurations is rejected.

The JSON contract is `{tenantId, channel, provider, providerMessageId, externalConversationId, externalCustomerId, customer:{name?,phone?,email?}, text, receivedAt, acquisitionSource?, conversationId}`. Chopify verifies that the authenticated tenant matches `tenantId`, derives `conversationId` from tenant + provider + channel + external conversation ID, and requires the supplied value to match. `Idempotency-Key` must equal the lowercase SHA-256 hex digest of `tenantId:provider:channel:providerMessageId`. Inbound and conversation metadata are committed atomically to the existing live conversation collection. Duplicate provider messages return the original `{conversationId, customerId, duplicate:true}` without creating a new message or customer identity. Intake only records the message; it does not send a reply.

GanoBot resolves the tenant base URL from `CHOPIFY_API_BASE_URL_FLOES`, `_MG`, or `_DGNG` and posts to `/api/channel-inbound`. Configure these URL and token variables independently per environment. No shared URL or token fallback is used.

## GanoBot outbound history

Before returning a generated reply to its channel relay, GanoBot records it with `POST /api/channel-outbound` using the same tenant-pinned Bearer token. The envelope is `{tenantId, channel, provider, conversationId, customerId, messageId, correlationId, text, createdAt}`. The idempotency key is lowercase SHA-256 hex of `tenantId:conversationId:customerId:channel:correlationId`; the success response is `{conversationId, customerId, messageId, outboxId, status, duplicate}`. Chopify verifies that the authenticated tenant, conversation, customer, provider, and channel match the persisted thread and that GanoBot still owns the thread. The CRM `OUTBOUND` message, a tenant-scoped `CHANNEL_OUTBOX` record with stable ID/status `NOT_SENT`, and the thread update are committed atomically to the existing Firestore conversation collection. Duplicate keys replay the same outbox acknowledgement without creating another message or queue record. This records intent only: it does not call a channel provider or increment unread count, and no dispatcher is configured for this outbox. Human handoff or a closed thread blocks automated outbound recording.

The candidate includes a bounded tenant-scoped worker core with version-preconditioned claims, leases, and an injected transport interface. Only `NOT_SENT` and expired pre-send `CLAIMED` items are eligible. A worker atomically marks an item `SENDING` together with a thread send lease before calling the injected transport; this serializes send start with human takeover. It then records `SENT`, `FAILED`, or `UNKNOWN` with the CRM outbound record. A crashed pre-send claim can be reclaimed after its lease expires. A stale `SENDING` item is reconciled to `UNKNOWN` and is never retried blindly, because the process may have stopped after the provider accepted it. The worker is not wired to a scheduler, API route, or channel provider; no external messages are sent by this candidate.
