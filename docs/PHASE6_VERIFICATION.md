# Phase 6 verification

## Scope

USB keyboard-emulation barcode input in the POS search and contextual shortcuts only. Exact barcode filtering reuses the existing product endpoint, no migration or dependency added. Camera scanning was optional and omitted. F6/F7 are reserved; hold/resume cart remains Phase 7 work.

## Automated evidence

- `npm run test -w @stockly/api -- test/catalog.integration.test.js`: passed. PostgreSQL integration checks exact barcode matching (including a leading-zero-compatible string filter), invalid input, cashier visibility of active products and denial after deactivation. Existing catalog/stock scenarios continue to pass.
- `PATH="/c/Windows/System32:$PATH" npx playwright test tests/e2e/checkout.spec.js -g 'scanner Enter' --reporter=line`: passed after the final scanner assertions. Exercises exact scan + Enter, repeated rapid scans and empty duplicate Enter, stock limits, unknown/inactive/out-of-stock feedback, numeric quantity editing, F2/F4/F8 and modifier guards, passive F6/F7, payment focus/Escape and shortcut listener counts (one POS listener, zero after navigation, one on return).
- `PATH="/c/Windows/System32:$PATH" npx playwright test tests/e2e/checkout.spec.js --reporter=line`: 4/4 passed after POS and payment changes; includes checkout/receipt/print, lost-response replay, price refresh, and scanner/shortcut scenario.
- `npm test`: 33/33 passed. `npm run lint` and `npm run build` passed. Final full `PATH="/c/Windows/System32:$PATH" npm run test:e2e -- --reporter=line`: 8/8 passed with the duplicate-Enter, stock-cap and modifier assertions included, alongside purchasing/reporting regression.

## Behavior and limitations

- Scan uses a dedicated exact barcode query independent of the displayed category filter. Cashiers cannot see inactive products; unknown and inactive share the same feedback. Stock zero and cart stock cap have distinct feedback.
- Barcodes are numeric strings and may start with `0`. Pressing Enter on a name or SKU search does not add a partial match; select it from the results instead.
- Rapid scans are queued; checkout remains disabled while lookups are outstanding. Server checkout still recalculates totals and uses its existing idempotent sale mechanism.
- F2/F4 apply only on POS and not while typing in another field. F8 applies on authenticated pages outside forms and dialogs. No shortcut hijacks Ctrl/Alt/Meta/Shift combinations or browser repeat. Native dialog Escape works; cash/receipt focus is explicit.
- No full keyboard screen-reader audit or physical USB device testing was performed; Playwright emulated keyboard scan input against a running local PostgreSQL-backed app. Existing E2E covers 390px POS layout and mobile navigation. Test fixtures are cleaned up after each test.
