# Roadmap

| Hito | Estado | Alcance |
|---|---|---|
| H0 Foundation | Hecho | Stack, capas, shell, contratos y QA |
| H1 Multi-tenant Commercial Core | Hecho | Modelos tenant-scoped y reglas comerciales puras |
| H2 CRM + Opportunities | Hecho | CRM, conversaciones, pipeline, tareas, notas y adapter SAMPLE tenant-aware |
| H3 Orders + Attribution | Hecho | Pedidos, snapshots, atribución, reservas, verificación humana de pago, fulfillment, UI operacional y QA |
| H4 Automation Engine | En progreso | Evaluador tenant-aware, Policy Engine, Outbox, retry/dead-letter, executor SAMPLE, observabilidad y UI |
| H5 Super Admin | Pendiente | Módulos completos, filtros y detalle |
| H6 Billing / Settlements | Pendiente | Ciclos de liquidación y ajustes |
| H7 Content Operations | Pendiente | Calendario y workflow editorial |
| H8 GanoBot Integration | Pendiente | Cliente autorizado de application ports |
| H9 WhatsApp Integration | Pendiente | Adapter de canal |
| H10 MG Pilot | Pendiente | Integración controlada |
| H11 DGNG Pilot | Pendiente | Integración controlada |
| H12 FLOES Pilot | Pendiente | Integración controlada |

H3 está cerrado en el checkpoint `d4b83ad`. H4 permanece “En progreso” hasta validar TypeScript, lint, suite completa, build, diff-check y QA responsive de `/automations`.

FLOES es el tenant de smoke test preferido por disponibilidad operativa, pero H4 no contiene lógica exclusiva de FLOES: MG, DGNG y tenants futuros consumen el mismo motor mediante configuración tenant-aware.
