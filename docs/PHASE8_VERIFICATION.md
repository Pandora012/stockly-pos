# Phase 8 stabilization audit (local environment)

This is a code and local-regression audit, not a claim that the application is production-secure. No deployment was attempted.

## Security and authorization

| Boundary | Evidence and outcome |
| --- | --- |
| JWT and sessions | HS256 with issuer/audience, 8-hour expiry and 8-hour cookie. Middleware reloads the user and checks `isActive` and `sessionVersion` on every protected request. Logout, cashier password change or deactivation revoke issued sessions through version increments. Expired JWT, logout replay and deactivation tested against PostgreSQL. |
| Cookies | Session is HttpOnly, `SameSite=Lax` by default; production configuration marks session and CSRF cookies Secure and supports configured `SameSite=None`. CSRF cookie must remain readable to the frontend; it does not contain the JWT. Cookie assertions run in mock/PG tests, not a real TLS proxy. |
| CSRF and CORS | All POST/PUT/PATCH/DELETE require a signed double-submit token and reject mismatched Origin; CORS supplies only the configured web origin with credentials. Missing token and hostile origin tested. No claim against same-origin XSS. |
| Password and throttling | bcrypt hash for new/reset passwords (12 rounds); mismatched passwords compare against a dummy hash. Ten failed login attempts per 15 minutes per process/IP, with successful logins excluded. Rate-limit behavior tested; shared/distributed enforcement is not implemented. |
| Mutation matrix | `/api/auth/login` requires CSRF; `/api/auth/logout` requires CSRF and active authentication; `/api/users` POST/PATCH, `/api/categories` POST/PATCH, `/api/products` POST/PATCH, `/api/inventory/adjustments` POST, `/api/suppliers` POST/PATCH and `/api/purchases` POST/PATCH/order/receive require active ADMIN. Integration matrix tests each admin mutation as CASHIER (403) and guest with valid CSRF (401). `/api/sales` POST requires active authenticated user and server-calculated totals; `/api/held-carts` POST/resume/DELETE require authentication plus owner checks. Report/export reads are ADMIN only; cashier receipt/history is owner-only, admin may read all. |
| Client secrets | Frontend source uses only `NEXT_PUBLIC_API_URL`, no JWT/database secret references. Static production and E2E bundle marker search found no `JWT_SECRET`, `DATABASE_URL` or `passwordHash`. This is a targeted marker scan, not a proof that arbitrary secret strings are absent. |
| Cost disclosure | **Confirmed and fixed:** cashier `/api/products` list/detail returned `purchasePrice` because both roles shared full-row Prisma queries. A failing PostgreSQL test reproduced it. Explicit cashier selection now excludes purchase cost/admin metadata; admin editing payload remains unchanged. |

## Financial and inventory consistency

- Integer IDR totals use bounded safe integers and BigInt intermediate calculations, including tax rounding. Checkout obtains prices/tax/discount bounds on the server, requires expected total and sufficient cash, and saves item/category/store/cashier/cost snapshots. Invoices have UUID suffixes and a unique index; sale idempotency keys and request hashes reject altered replays.
- Checkout is Serializable: a sale, payment, each conditional nonnegative stock decrement and its stock movement commit together. Existing tests cover last-unit concurrency, rollback after injected ledger failure and receipt snapshots after product edits. PostgreSQL CHECK constraints reject negative stock and inconsistent movements.
- PO order uses version checks, immutable snapshots at ordering and full receiving through Serializable, conditional stock updates and corresponding movements. Re-receiving returns a replay without another increment; tests cover concurrent receipt, stock limits, rollback and cross-PO concurrency.
- Held carts do not reserve stock. Owner-scoped leases/status and unique `Sale.heldCartId` prevent a second completion; checkout verifies individual reviewed prices, current stock and lease, and commits COMPLETED alongside the sale. Concurrent resume/checkout and dropped-response recovery are covered. Initial hold and standalone adjustment POSTs do **not** have idempotency keys; after an uncertain response, inspect the list/ledger before retrying.

## Browser coverage and UI

| Requested critical flow | Browser evidence |
| --- | --- |
| Admin login | `catalog.spec.js`, `purchases.spec.js`, `reports.spec.js` log in via the real form. |
| Create product | `catalog.spec.js`: invalid form, persisted creation and initial movement. |
| Adjust stock | `catalog.spec.js`: focused dialog, negative-stock rejection, successful movement and low-stock warning. |
| Cashier checkout | `checkout.spec.js`: integer cash totals, receipt, print and dropped-response replay. |
| Transaction history | `checkout.spec.js`: invoice search, receipt detail/reprint; PG test denies other cashiers. |
| Hold and resume | `checkout.spec.js`: reload, changed price/stock/activity review, discard and single-sale recovery. |
| Supplier purchase and receive | `purchases.spec.js`: supplier CRUD, PO draft/order/receive, ledger, lost-response retry and cashier denial. |
| Excel export | `reports.spec.js`: actual workbook download and cell assertions, admin dashboard/error/empty states and cashier denial. |

