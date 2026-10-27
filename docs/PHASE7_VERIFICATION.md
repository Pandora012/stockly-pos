# Phase 7 verification

## Invariants

Holding writes only a PostgreSQL cart and item snapshots: no stock decrement, sale, payment or stock movement. Cashiers operate on their own carts; admins can read all but cannot resume/discard others' carts. Resume claims a cart for one session, then returns current prices, activity and stock for explicit review. The existing checkout transaction completes the cart and sale together, or neither.

## Executed checks

- `npm run db:migrate`: applied `20261031000000_held_carts` and generated Prisma Client. `npx prisma migrate status`: six migrations, schema up to date.
- Focused `npm run test -w @stockly/api -- test/held-carts.integration.test.js`: **8/8** passed. `npm run test -w @stockly/api -- test/auth.test.js`: **9/9** passed, including successful-login versus failed-login quota.
- Latest full `npm test`: **42/42** passed across eight files. `npm run lint` and `npm run build` passed.
- `PATH="/c/Windows/System32:$PATH" npx playwright test tests/e2e/checkout.spec.js --reporter=line`: **7/7** passed.
- Final `PATH="/c/Windows/System32:$PATH" npm run test:e2e -- --reporter=line`: **11/11** passed, including prior purchasing/reporting tests. A previous full run failed on the 11th successful login due to HTTP 429 (confirmed from Playwright network trace); successful login attempts no longer spend the failed-login quota, and the final full suite passed.

## PostgreSQL and browser coverage

- Holds persist with server-side price snapshots, valid item bounds and zero inventory/sale effects. List/detail ownership, admin read-only access, discard state and discarded-resume denial are tested.
- Review detects current-price changes, insufficient stock and inactive products. Concurrent resume tokens claim only once; identical tokens can retry, expired leases can be reclaimed and stale tokens cannot pay.
- Existing checkout enforces held-cart owner, lease and item subset, verifies each accepted unit price even if two price changes offset, and conditionally marks COMPLETED. Concurrent different-key payments yield one sale/stock decrement; same-key replay returns the original sale. Completed carts cannot be discarded or resumed.
- E2E holds a three-product cart with discount, reloads, reviews increased price/reduced stock/inactive product, confirms a two-product revised cart, then pays through the normal modal. Mobile review at 390px does not overflow the document. Discard confirmation and F6/F7 guards are exercised. A dropped held-payment response is recovered after reload with one sale and stock decrement.
- E2E fixture teardown deletes only its own sales, held carts/items, products, users and categories. Two leftover named test fixtures from an initial teardown failure were individually identified by slug/email and removed; unrelated data was not touched.

## Operational limitations

- The resume lease is 30 minutes. If it expires or another session completes the cart, reopen/review or check transaction history. The local clear-display action does not delete the server cart.
- Initial hold creation is not idempotent; after an uncertain response inspect held-cart history before submitting again. Sale payment retains existing idempotency recovery.
- Review is an explicit POS confirmation, not a stock reservation. Checkout always rechecks stock/prices/tax and may require another review if they change. Admins can view all held carts through API, while the POS panel intentionally shows the signed-in operator's own carts.
- No physical scanner/camera work or Phase 8 security audit was added. The existing Prisma 6 `package.json#prisma` deprecation warning remains non-blocking.
