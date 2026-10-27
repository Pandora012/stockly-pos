# Stockly POS: localhost demonstration

This walkthrough uses **fictional data** and never requires a hosted service. Run it only against a development PostgreSQL database. The UI is in Indonesian; labels below match the application.

## Prepare the machine

1. Open PowerShell in the repository root. Set up `.env` using the private instructions in [README](../README.md): local `DATABASE_URL`, a 32+ character `JWT_SECRET`, `WEB_ORIGIN=http://localhost:3000`, `NEXT_PUBLIC_API_URL=http://localhost:4000`, `COOKIE_SAME_SITE=lax`, and a unique initial `ADMIN_EMAIL` / `ADMIN_PASSWORD`. No published password is supplied.
2. Start local PostgreSQL 16, or run `docker compose up -d db` to start **only** the optional database service. Confirm it is listening on `5432`.
3. Run `npm ci`, `npm run db:generate`, `npm run db:migrate`, and `npm run db:seed`. The seed adds fictional `DEMO-` products, `DEMO: Mitra Grosir Fiktif`, a received `DEMO-PO-001`, an ordered but unreceived `DEMO-PO-002`, and cash sale `DEMO-INV-001` only if absent. Running it again does not change existing account passwords or repeat demo stock movements. If the database has other records, those remain intact.
4. Run `npm run dev` and browse to `http://localhost:3000`. Web and API run at `3000` and `4000`. On a Bash harness where `cmd.exe` is not on PATH, use `PATH="/c/Windows/System32:$PATH" npm run dev`; PowerShell normally needs no prefix.
5. Optional: before creating another user or entering non-demo records, run `npm run screenshots:local` for seven genuine app screenshots. The capture refuses non-demo data.

## Admin: prepare a sale and inventory

1. Log in with the Admin email/password **you set in `.env`**. Confirm the `Ringkasan toko` dashboard shows the seeded sale `DEMO-INV-001`, the seven-day chart, and low-stock count. The seed sale was recorded under the Admin user; it is not a sale by a fictional pre-seeded cashier.
2. Visit `Produk`. Filter by category or search `DEMO-MIN-001`. Open a product with `Ubah`, change a description or selling price if desired, and save. For a newly created product, use `Tambah produk`, select a category, enter a unique SKU, positive integer-IDR prices, and initial stock. Existing sample products are marked `Data demo`.
3. Visit `Inventaris`. Search the same SKU, choose `Sesuaikan`, enter a quantity change (for example `+2`) and a reason. Check the new stock and `Riwayat` movement. A negative adjustment larger than stock should be rejected. Use the `Stok rendah saja` filter to see stock at/below the minimum.
4. Visit `Supplier`. The fictional seed supplier is visible. Choose `Tambah supplier` and enter a distinct fictional name. Visit `Pembelian` and `Buat PO`; select the new supplier and one active product, enter quantity and positive integer unit cost, then `Simpan draf`. On the PO page choose `Tandai dipesan`, then `Terima semua stok` and `Konfirmasi terima semua`. Confirm linked IN movements and increased product stock in `Inventaris`. The PO can be received only once; `DEMO-PO-001` is an existing received-history example and `DEMO-PO-002` is an optional unreceived example if you want to demonstrate only the receiving step.
5. Visit `Pengguna` and create a local Cashier with a **unique email and password you choose** (at least 12 characters). Do not publish this password or reuse the Admin password. Log out with `Keluar`.

## Cashier: scan, hold, and complete checkout

6. Log in as the new Cashier. The dashboard presents cashier operations rather than admin-wide reports. Admin-only `Inventaris`, `Pembelian`, and `Laporan` are unavailable. Visit `Kasir`.
7. Search for `DEMO-MIN-001` and add an in-stock product. Alternatively, use a USB barcode scanner configured as a keyboard with Enter, or type the product's barcode shown in `Produk` into POS search and press Enter. `F2` focuses search. An unknown barcode reports that no active product was found; it does not create a sale. Adjust quantity with the cart controls, keeping it within available stock.
8. Choose `Tahan keranjang` or `F6`, provide a label, and save. No stock is reserved or deducted. Open `Keranjang ditahan` or press `F7`; check the count and updated time. Optionally reload the page to confirm persistence. Choose `Lanjutkan / periksa`, compare original and current prices, stock, and inactive status, then explicitly choose `Gunakan keranjang yang diperiksa`. If a price or stock changed, review and adjust before paying.
9. Choose `Bayar tunai` or `F4`; enter cash received (or `Uang pas`), inspect total/change, and confirm. Use the receipt link and `Cetak struk` to invoke browser printing. Physical printer/paper behavior depends on local hardware. Check `Transaksi` (or `F8` outside fields/dialogs), find the invoice, and open `Detail / cetak ulang`. The backend deducts stock and writes a SALE movement once. If a payment response is lost, use `Periksa pembayaran tertunda` and **retry that request**, not a new sale.
10. Log out. Log back in as Admin; check `Inventaris` movement history, `Ringkasan toko`, and `Laporan`. Apply a date range including today's **Asia/Jakarta** date, compare transaction count and sales totals, then choose `Unduh Excel`. The `.xlsx` workbook has Sales Summary, Transaction Details, Top Products, and Stock Report sheets. Stock Report reflects *current* stock.

## What to point out

- Checkout totals and change are integer IDR and recomputed on the API. A receipt stores historical product, price, cashier, store and category snapshots.
- A held cart is persisted but does not reserve inventory. Resume leases and checkout completion prevent a second sale for the same cart.
- PO receiving and stock movements are committed together. Repeated receive requests cannot increase stock twice.
- Admin reports include all store sales; a Cashier sees only own transactions and held carts.

The seeded sale is dated when seed was first run. If it was seeded in a previous month, select that date in reports; rerunning seed intentionally does **not** redate the historical sale. Do not run browser tests against live store data: Playwright creates and deletes its own PostgreSQL fixtures.
