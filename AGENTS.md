# Stockly POS — Agent Instructions

- Work one roadmap phase at a time; Phase 0 is documentation/configuration only.
- At task start, check scope, read relevant docs, inspect Git status, and inspect only relevant files.
- Use JavaScript ES modules and JSX only. Do not create `.ts` or `.tsx` files.
- Follow the stack and architecture in `docs/PROJECT_SPEC.md`; Express REST API is the backend and PostgreSQL is mandatory.
- Never add Supabase, Firebase, NextAuth, external auth providers, SQLite, microservices, Redis, GraphQL, or payment gateways.
- Enforce backend authorization and validation; keep JWT in HttpOnly cookies and secrets out of frontend code.
- Preserve integer IDR amounts, price snapshots, transactional stock changes, and duplicate-operation protections.
- Follow the Modern Retail Utility design direction and accessibility/usability priorities in `docs/PROJECT_SPEC.md`.
- Run focused verification first; report only commands and tests actually executed. Do not install dependencies unless needed for the requested phase.
- Preserve user changes; never force-push, reset, or discard work. Do not create commits unless requested.
- After meaningful milestones, update `docs/PROGRESS.md` and concise actionable `docs/HANDOFF.md`.
- Before handoff, record current phase, changed files, verification, blockers, next exact task, and Git status when known.

## Project references

- Product, architecture, business rules, acceptance criteria, and roadmap: `docs/PROJECT_SPEC.md`
- Phase checklist and verification: `docs/PROGRESS.md`
- Architecture decisions: `docs/DECISIONS.md`
- Cross-session continuation: `docs/HANDOFF.md`
