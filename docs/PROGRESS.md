# Project Progress

Statuses: `in progress`, `not started`, `complete` (use complete only after that phase's acceptance criteria are met).

## Phase 0 — OpenCode setup and documentation
- **Status:** complete
- **Completed:** Created requested project instructions, minimal OpenCode config, specification, progress, decisions, handoff, README, and `.gitignore`; reviewed consistency against the Phase 0 scope.
- **Remaining:** None for Phase 0.
- **Verification:** Parsed `opencode.json` as JSON and confirmed all eight requested files exist. No application tests applicable; no dependencies installed.
- **Known blockers:** None. Git repository initialized on `main` during Phase 1; no commits yet.

## Phase 1 — Foundation, PostgreSQL, and authentication
- **Status:** complete
- **Completed:** npm workspaces and development scripts; Compose as optional PostgreSQL setup; `.env.example`; PostgreSQL Prisma migration and idempotent seed; Express JWT cookie authentication, CSRF, validation, rate limits and admin cashier APIs; Next.js login, guarded dashboard, user management and UI states; mock and PostgreSQL integration tests; local Git initialized on `main` without a commit.
- **Remaining:** None for Phase 1.
- **Verification:** `npm run db:migrate` applied the initial migration; latest `npx prisma migrate status` is up to date. `npm run db:seed` created admin and IDR settings; a second run preserved existing credentials. Seeded admin login, `/api/auth/me`, `/api/users`, logout, and revoked-cookie rejection passed against PostgreSQL. Latest `npm test` passed 9/9 (8 mock, 1 PostgreSQL); `npm run lint` and `npm run build` passed. Earlier browser click-through with temporary admin/cashier verified login, user creation/edit/activation, logout, cashier dashboard, and unauthorized route; test accounts were removed. `git check-ignore` confirms `.env`, `node_modules`, and `.next` are ignored.
- **Known blockers:** None for Phase 1. Git has no commits; files are untracked until developer commits. Prisma 6 reports a non-blocking deprecation warning for `package.json#prisma` seed configuration.

## Phase 2 — Product, category, and inventory management
- **Status:** complete
- **Completed:** Prisma category/product/stock movement/adjustment models, relationships, indexes and SQL constraints; migration applied; validated Express category/product/inventory endpoints with admin-only mutation and cashier-safe reads; atomic initial stock and stock adjustments; search, filters, pagination; `/products`, `/categories`, `/inventory` tables/forms/history and stock dialog; five demo categories, 18 clearly labeled fictional products and their initial movements.
- **Remaining:** None for Phase 2. Do not start Phase 3 without authorization.
- **Verification:** `npm run db:migrate` applied `20261027000000_catalog_inventory`; `npm run db:generate` passed after stopping old API watch processes; `npx prisma migrate status` up to date. `npm run db:seed` created 18 products, second run created 0. Latest `npm test` passed 10/10 (8 mock auth, 2 PostgreSQL integration), including duplicate SKU/barcode, negative price, cashier denial, search/pagination, atomic stock and concurrent decrement safety. `npm run lint` and `npm run build` passed. Browser exercised login, create/edit category, create/edit/search product, low-stock display, failed and successful adjustment, filtered movement history and logout; temporary records were deleted. No screenshot/mobile viewport capture was available in this browser environment.
- **Known blockers:** None for Phase 2. Prisma 6 warns about deprecated `package.json#prisma` config. Git still has no commits and all project files remain untracked; `.env` is ignored.

## Phase 3 — Cashier, checkout, transaction history, and receipts
- **Status:** complete
- **Completed:** Sale/item/payment schema and applied PostgreSQL migration; server-recalculated cash checkout, snapshots, transactional stock movements and request idempotency; POS, payment dialog, history and 80mm receipt UI; PostgreSQL integration tests and Playwright critical-flow tests.
- **Remaining:** None for Phase 3.
- **Verification:** `npm run db:migrate` applied `20261028000000_cash_sales` and generated Prisma Client; `npx prisma migrate status` confirms three applied migrations. Latest `npm test` passed 17/17, including PostgreSQL rollback/concurrent last-unit checkout/same-key retry, snapshots and receipt totals. `npm run lint` and production `npm run build` passed. Three Playwright E2E passed for full login/cart/cash payment/stock/receipt/history/print flow, lost-response recovery after reload, and price-change/error states. Desktop/mobile screenshots reviewed; print-media CSS and `window.print` invocation checked (no physical printer). Details: `docs/PHASE3_VERIFICATION.md`.
- **Known blockers:** None. Prisma 6 seed-config deprecation remains non-blocking. Git has no commits, all project files remain untracked; `.env` and test/build artifacts are ignored.

## Phase 4 — Dashboard, sales analytics, and Excel export
- **Status:** complete
- **Completed:** Admin-only PostgreSQL report endpoints, Jakarta date boundaries, aggregate/profit queries, snapshot categories, four-sheet ExcelJS export with limits; real dashboard, report filters/tables/charts and download UI.
- **Remaining:** None for Phase 4.
- **Verification:** `npm run db:migrate` applied `20261029000000_reporting_categories` and generated Prisma Client; migrate status reports four migrations up to date. Latest `npm test` passed 24/24 (seven new real PostgreSQL report/export tests), `npm run lint` and `npm run build` passed. Five Playwright E2E passed including prior checkout regression, real admin overview, daily/monthly filters, valid downloaded XLSX, empty/error/retry states, 390px report layout and cashier denial. Screenshots reviewed. Details: `docs/PHASE4_VERIFICATION.md`.
- **Known blockers:** None. Pre-Phase-4 category snapshots are backfilled from current catalog at migration time, not historical categories that were never recorded. Prisma 6 seed-config deprecation remains non-blocking. Git has no commits; project files untracked and `.env`/artifacts ignored.

## Phase 5 — Supplier management and purchase orders
- **Status:** complete
- **Completed:** Supplier and PO/item models/migration; admin supplier search/details/deactivation and history; version-guarded drafts and ordering; full-order serializable/idempotent receiving; supplier, purchase list/builder/detail UI with stock references.
- **Remaining:** None for Phase 5.
- **Verification:** `npm run db:migrate` applied `20261030000000_suppliers_restocking` and generated Prisma Client; `npx prisma migrate status` confirms five migrations up to date. Latest `npm test` passed 33/33, including nine real-PostgreSQL purchase tests for validation, roles, versions, snapshots, rollback, overflow, duplicate/concurrent receiving and concurrent different-PO stock increments. `npm run lint` and `npm run build` passed. Full Playwright regression passed 7/7, including two purchase scenarios for supplier CRUD, multi-product drafts, ordering/receiving, stock references, 390px layout, dropped-response retry and cashier denial. Desktop/mobile screenshots reviewed, including regenerated mobile movement rows. Details: `docs/PHASE5_VERIFICATION.md`.
- **Known blockers:** None. Draft creation has no idempotency key; inspect history after an uncertain save. Prisma 6 seed-config deprecation remains non-blocking. Git has no commits; project files remain untracked, with `.env` and generated artifacts ignored.

## Phase 6 — Barcode scanner and keyboard shortcuts
- **Status:** complete
- **Completed:** Exact barcode filter on existing product list endpoint, preserving cashier visibility; Enter-based keyboard-emulation scanner lookup with serialized scans, quantity increments, stock limits, unknown/inactive/out-of-stock feedback and checkout lock while lookup is pending. POS-only F2 search focus and F4 checkout; app-level F8 transactions; form/dialog guards, modifier/repeat guards and listener cleanup. F6/F7 shown as reserved and left inactive. Cart stock display and editable quantity handling improved; payment dialog focuses cash input and then receipt link, with focus restored to search on close. No camera scanning or Phase 7 cart-hold behavior.
- **Remaining:** None for Phase 6.
- **Verification:** Focused PostgreSQL catalog test passed, including exact barcode and cashier/inactive visibility. Focused Playwright scanner/shortcut scenario passed, covering rapid/repeated scans, stock cap, errors, shortcut contexts and listener counts across navigation. Full `npm test` 33/33, `npm run lint`, production `npm run build`, and full Playwright regression 8/8 passed. See `docs/PHASE6_VERIFICATION.md`.
- **Known blockers:** None. Cashier sees the same non-disclosing message for an unknown barcode and an inactive product. Existing non-blocking Prisma 6 config warning remains.

## Phase 7 — Hold and resume cart
- **Status:** complete
- **Completed:** PostgreSQL HeldCart/HeldCartItem schema, status/lease constraints, sale link and applied migration. Authenticated owner-scoped hold/list/detail/resume/discard APIs with admin read access. Hold snapshots current prices without reserving inventory; resume claims one session and returns current price/stock/activity review. Existing serializable cash checkout conditionally completes the claimed cart in the same sale transaction, with unique sale-per-cart and existing sale-key replay. POS label/hold/discard/review dialogs, count/updated times, explicit re-confirmation, F6/F7, and uncertain-payment recovery. Successful logins no longer consume the failed-login rate limit; failed attempts still cap at ten per 15 minutes.
- **Remaining:** None for Phase 7.
- **Verification:** `npm run db:migrate` applied `20261031000000_held_carts` and generated Prisma Client; `npx prisma migrate status` reports six up to date. Focused held-cart PostgreSQL integration tests 8/8 and auth rate-limit test passed; latest full `npm test` **42/42**. `npm run lint`, `npm run build` and full Playwright **11/11** passed. E2E covers persistence after reload, review of changed price/stock/inactive products, discard confirmation, F6/F7, completed sale and dropped-response replay. Details: `docs/PHASE7_VERIFICATION.md`.
- **Known blockers:** None. A resume claim expires after 30 minutes and must be re-reviewed before checkout; an uncertain initial hold response is not automatically idempotent. Non-blocking Prisma 6 config warning remains.

## Phase 8 — Security audit, testing, and UI refinement
- **Status:** complete
- **Completed:** Audited auth/session/cookie/CSRF/CORS, every API mutation's authentication/role/ownership boundary, server-side IDR/stock/checkout/PO/held-cart invariants, frontend operational states and responsive/print/export flows, query bounds/indexes and client bundle inputs. Reproduced an unauthorized catalog cost-price disclosure through PostgreSQL integration tests, then restricted cashier product list/detail fields while preserving admin fields. Added real-browser admin product creation, invalid and valid stock adjustment, low-stock and cashier-denial coverage; expanded auth security regression tests for expiration, production cookie flags, origin/CSRF, inactive users and mutation route matrix. No deployment or unrelated features.
- **Remaining:** No Phase 8 implementation tasks. Operational limitations and untested production environment controls are documented in `docs/PHASE8_VERIFICATION.md`.
- **Verification:** Focused PostgreSQL catalog and auth integration tests passed after the fix; focused Playwright catalog 2/2. Final `npm test` **43/43** across eight suites, `npm run lint`, `npm run build`, full Playwright **13/13**, `npx prisma migrate status` (six migrations current), and static client-bundle marker search passed. See `docs/PHASE8_VERIFICATION.md`.
- **Known blockers:** None for the local Phase 8 scope. This is not evidence of production security: HTTPS/proxy configuration, distributed rate-limit persistence, load testing and external security assessment remain outside the tested environment.

## Phase 9 — Local readiness and portfolio documentation
- **Status:** complete (local scope only; no deployment)
- **Completed:** Verified existing npm workspace scripts, ports, `.env.example`, ignored secrets, optional database-only Compose, PostgreSQL schema/migrations and localhost CORS. Extended dev-only seed with a fictional supplier, received and ordered POs, cash sale and linked stock movements without resetting accounts or duplicating receipt/deduction on rerun. Added demo-only Playwright screenshot capture and seven genuine app screenshots. Rewrote English README with setup, architecture, API, troubleshooting, screenshots and limitations; added `docs/DEMO_GUIDE.md` and `docs/PORTFOLIO.md`. Preserved the existing application and security architecture.
- **Remaining:** No Phase 9 local deliverables. Public deployment and production security assessment are deferred and require separate authorization. Physical printer output, optional Compose startup on this machine, and a completely fresh empty-database seed were not directly exercised; documented commands remain available.
- **Verification:** `npx prisma migrate status`: six migrations up to date; `npm run db:seed` first created a received PO and sale, subsequent runs skipped both, then created the ordered PO and skipped it on the next run; database counts and movement links checked. `PATH="/c/Windows/System32:$PATH" npm run dev` served web/API at `3000`/`4000` (HTTP 200, exact local CORS and CSRF cookie); `npm run screenshots:local` captured seven actual views, dashboard chart visually reviewed. `npm test` **43/43**, `npm run lint`, `NEXT_DIST_DIR=.next-e2e npm run build` and full Playwright **13/13** passed. `node --check` passed for both new/modified scripts and `git diff --check` passed. The first unprefixed `npm run dev` failed because this Bash harness PATH omitted Windows System32; the prefixed rerun worked. Playwright independently exercised cashier/admin flows and XLSX/receipt/stock/PO/held-cart cases.
- **Known blockers:** None for localhost. Prisma 6 emits a non-blocking `package.json#prisma` deprecation warning. Database-only Compose was not started because local PostgreSQL was already running. No fixed demo credentials were committed; choose them in ignored `.env` and create Cashier through Admin UI.
