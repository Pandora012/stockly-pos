# Architecture Decision Log

Initial decisions for Stockly POS. Revisit explicitly when requirements change; do not silently replace these choices.

| Decision | Choice | Reason |
|---|---|---|
| Repository structure | Monorepo using npm workspaces | Share project workflow while keeping frontend and API boundaries clear. |
| Frontend | Next.js App Router | Required stack; provides the web application and routing. |
| Backend | Separate Express REST API | Express remains the primary backend and keeps business logic server-side. |
| Persistence | PostgreSQL with Prisma | PostgreSQL is mandatory and supports transactional inventory operations. |
| Language | JavaScript ES modules and JSX; no TypeScript | Explicit project constraint and consistent local workflow. |
| Authentication | JWT in HttpOnly cookies; bcryptjs password hashing | First-party backend authentication with reduced JavaScript access to tokens. |
| Store model | Single physical store | Matches the product scope without multi-tenant complexity. |
| Money | Integer IDR amounts | Avoid floating-point monetary errors and match local currency requirements. |
| Inventory | Transactional stock changes and recorded movements | Maintain consistency across checkout and goods receiving. |
| Visual identity | Modern Retail Utility palette and restrained UI | Optimize operational clarity and avoid generic dashboard styling. |

## Phase 1 implementation decisions

- **Session invalidation:** `User.sessionVersion` is embedded in short-lived JWTs and checked against PostgreSQL per authenticated request. Logout increments the version, revoking all sessions for that user without a separate token store.
- **CSRF and origins:** A signed double-submit token is delivered from `GET /api/auth/csrf`, sent in a custom header on mutations, and checked with an exact origin allowlist when Origin is present. `SameSite=lax` by default, with Secure cookies in production.
- **User management:** Admin can create and edit cashier accounts; admins cannot edit other admin accounts through Phase 1 endpoints. Deactivation and password changes increment session version.
- **Tax rate:** `StoreSetting.defaultTaxRate` is stored as integer basis points (0–10000); currency is constrained to `IDR`. No tax calculations are implemented in Phase 1.
- **UI:** Inter is self-hosted via `@fontsource/inter`; compact sidebar and plain operational surfaces keep focus on actual access and account tasks. No invented business metrics are displayed.

## Phase 2 implementation decisions

- **Stock ledger:** Initial stock on product creation and every admin adjustment create `StockMovement` in the same PostgreSQL transaction as the product/adjustment write. Ordinary product PATCH rejects `stock` and `initialStock`. No product hard-delete API exists; foreign keys use `RESTRICT`.
- **Concurrent adjustments:** Transaction isolation is `Serializable`, with conditional `updateMany` on the previously read stock and retry on Prisma `P2034`. A losing concurrent decrement receives 409; stock cannot fall below zero. SQL checks also constrain prices, nonnegative stock, and ledger arithmetic.
- **Low stock:** `stock <= minimumStock`, compared as database fields; `minimumStock = 0` treats zero stock as low. Amounts are integer IDR, with positive purchase and selling prices.
- **Visibility:** Cashiers may read active products only when their category is active; only admins can mutate categories, products, or inventory and view stock movements.
- **Demo seed:** Five categories, 18 fictional products with `DEMO-` SKU prefix, EAN-style sample barcodes, and corresponding initial movements are inserted only outside production. Re-running the seed preserves existing records. UI marks demo products as `Data demo`.
- **UI:** Compact tables with contextual forms and a native adjustment dialog; movement history filters use row-selected product plus optional date range, not a raw UUID input.

## Phase 3 implementation decisions

- **Checkout boundary:** One serializable Prisma transaction reads products/store settings, recalculates totals, creates sale/item/payment snapshots, conditionally decrements stock, and records SALE movements. Retry serialization conflicts up to four attempts; return a conflict if stock is no longer available. No cash sale is persisted without its payment and ledger writes.
- **Money and discount policy:** Fixed IDR discount may be entered by an authenticated admin or cashier, bounded by subtotal. Store tax is applied after discount using basis points with integer half-up rounding. Shared `shared/money.js` uses BigInt intermediates, with individual quantities capped at 10,000, 100 distinct items, and a 2-billion-IDR monetary ceiling compatible with PostgreSQL integers. UI totals are estimates; `expectedTotal` is only a change guard, never authoritative input.
- **Idempotency:** Client-generated UUID is unique on Sale. A canonical request hash and cashier ID must match before an existing result can be replayed (HTTP 200 versus 201 for a new sale). A reused key with different payload/owner returns 409. Concurrent same-key writes resolve to one sale; replay checks happen before revalidating current catalog prices.
- **Uncertain payment recovery:** Before sending checkout, persist the immutable request in per-user `sessionStorage`. Lock the cart and retry the same request after a network/server failure or reload. Definitive 400/409 validation failures release the cart. This is recovery for a submitted checkout, not held-cart support. Storage is required before sending; corruption blocks new checkout until the operator checks history and resolves local storage.
- **Historical receipts:** Sale stores cashier name and store receipt information snapshots; SaleItem stores name, SKU, unit selling price and unit cost snapshots. Public responses omit unit costs, request hashes, and idempotency keys. No sale edit/delete APIs are provided. Admin sees all sales; cashier sees own sales only, including receipt access.
- **Invoice and dates:** Invoice combines UTC date with a UUID and database uniqueness constraint. History date filters use inclusive UTC days (exclusive next-day upper bound); display timestamps use browser locale. Receipt layout supports 80mm paper with browser printing, with long receipts continuing across pages.
- **Focused E2E:** Playwright uses ports 3100/4100 and `.next-e2e` output to avoid clobbering local production build output. Tests create and remove their own PostgreSQL fixtures; never point these development tests at production. No barcode scanner or held-cart implementation in this phase.

