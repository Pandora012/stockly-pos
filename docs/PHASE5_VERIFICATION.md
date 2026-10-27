# Phase 5 verification

## Scope and policies

Admin-only supplier management and full-order restocking. Supplier deactivation preserves history. PO lifecycle is DRAFT → ORDERED → RECEIVED; only drafts are editable. PO ID identifies receiving retries. Stock, last purchase cost, receiver audit fields and IN movements commit together or all roll back. Historical PO and sale costs do not change with later catalog prices.

No partial shipments, supplier payments, accounts payable, multi-warehouse or Phase 6 work is included. No new dependencies were required. Local PostgreSQL was used; Docker was not required.

## Commands executed

| Command | Result |
|---|---|
| `npm run db:migrate` | Applied `20261030000000_suppliers_restocking`; generated Prisma Client. |
| `npm run test -w @stockly/api -- test/purchases.integration.test.js` | Initial focused suite passed 8/8; a ninth concurrency case was subsequently included in the full suite. |
| `npm test` | Final regression passed 33/33 across seven files, including nine purchase integration tests. |
| `PATH="/c/Windows/System32:$PATH" npx playwright test tests/e2e/purchases.spec.js --reporter=line` | Two purchase E2E passed after fixing same-supplier detail reload. |
| `PATH="/c/Windows/System32:$PATH" npm run test:e2e -- --reporter=line` | Final regression passed 7/7, including prior checkout/reporting scenarios. |
| `npm run lint` | Passed for web and API. |
| `npm run build` | Next.js production build passed, including all four purchasing/supplier routes. |
| `npx prisma migrate status` | Five migrations found; database schema up to date. |

The Windows PATH prefix makes System32 subprocess cleanup tools available to Playwright. Prisma's existing `package.json#prisma` deprecation warning is non-blocking.

## PostgreSQL evidence

`apps/api/test/purchases.integration.test.js` covers:

- Supplier creation, normalized contact email, search/pagination, details and non-destructive deactivation; inactive suppliers cannot create new POs.
- Server-recalculated multi-item totals; rejected zero, negative, fractional, string and over-limit quantities, zero costs, repeated products, supplied totals and total overflow.
- Draft edit/version conflicts, stale ordering, rejection of early receipt and immutable ordered drafts.
- Correct stock increments, last-purchase-price update, receiver audit and linked IN ledger entries; later name/price edits do not overwrite ordered item snapshots.
- Repeated receipt returns `replayed: true` without changing stock; partial-receipt payloads are rejected.
- Concurrent requests for one PO produce one restock and one movement per product. Different POs receiving the same product preserve both increments and a consistent stock ledger chain.
- Injected ledger failure rolls back status, stock and costs. Stock overflow leaves the order unreceived. Already-ordered inactive goods can still be received.
- Anonymous requests are rejected; cashier supplier/purchase reads and writes are denied while cashier product reads remain available.

## Browser evidence

`tests/e2e/purchases.spec.js` drives the running Express/Next.js apps with temporary PostgreSQL fixtures:

- Supplier navigation opens `/suppliers`; unmatched search shows an empty state. Add/save persists contact details; edit/save changes the phone; deactivate/reactivate preserves the supplier; detail opens its purchase history.
- Pembelian → Buat PO opens the builder. Supplier selection and product search/add populate a multi-product draft; quantity/cost edits persist and total Rp 14,900 matches the database without changing stock.
- Ubah draf opens the editor; quantity zero disables saving. Correcting the quantity and saving recalculates the total to Rp 22,900.
- Tandai dipesan exposes receiving without changing stock. The receipt dialog opens, Escape closes it, and confirming full receipt increments both products to the expected stocks and removes the receive action.
- Supplier-history link filters the PO list. Inventory product history exposes a PO-number link that returns to the matching order details.
- A deliberately dropped response after server receipt shows a connection error. Retrying the same dialog returns the existing received result, with no duplicated stock or ledger entries.
- Logout/login as cashier hides purchasing navigation; direct visits to `/suppliers`, `/purchases`, `/purchases/new` and `/purchases/[id]` show restricted access.
- Received-PO layout at 390 × 844 has no horizontal document overflow; wide tables remain inside scrolling containers. Desktop builder/detail and regenerated mobile screenshots were reviewed. The admin lifecycle test captured no browser `pageerror` events.

Screenshots are generated under ignored `test-results/purchases-admin-manages-su-f7715-tock-and-follows-references/`: `purchase-builder-desktop.png`, `purchase-received-desktop.png`, `purchase-received-mobile.png`. They show explicitly named test fixtures, not real supplier data. Test teardown removes its own movements, PO items/orders, suppliers, products, categories and users; do not run these tests against production.

## Operational limits

- Receiving is idempotent; draft creation is not. Inspect purchase history after an uncertain draft-save response before submitting another draft.
- Costs use last-purchase costing, not weighted averages. Full receipt requires checking every ordered item first.
- Browser evidence is focused functional coverage, not a full accessibility audit or load test. Pagination and loading/error/retry controls also received source inspection; not every possible control/state combination was browser-exercised.
- Git remains on `main` with no commits and project files untracked. No commit or push was made; private environment and generated artifacts stay ignored.
