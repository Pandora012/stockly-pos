# Phase 4 verification

## Definitions and scope

Dashboard and `/reports` show completed store sales for ADMIN only. Reporting timezone is Asia/Jakarta. Bruto is subtotal, neto is subtotal less discount (excluding tax), and gross profit estimate is neto less historical item costs. Gross profit is not net profit. Stock export is a current snapshot, independent of the sales date range.

## Automated evidence

- `npm run db:migrate` applied `20261029000000_reporting_categories` and generated Prisma Client.
- Focused PostgreSQL reporting tests cover gross/net/tax/collected totals, quantities, historical-cost gross profit, discount reconciliation by category, ranked/paginated products, immutable category/name/cost snapshots, inclusive Jakarta day/month boundaries, independence from server session timezone, dashboard counts, unauthorized requests, invalid dates, range/volume limits and valid empty reports.
- Workbook tests load actual XLSX bytes through ExcelJS: exactly four expected worksheets, Jakarta date values, Rupiah formatting, autofilter, filtered totals, and leading `=` content represented as strings, not formulas.
- Latest `npm test`: 24 passed (including seven report integration tests). `npm run lint` and `npm run build` passed. `npx prisma migrate status`: four migrations, up to date.
- Playwright: five E2E passed, including the three prior checkout scenarios and two report/admin-access scenarios. Executed as `PATH="/c/Windows/System32:$PATH" npm run test:e2e -- --reporter=line` in this Windows agent shell for subprocess cleanup.

## Browser evidence

`tests/e2e/reports.spec.js` exercises real PostgreSQL fixtures through the running Express/Next.js apps:

- Admin dashboard values match the live overview API; chart and recent receipt link load.
- Report date filters and daily/monthly selection update summaries, category/product tables and chart.
- Excel download uses the applied range; the downloaded workbook is opened and its sheets/totals validated.
- Empty ranges show empty-product/category/chart states; injected API failure shows retry and recovers after retry.
- 390px report viewport has no horizontal document overflow; wide tables scroll inside their containers.
- Cashier sees no report navigation, `/reports` redirects to unauthorized, and export returns 403.
- E2E fixture sales, products, users and categories are removed after each test; no demo business transactions are left behind.

Screenshots are generated in ignored `test-results/reports-admin-sees-live-ov-ff087--handles-empty-error-states/` (dashboard desktop, report desktop/mobile). These screenshots contain clearly named test fixtures, not production business claims.

## Design delivery gate

- **Hard gates PASS:** real database metrics; no fake analytics, dead export action, or fabricated profit claims. Labeled filters, retry/empty states, keyboard-usable controls, and mobile overflow verified by E2E. Screen-reader chart table is clipped within a container, not a table that could leak layout width.
- **Purpose gates PASS:** net-sales chart communicates trends; tabular values provide exact totals; green indicates one series and primary actions, not decoration. No extra illustrations/assets or excessive animations.
- **Liveliness PASS:** Modern Retail Utility, ENERGY 1 / RHYTHM 1 / MOTION 1. Clear metric strip, restrained report surfaces, established Inter typography and aligned IDR values.
- **Craftsmanship PASS:** business formulas, timezone behavior and workbook reconciliation have PostgreSQL/ExcelJS evidence. Browser checks cover admin/cashier access, file download and failures. Screenshot review supports visual consistency.
