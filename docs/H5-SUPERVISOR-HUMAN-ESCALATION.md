# H5 — Supervisor + Human Escalation

H5 introduces a deterministic operations supervisor over Chopify commercial state.

States: BOT_RESOLVED, SALE_IN_PROGRESS, WAITING_CUSTOMER, PAYMENT_PENDING, HUMAN_REQUIRED, COMPLAINT, NO_INTEREST, SALE_CLOSED.

Human queue is exception-first. Complaint and payment review are surfaced without giving automation authority to approve payments. Escalations are tenant-scoped and duplicate open escalations for the same conversation/reason are idempotent.

The supervisor does not replace CommercePort and does not infer payment approval.
