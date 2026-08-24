# services/guardrails

Standalone Python service running NeMo Guardrails (input rails at pipeline stage 3,
execution rails at stage 8), per `docs/PRD.md` §7.

Not yet scaffolded — built at **M6** (Hardening). The TypeScript deterministic
"floor" that this service layers on top of (event-count cap, date-range sanity, the
invitee gate, mutation-scope guard, field-conformance) is built earlier, at M0–M1,
in `packages/core/src/validators/`. This service must derive its rail thresholds
from those same constants rather than reimplementing them independently — see the
build plan's M6.1 for the shared-config approach.
