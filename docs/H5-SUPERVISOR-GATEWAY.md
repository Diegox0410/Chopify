# H5 — Supervisor gateway

The Commerce gateway adds `requestHumanEscalation`. Tenant remains authenticated by the server header and conversationId comes from the GanoBot execution context. The operation writes through the persistent Commerce runtime, so escalation and conversation state are saved together with tenant state.

Payment review remains human-controlled.
