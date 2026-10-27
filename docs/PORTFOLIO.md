# Stockly POS: portfolio notes

## Summary

Stockly POS is a locally runnable fullstack point-of-sale and inventory application for one Indonesian retail store. It connects an operational cashier workflow with traceable stock changes, supplier receiving, and factual sales reporting. **Currently available for local development and demonstration. Public deployment is planned for a future release.**

## Technology and boundaries

- **Frontend:** Next.js App Router, React, JavaScript/JSX, Tailwind CSS, React Hook Form, Zod, Recharts, Lucide React, Inter. The Modern Retail Utility design prioritizes compact, legible tables and keyboard use.
- **API:** Separate Node.js/Express REST service with backend role and ownership checks, signed CSRF token, bcryptjs password hashing, JWT in HttpOnly cookies, and validation.
- **Persistence:** PostgreSQL 16 and Prisma, SQL constraints/indexes, Serializable transactions for sales, stock adjustment, and PO receiving. Money is integer IDR with BigInt intermediate arithmetic.
- **Quality:** Vitest/Supertest PostgreSQL integration tests, Playwright critical browser workflows, ESLint and a Next.js build. See [Phase 8 verification](PHASE8_VERIFICATION.md) and [current progress](PROGRESS.md) for executed results.

## Business workflow

Admin maintains categories, products and inventory; orders goods from suppliers and receives an entire PO into stock. Cashier searches or scans products, can hold a cart for later without reserving inventory, reviews price/stock changes on resume, takes a cash payment and prints a receipt. Each sale updates stock and feeds transaction history, dashboard charts, low-stock views, and four-sheet Excel exports. Admin sees store-wide information; Cashier access is scoped to their own sales and held carts.

## Engineering challenges

1. **Concurrent stock-safe checkout:** The API recalculates prices/tax and conditionally deducts each product within a Serializable PostgreSQL sale/payment/ledger transaction. Concurrent attempts for the last unit cannot oversell.
2. **Duplicate-operation safety:** A unique checkout idempotency key and request hash replay the same sale after a lost response, while PO status/version guards allow safe same-order receive retries. A held cart is linked uniquely to at most one completed sale.
3. **Historical accuracy:** Sale items snapshot name, SKU, unit sale price and purchase cost; receipt data snapshots cashier/store details. Reports use the captured costs and allocate integer discounts consistently. Current catalog changes do not rewrite historical receipts.
4. **Inventory audit:** Initial stock, adjustments, sale deductions and received goods produce linked movements in the same transaction as the stock update, with constraints against negative stock.
5. **Practical cashier input:** USB keyboard-emulation barcode + Enter, duplicate-scan queueing, feedback for unknown/out-of-stock goods, F2/F4/F6/F7/F8 shortcuts, native confirmation dialogs and lost-payment recovery.
6. **Local reproducibility:** npm workspaces launch Next.js and Express together; migrations and an idempotent, explicitly fictional demo seed prepare a fresh PostgreSQL database without overwriting existing credentials.

## Verified work and limits

The Phase 9 local verification passed **43/43 API tests** and **13/13 Playwright tests**, including PostgreSQL concurrency/rollback, role denial, receiving replay, barcode errors, held-cart review, print layout, and actual XLSX parsing. Seven real localhost screenshots were captured from fictional data; see [Phase 9 progress](PROGRESS.md) for the executed commands. This is **not** a penetration test, physical-printer test, performance benchmark, or production deployment.

One-store, cash-only scope deliberately excludes camera scanning, payment gateways, partial receiving, multi-warehouse accounting and real operating expenses. Category/account lists are not paginated; authentication and export rate limits are process-local. Initial hold, PO draft and adjustment creation do not have idempotency keys. Future work, if separately authorized, could cover TLS/proxy and backup validation, measured query scaling, accessibility and load testing, and deployment operations. No public URL or hosted environment exists.

[Local demo steps](DEMO_GUIDE.md) · [Architecture decisions](DECISIONS.md) · [Screenshots](screenshots/)
