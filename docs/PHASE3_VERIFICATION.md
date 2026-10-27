# Phase 3 verification

## Automated evidence

- `npm run db:migrate`: applied `20261028000000_cash_sales`, generated Prisma Client.
- `npx prisma migrate status`: three migrations, database up to date.
- `npm test`: 17 passed (existing 10 plus six PostgreSQL sales tests and one integer-money unit test).
- Sales integration covers multiple products, product/cost/name snapshots, receipt totals, ledger arithmetic, insufficient cash/stock, tampered prices, invalid quantities, full rollback on injected ledger-write failure, last-unit concurrency, sequential/concurrent same-key replay, mismatched-key payloads, and cashier/admin visibility.
- `npm run lint`: web and API passed.
- `npm run build`: Next.js production build passed, including POS/history/dynamic receipt routes.
- `npx playwright install chromium`: installed browser required by the new E2E tests.
- `npm run test:e2e -- --reporter=line`: three critical Chromium tests passed. In the agent's minimal Windows shell, the command was prefixed with `PATH="/c/Windows/System32:$PATH"` so Playwright could shut down its subprocesses using Windows system utilities.

## Browser action evidence

- Login form authenticates a temporary cashier and opens the protected dashboard; Kasir link opens `/pos`.
- Category selection and SKU search locate test products; an unmatched search shows the empty state.
- Product selection adds items; plus/minus/direct quantity and remove controls update the cart.
- Refresh updates current prices/stock; an excessive discount blocks checkout with an error.
- Payment dialog opens; Escape and Batal close it. Uang pas and cash entry update received amount/change.
- Confirmation saves a multi-product cash sale, payment and SALE movements; direct PostgreSQL assertions confirm stock deduction and totals.
- Receipt link opens snapshot data; Cetak struk invokes `window.print` (stubbed in automation, no physical printer tested).
- Print-media emulation hides application navigation and renders a 72mm content width on 80mm paper.
- History invoice search finds the sale; Detail / cetak ulang opens the same receipt.
- 390px viewport has no horizontal document overflow; mobile navigation opens and closes. Product selection area scrolls independently to keep the cart reachable.
- A dropped response after the server commits leaves the request pending. Reload and retry returns the existing sale; sale count remains one and stock is decremented once.
- Price change between cart selection and payment produces a conflict, persists no sale, and succeeds after explicit cart refresh.
- Successful-flow test observed no uncaught browser exceptions. Expected HTTP 401 (guest session check) and simulated transport failure are not treated as application crashes.
- All fixture users/categories/products/sales/payments/movements are removed in test teardown. Seed demo products are not sold by these tests.

## Design delivery gate

- **Hard gates PASS:** operative controls and honest empty/error/pending states verified by the actions above; native dialogs, labeled inputs, visible focus styles, mobile overflow checks, no fabricated metrics/visual assets. Physical printing remains outside the MVP requirement.
- **Purpose gates PASS:** stock availability and price drive product selection; dark green marks actions/current navigation; Inter and tabular totals prioritize retail readability; compact surfaces avoid decorative dashboards.
- **Liveliness PASS:** Modern Retail Utility, ENERGY 1 / RHYTHM 1 / MOTION 1. Two-column desktop composition and one payment focal point follow the owner's direction; desktop/mobile/receipt screenshots reviewed.
- **Craftsmanship PASS:** full checkout, retry recovery, print styling, role visibility and snapshot correctness are backed by integration/E2E evidence rather than example analytics.

Screenshots are generated under ignored `test-results/checkout-cashier-flow-save-4d5c2-istory-and-printable-layout/` (`pos-desktop.png`, `pos-mobile.png`, `receipt-screen.png`). These show fictional E2E fixtures and are regenerated on a test run.
