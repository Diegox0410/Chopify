# H3 Final QA
A. Opportunity ORDER_CREATED crea un solo Order y reserva inventario elegible.
B. PaymentProof: PROOF_RECEIVED → UNDER_REVIEW sin confirmar pago ni commit.
C. TENANT_OWNER aprueba: PAID + reservation COMMITTED + Opportunity WON; retry no duplica.
D. Rechazo no libera inventario y permite comprobante de reemplazo.
E. Cancelación/expiración libera solo ACTIVE y no dos veces.
F. Fulfillment de PAID: UNFULFILLED → PREPARING → READY → DISPATCHED → DELIVERED.
G. Tenant/permissions: sin mezcla de tenants; solo actores autorizados aprueban pago; FULFILLMENT opera logística.

Responsive manual: 1440 / 1024 / 390 px en Orders, Order Detail, Payment Review, Fulfillment y Exceptions.
Cierre técnico: tsc, lint, tests, build y git diff --check sin errores.
