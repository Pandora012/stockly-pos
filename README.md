# Stockly POS

Professional web-based point-of-sale and inventory management for a single physical retail store, using Indonesian Rupiah (IDR).

## Project status

**Phase 5 complete: suppliers, purchase orders and atomic restocking.** See [`docs/PROGRESS.md`](docs/PROGRESS.md) for verification/status and [`docs/HANDOFF.md`](docs/HANDOFF.md) for continuation. Phase 6 has not started.

## Project references

- [`AGENTS.md`](AGENTS.md) — concise instructions for OpenCode sessions.
- [`opencode.json`](opencode.json) — minimal project-local OpenCode configuration; does not select a model/provider.
- [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md) — product, business, architecture, security, UI, and acceptance requirements.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — initial architecture decisions.
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — phase checklist and verification status.
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — cross-session continuation context.

## Technology direction

Next.js App Router frontend and separate Express REST API, using JavaScript/JSX, PostgreSQL, Prisma, and npm workspaces. TypeScript is not permitted. See the project specification for the full required stack and constraints.

## Local development

Requires Node.js 20+ and PostgreSQL 16 (Docker Compose optional). Modules cover authentication, catalog, inventory, cash checkout, history/receipts, admin dashboard, sales reports, Excel export, suppliers and purchase orders.

1. Copy `.env.example` to `.env` and replace the database password, JWT secret (at least 32 random characters), and initial admin credentials. Keep `.env` private. `ADMIN_PASSWORD` must be at least 12 characters. If using Docker Compose, its password and the database URL must match.
2. Use a local PostgreSQL instance configured by `DATABASE_URL`; Docker Compose (`docker compose up -d db`) is optional.
3. Run `npm ci`, `npm run db:generate`, `npm run db:migrate`, and `npm run db:seed` from the repository root. Seeding creates the initial admin only when its email does not already exist; it does not reset existing passwords.
4. Run `npm run dev` for web (port 3000) and API (port 4000), or `npm run dev:web` / `npm run dev:api` separately.
5. Run `npm run test`, `npm run lint`, and `npm run build` to verify. `npm run db:migrate` uses Prisma development migrations; use `npx prisma migrate deploy` for production.

Development seed inserts five categories and 18 **fictional demo products** with `DEMO-` SKU prefixes and initial stock movements. The UI labels demo products; do not treat these records as real store data or include them in real reporting. Re-running the seed does not overwrite existing products. The catalog pages are `/products`, `/categories` (admin), and `/inventory` (admin).

## Cash checkout

- Open `/pos` after login. Choose products, adjust quantities/IDR discount, check totals, then receive cash. Backend recalculates prices, tax, stock and change; stale totals require explicit cart refresh before payment.
- Open `/transactions` to view history and print/reprint the 80mm receipt. Cashiers see only their own transactions; admins see the store history. Date filters use UTC days.
- If checkout loses its connection, use **Periksa pembayaran tertunda** to retry the saved request. Do not start another sale or clear the pending request until the previous outcome is known. Pending checkout recovery survives a reload in the same browser tab, but is not a held-cart feature.
- Critical browser tests: `npx playwright install chromium`, then `npm run test:e2e`. Uses local PostgreSQL and dedicated ports 3100/4100; test fixtures are cleaned up. Do not run these tests on production. See [`docs/PHASE3_VERIFICATION.md`](docs/PHASE3_VERIFICATION.md).

## Admin reporting

- `/dashboard` shows real store metrics, seven-day net sales, top five products and recent transactions. `/reports` offers daily/monthly summaries, categories, product rankings and a four-sheet XLSX download. All report/export endpoints are admin-only; cashiers keep POS and own-history access.
- Reports use **Asia/Jakarta** local days. Gross sales are before discounts; net sales exclude discounts and tax. Gross profit estimate deducts historical item costs from net sales, **not operating expenses**; it is not net profit.
- Date ranges: at most 366 days for reports, 93 days for Excel. Workbook limits: 10,000 transactions/sold products/current stock rows; five exports per admin per minute. Over-limit exports return an error instead of partial data. Stock Report represents current stock, not historical closing stock.
- Report categories are snapshotted on new sales. Earlier sales were backfilled from the catalog when Phase 4 was migrated because their original category was not stored. See [`docs/DECISIONS.md`](docs/DECISIONS.md) and [`docs/PHASE4_VERIFICATION.md`](docs/PHASE4_VERIFICATION.md).

## Suppliers and restocking

- Admins manage contacts, activation and purchase history at `/suppliers`. Deactivation preserves records and history.
- Open `/purchases/new` to build a multi-product PO, then use `/purchases/[id]` to edit its draft, mark it ordered, and confirm full-order receipt. Only drafts are editable; saving or ordering does not change stock.
- Receiving atomically adds stock, records linked IN movements, and updates the current product purchase price to the PO unit cost. PO costs and existing sales cost snapshots remain historical; this is last-purchase cost, not weighted-average costing.
- If a receive response is lost, retry the **same PO**. Already-received orders return their result without restocking again. Draft creation has no retry key: check purchase history before submitting a new draft after an uncertain save.
- No partial shipments, supplier payments, accounts payable or multi-warehouse features are included. See [`docs/PHASE5_VERIFICATION.md`](docs/PHASE5_VERIFICATION.md).

The browser calls the Express API directly using `NEXT_PUBLIC_API_URL`. Set `WEB_ORIGIN` to the exact browser origin. In production, use HTTPS, `COOKIE_SAME_SITE=lax` for same-site origins, or `none` only for cross-site HTTPS with an appropriate CSRF/CORS policy. JWT cookies are HttpOnly and Secure in production. The API controls access; frontend route guards are for navigation only.