## Phase 4 implementation decisions

- **Report access:** All `/api/reports/*` endpoints, including dashboard overview, require ADMIN on the backend. Cashiers receive links to POS and their transactions, not store-wide figures. Frontend report guards supplement backend authorization.
- **Report time:** Reporting is fixed to `Asia/Jakarta` for range defaults, local midnight boundaries, SQL daily/monthly grouping, charts, dashboard, and workbook dates. Ranges include the end day using an exclusive next-midnight bound. SQL explicitly converts timestamp-with-zone parameters to UTC timestamp columns; it never relies on the PostgreSQL session timezone. Phase 3 transaction-history UTC date filters remain labeled separately.
- **Definitions:** Gross sales = sum of sale subtotal before discounts/tax. Net sales/revenue = subtotal minus discount, excluding tax. Amount collected = net sales plus tax. Estimated gross profit = net sales minus `quantity × unitCostSnapshot`, not current purchase prices. Operating expenses are not recorded, so net profit is not calculated or claimed.
- **Category/product allocation:** Category ID/name snapshots are captured on new SaleItems. Older items are backfilled once from the catalog at migration time; original historical category data did not exist and is not invented. Group labels use the latest sold name in the selected period. Per-line discount is allocated proportionally using differences of cumulative integer quotients in SaleItem ID order; allocated net revenue/profit reconciles exactly to the sale and workbook totals without floating-point money.
- **Read consistency:** Each multi-query report or workbook uses a repeatable-read PostgreSQL transaction. Aggregation, ranking, zero-filled calendar periods, and profit arithmetic happen in PostgreSQL; numeric results are checked for JavaScript safe-integer limits before serialization.
- **Export limits:** Reports allow 1–366 days. XLSX allows 1–93 days, at most 10,000 transactions, 10,000 sold-product groups, and 10,000 current stock rows; over-limit results fail rather than silently truncate. Export rate limit is five requests per admin per minute. Category summaries cap at 1,000 groups. Workbook generation uses ExcelJS and fixed column keys, writing untrusted values only as string cells (no formulas/hyperlinks).
- **Workbook semantics:** Four sheets: Sales Summary, Transaction Details, Top Products, Stock Report. Sales follow date filters and completed-sale snapshots; Stock Report explicitly represents current stock at export, not historical closing inventory. Totals come from database aggregates and exclude the totals row from autofilters. Workbook dates are Jakarta wall-clock Excel dates with no timezone metadata.
- **UI:** Recharts loads only on report/dashboard views, uses one green series for net sales, disables decorative animation, and provides a screen-reader data table. Metrics form a compact strip; visible report tables provide exact amounts. Empty periods show factual zero aggregates and no fabricated chart data.

## Phase 5 implementation decisions

- **Access and suppliers:** Supplier and purchase endpoints require ADMIN; mutation requests retain existing CSRF protection. Supplier removal is deactivation, not deletion. Details use `GET /api/suppliers/:id`; history uses `GET /api/purchases?supplierId=...`. Purchasing middleware is scoped to supplier/purchase paths so cashier catalog and checkout access is unchanged.
- **Lifecycle and versions:** DRAFT → ORDERED → RECEIVED, with no partial receiving or reverse transitions. Draft edits and ordering require the current integer `version`; stale drafts return 409. Ordering an already-ordered/received PO returns its existing state without changes. New/edited/ordered drafts require active suppliers, products and categories; already-ordered goods can be received after deactivation.
- **Atomic receiving:** One serializable PostgreSQL transaction claims the ORDERED status/version, increments stocks conditionally, updates last purchase costs, records IN movements and receiver/timestamp audit fields. Products are processed in ID order. Retry Prisma `P2034` up to four total attempts, with a 15-second transaction timeout; failure rolls back all writes.
- **Receiving identity:** PO ID is the idempotency identity. An already-RECEIVED PO returns HTTP 200 with `replayed: true` and no writes. A partial unique index on product/reference ID for PURCHASE_ORDER IN movements provides an additional duplicate guard. Movements use the PO ID as `referenceId` and PO number as their note. After a lost response, retry the same PO, not a new order.
- **Historical costs:** PO supplier name and item product name/SKU are snapshotted and refreshed at ordering. PO quantities/unit costs are immutable after ordering. Receipt updates current `Product.purchasePrice` to the received unit cost (last-purchase costing, not a weighted average); existing PO costs and SaleItem cost snapshots are unchanged.
- **Bounds and totals:** Server recalculates integer-IDR totals using BigInt intermediates. A PO contains 1–100 distinct products; quantity is 1–10,000, unit cost is 1–1,000,000,000 IDR, and total is at most 2,000,000,000 IDR. Stock cannot exceed 1,000,000,000. SQL constraints back item arithmetic, total bounds and valid status/audit combinations.
- **Draft recovery:** Draft creation has no idempotency key. UI disables in-flight submission and instructs operators to inspect purchase history after an uncertain save before creating another draft. Version checks prevent stale draft overwrites, not duplicate new drafts.
- **UI and scope:** Reuse Modern Retail Utility tables, Inter typography, aligned amounts and green primary actions for operational continuity. Separate supplier/product pickers feed the editable item table; a native confirmation dialog makes full receipt explicit. Wide tables scroll within mobile containers; PO references link inventory back to order details. No new visual assets, dependencies, payments, payables or warehouse features were added.
