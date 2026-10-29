# Stockly POS — Project Specification

## Product goals

Build a professional, practical web-based POS and inventory system for one physical retail store. Keep the portfolio project manageable while demonstrating sound fullstack, security, and transactional engineering. The system uses Indonesian Rupiah (IDR).

## Users and features

### ADMIN

- Manage products, categories, inventory, and stock adjustments.
- Manage suppliers, purchase orders, and cashier accounts.
- View all transactions, sales analytics, and reports; export reports to Excel.
- Manage store settings.

### CASHIER

- Search or scan products, manage a shopping cart, and complete cash checkout.
- Hold and resume carts, print receipts, and view authorized transaction history.

### Core workflow

Product management → inventory → cashier POS → checkout → stock deduction → receipt → reports.
Supplier workflow: supplier management → purchase order → receive goods → atomic inventory update.

## Mandatory technology

- **Frontend:** Next.js App Router, JavaScript/JSX, Tailwind CSS, React Hook Form, Zod, Lucide React, Recharts.
- **Backend:** Node.js, Express.js REST API, JavaScript ES modules, PostgreSQL, Prisma ORM, JWT, bcryptjs, Helmet, CORS, express-rate-limit.
- **Additional:** ExcelJS, browser receipt printing, USB barcode scanner input, keyboard shortcuts, Vitest, Supertest, Playwright for critical E2E tests, Docker Compose, npm workspaces.
- Supabase, Firebase, NextAuth, external authentication providers, SQLite, microservices, Redis, GraphQL, or payment gateways. Express remains the primary backend and PostgreSQL is mandatory.

## Architecture

Use an npm-workspaces monorepo with a Next.js frontend and a separately run Express REST API. The API owns authentication, authorization, validation, business rules, and persistence. PostgreSQL is the source of truth, accessed through Prisma. Keep the deployment and local development architecture simple; do not introduce extra services without an approved decision. Keep secrets server-side.

## Database and business rules

- Single-store system with `ADMIN` and `CASHIER` roles.
- Products have unique SKUs, optional unique barcodes, positive prices, and nonnegative inventory.
- Store all monetary values as integer IDR amounts; never calculate money with floating-point arithmetic.
- Preserve item-price snapshots on historical transactions.
- Cash checkout totals are recalculated by the backend in a database transaction. Prevent concurrent overselling, record stock movements, generate unique invoice numbers, and make duplicate checkout requests safe.
- Held carts persist in PostgreSQL without reserving stock. Revalidate current price and stock on resume and prevent duplicate checkout.
- Purchase receiving updates inventory atomically and cannot be applied twice.
- Reports cover daily/monthly sales, product performance, and low stock; support `.xlsx` export.

## Security

- Use password hashing and JWT in HttpOnly cookies; set Secure in production and appropriate SameSite behavior.
- Implement CSRF protection appropriate to cookie-based authentication.
- Enforce roles and access rules on the backend, not only in the UI.
- Validate input server-side; rate-limit authentication endpoints; use Helmet and narrowly configured CORS.
- Never expose credentials or secrets to the frontend or commit `.env` files.

## UI design: Modern Retail Utility

- Palette: background `#F4F4F0`, primary text `#182C26`, accent `#2F664F`, subtle surface `#E8ECE6`, border `#D4DAD3`, secondary text `#65736B`.
- Use Geist or Inter, a clear hierarchy, compact readable tables, aligned prices/quantities, restrained radii, and purposeful interactions.
- Prioritize usability, information clarity, consistency, responsive behavior, accessibility, then visual polish.
- Avoid purple-blue gradients, glassmorphism, oversized rounded cards, generic AI dashboards, excessive shadows/animations, decorative glow, fake analytics, and unnecessary illustrations.
- Cashier layout: product search/selection on the left; cart and checkout on the right. Support keyboard-friendly interaction and clearly show totals and stock.

Only the currently authorized phase may be implemented. Phase 0 must not implement application features or install dependencies.

## Acceptance criteria

- Roles can perform only their authorized operations; authentication and sensitive operations are securely handled server-side.
- Checkout and purchase receiving are atomic, safe under concurrency, and protected from duplicate requests/receipts.
- Monetary arithmetic uses integer IDR; historical sales retain sold-price snapshots.
- Inventory, stock movements, sales, held carts, and reports remain consistent with the documented rules.
- Cashier workflows are keyboard-usable, responsive, and provide clear stock and total information; receipts are printable.
- Critical workflows receive focused automated coverage (unit/integration and critical Playwright E2E); verification is reported accurately.
- Each roadmap phase meets its own documented scope and verification before being marked complete. Phase 0 acceptance specifically requires the requested documentation/configuration to exist, be internally consistent, and application features/dependencies to remain untouched.