Mobile no-document-overflow checks cover catalog/inventory at 390px, POS/receipt, held-cart review, purchase detail and reports. Tables use local horizontal scrolling, print hides navigation, primary controls use 44px minimum height, and native dialogs/visible focus/feedback are exercised in the above browser paths. The established palette, Inter type and compact tables were retained. These flows do not replace exhaustive assistive-technology or device testing.

**Scoped UI delivery gate:** Hard gates PASS for tested 390px no-overflow, real form/dialog actions, empty/loading/error states and visible keyboard focus; supported by catalog, checkout, purchase and report browser scenarios. Purpose gate PASS: no new decorative asset, animation, palette or dashboard surface was introduced. Liveliness PASS: ENERGY 1 / RHYTHM 2 / MOTION 1 follows the existing physical-store workbench direction, with the sale/cart hierarchy as its focal point. Craftsmanship PASS for the tested interactions: invalid product form shows errors, stock dialog rejects a negative result and records a valid one, receipt prints, Excel downloads, and cashier denial appears. This gate covers the critical flows above, not every UI control or an accessibility certification.

## Performance review

- Catalog, inventory/movements, sales history, supplier/PO lists, held carts and sold-products reports have capped page sizes. Exports cap at 10,000 sales/products and 93 days; series/category aggregates are bounded by date and group limits. Relevant date, status, owner, product and reference indexes exist in the six applied migrations.
- Purchase/checkout updates deliberately perform per-item conditional writes and movements inside transactions (each input max 100). No unbounded N+1 HTTP endpoint was introduced in Phase 8; POS explicit cart refresh issues one detail request per item (maximum 100). Query timing was not benchmarked, so no speculative cache/index/refactor was added.
- Category and user-management lists are not paginated. Substring searches over names/SKUs are not backed by trigram indexes. For larger stores, measure p95 query times and result cardinality first, then add pagination/indexes if justified. In-process login/export rate limiters are not shared across replicas.

## Executed verification

- Baseline `npm test`: 42/42; baseline `PATH="/c/Windows/System32:$PATH" npm run test:e2e -- --reporter=line`: 11/11.
- Reproduction: `npm run test -w @stockly/api -- test/catalog.integration.test.js` failed because cashier product response included `purchasePrice`; after the projection change the same focused test passed.
- `npm run test -w @stockly/api -- test/auth.integration.test.js` passed after security matrix additions. Focused `npm run test -w @stockly/api -- test/auth.test.js` passed 10/10. Focused `PATH="/c/Windows/System32:$PATH" npx playwright test tests/e2e/catalog.spec.js --reporter=line` passed 2/2.
- Final `npm test`: **43/43**; `npm run lint`: passed; `npm run build`: passed; final full `PATH="/c/Windows/System32:$PATH" npm run test:e2e -- --reporter=line`: **13/13**; `npx prisma migrate status`: six migrations up to date.
- `grep -RIlE 'JWT_SECRET|DATABASE_URL|passwordHash' apps/web/.next/static apps/web/.next-e2e/static || true`: no matching static bundle paths. An initial `rg` attempt could not run because ripgrep is absent from the shell PATH; the grep fallback ran.
- An early catalog E2E test looked up lowercase SKU although the API normalizes SKU to uppercase; test fixture lookup and teardown were corrected. The single identified leftover test category, its product and matching test users were inspected by unique fixture identifiers and removed. No unrelated records were touched.

## Remaining limitations and deployment preconditions

- Production HTTPS, secure cookie delivery through an actual reverse proxy, `WEB_ORIGIN`, proxy trust, DNS and live CORS behavior were not exercised. A real TLS deployment must be reviewed separately.
- In-memory rate limiting does not aggregate across processes; no load/performance test, external penetration test or dependency vulnerability review was performed. A correct `JWT_SECRET`, database privileges, backup/restore and monitoring require independent operational validation.
- CSRF mitigates cross-site mutation, not same-origin script injection. Logout invalidates all of that user's sessions, not only one device. SessionStorage contains checkout recovery data/resume tokens within the browser tab, not the JWT.
- Full keyboard/assistive-technology and visual checks on physical devices have not been completed. The 13 Playwright scenarios exercise representative keyboard, focus, empty/error, export and responsive states; they are not an accessibility certification.
