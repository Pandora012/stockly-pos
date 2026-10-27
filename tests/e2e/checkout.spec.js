import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { test, expect } from '@playwright/test';
import { saleTotals } from '../../shared/money.js';

let db; let user; let category; let products; let password; let taxRate;
test.beforeEach(async () => {
  db = new PrismaClient();
  const suffix = crypto.randomUUID(); password = crypto.randomBytes(24).toString('hex');
  user = await db.user.create({ data: { name: 'E2E Cashier', email: `${suffix}@example.invalid`,
    passwordHash: await bcrypt.hash(password, 10), role: 'CASHIER' } });
  category = await db.category.create({ data: { name: `E2E ${suffix}`, slug: `e2e-${suffix}` } });
  products = [];
  for (const index of [1, 2]) {
    products.push(await db.product.create({ data: { name: `E2E product ${index}`, categoryId: category.id,
      sku: `E2E-${suffix}-${index}`, purchasePrice: 2000, sellingPrice: 5000 * index, stock: 10 } }));
  }
  taxRate = (await db.storeSetting.findUniqueOrThrow({ where: { id: 1 } })).defaultTaxRate;
});
test.afterEach(async () => {
  if (user) {
    const sales = { cashierId: user.id };
    await db.stockMovement.deleteMany({ where: { userId: user.id } });
    await db.payment.deleteMany({ where: { sale: sales } });
    await db.saleItem.deleteMany({ where: { sale: sales } });
    await db.sale.deleteMany({ where: sales });
    await db.product.deleteMany({ where: { categoryId: category.id } });
    await db.category.delete({ where: { id: category.id } });
    await db.user.delete({ where: { id: user.id } });
  }
  await db?.$disconnect(); user = null;
});

async function login(page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Kata sandi', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.waitForURL('**/dashboard');
  await page.getByRole('link', { name: 'Kasir', exact: true }).click();
  await page.getByRole('combobox', { name: 'Kategori', exact: true }).selectOption(category.id);
  await expect(page.getByRole('button', { name: 'Tambah E2E product 1', exact: true })).toBeEnabled();
}

test('cashier flow saves stock, payment, receipt, history and printable layout', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await page.getByRole('button', { name: 'Tambah E2E product 1', exact: true }).click();
  await page.getByRole('button', { name: 'Tambah jumlah E2E product 1', exact: true }).click();
  await page.getByRole('button', { name: 'Kurangi E2E product 1', exact: true }).click();
  await page.getByLabel('Jumlah E2E product 1', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Tambah E2E product 2', exact: true }).click();
  await page.getByRole('button', { name: 'Hapus E2E product 2', exact: true }).click();
  await page.getByRole('button', { name: 'Tambah E2E product 2', exact: true }).click();
  await page.getByLabel('Diskon (IDR)').fill('1000');
  await page.getByRole('button', { name: 'Perbarui harga dan stok' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Harga dan stok keranjang diperbarui' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('pos-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Bayar tunai' }).click();
  const dialog = page.getByRole('dialog');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Bayar tunai' }).click();
  await dialog.getByRole('button', { name: 'Batal', exact: true }).click();
  await expect(page.getByLabel('Cari nama, SKU, atau pindai barcode')).toBeFocused();
  await page.getByRole('button', { name: 'Bayar tunai' }).click();
  await dialog.getByRole('button', { name: 'Uang pas', exact: true }).click();
  await dialog.getByLabel('Uang tunai diterima').fill('50000');
  await dialog.getByRole('button', { name: 'Konfirmasi pembayaran' }).click();
  await expect(dialog.getByRole('heading', { name: 'Pembayaran tersimpan' })).toBeVisible();
  const sale = await db.sale.findFirstOrThrow({ where: { cashierId: user.id }, include: { payment: true, items: true } });
  const total = saleTotals([{ unitPrice: 5000, quantity: 2 }, { unitPrice: 10000, quantity: 1 }], 1000, taxRate).total;
  expect(sale.total).toBe(total); expect(sale.payment.changeAmount).toBe(50000 - total);
  expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(8);
  await dialog.getByRole('link', { name: 'Buka struk untuk cetak' }).click();
  await expect(page.getByRole('article', { name: 'Struk transaksi' })).toContainText(sale.invoiceNumber);
  await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await page.getByRole('button', { name: 'Cetak struk' }).click();
  expect(await page.evaluate(() => window.__printed)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('receipt-screen.png'), fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.sidebar')).toBeHidden();
  expect((await page.locator('.receipt-sheet').boundingBox()).width).toBeLessThan(280);
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('link', { name: 'Kembali ke transaksi' }).click();
  await page.getByLabel('Cari nomor invoice').fill(sale.invoiceNumber);
  await expect(page.getByRole('cell', { name: sale.invoiceNumber, exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Detail / cetak ulang' }).click();
  await expect(page.getByRole('article', { name: 'Struk transaksi' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Kembali ke kasir' }).click();
  await page.getByRole('button', { name: 'Buka atau tutup navigasi' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
  await page.getByRole('button', { name: 'Buka atau tutup navigasi' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('pos-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('lost checkout response can be retried after reload without a duplicate sale', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Tambah E2E product 1', exact: true }).click();
  let dropped = false;
  await page.route('**/api/sales', async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Bayar tunai' }).click();
  await page.getByRole('button', { name: 'Konfirmasi pembayaran' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Tidak dapat terhubung');
  await page.reload();
  await page.getByRole('button', { name: 'Periksa pembayaran tertunda' }).click();
  await page.getByRole('button', { name: 'Periksa / ulangi pembayaran', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pembayaran tersimpan' })).toBeVisible();
  expect(await db.sale.count({ where: { cashierId: user.id } })).toBe(1);
  expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(9);
});

test('changed prices require cart refresh; invalid discounts and empty searches have honest states', async ({ page }) => {
  await login(page);
  await page.getByLabel('Cari nama, SKU, atau pindai barcode').fill('nonexistent-unique-product');
  await expect(page.getByText('Belum ada data untuk filter ini.')).toBeVisible();
  await page.getByLabel('Cari nama, SKU, atau pindai barcode').fill(products[0].sku);
  await page.getByRole('button', { name: 'Tambah E2E product 1', exact: true }).click();
  await page.getByLabel('Diskon (IDR)').fill('999999');
  await expect(page.getByRole('alert').filter({ hasText: 'diskon melebihi subtotal' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bayar tunai' })).toBeDisabled();
  await page.getByLabel('Diskon (IDR)').fill('0');
  await db.product.update({ where: { id: products[0].id }, data: { sellingPrice: 6000 } });
  await page.getByRole('button', { name: 'Bayar tunai' }).click();
  await page.getByRole('button', { name: 'Konfirmasi pembayaran' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Harga atau pajak berubah' })).toBeVisible();
  expect(await db.sale.count({ where: { cashierId: user.id } })).toBe(0);
  await page.getByRole('button', { name: 'Perbarui harga dan stok' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Harga dan stok keranjang diperbarui' })).toBeVisible();
  await page.getByRole('button', { name: 'Bayar tunai' }).click();
  await page.getByRole('button', { name: 'Konfirmasi pembayaran' }).click();
  await expect(page.getByRole('heading', { name: 'Pembayaran tersimpan' })).toBeVisible();
});

test('scanner Enter and POS shortcuts remain safe across rapid input and navigation', async ({ page }) => {
  await page.addInitScript(() => {
    const listeners = new Set();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.__posShortcutListeners = () => [...listeners].filter((listener) => listener.name === 'shortcuts').length;
    window.addEventListener = (type, listener, options) => {
      if (type === 'keydown' && listener?.name === 'shortcuts') listeners.add(listener);
      return add(type, listener, options);
    };
    window.removeEventListener = (type, listener, options) => {
      if (type === 'keydown') listeners.delete(listener);
      return remove(type, listener, options);
    };
  });
  const barcode = '00123456789012';
  const emptyBarcode = '00987654321098';
  const inactiveBarcode = '00888888888888';
  await db.product.update({ where: { id: products[0].id }, data: { barcode } });
  await db.product.update({ where: { id: products[1].id }, data: { barcode: emptyBarcode, stock: 0 } });
  const inactive = await db.product.create({ data: { name: 'Inactive scan fixture', sku: `INACTIVE-${crypto.randomUUID()}`,
    barcode: inactiveBarcode, categoryId: category.id, purchasePrice: 1000, sellingPrice: 2000, stock: 4, isActive: false } });
  products.push(inactive);
  await login(page);
  expect(await page.evaluate(() => window.__posShortcutListeners())).toBe(1);
  const search = page.getByLabel('Cari nama, SKU, atau pindai barcode');
  await page.locator('body').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('F2'); await expect(search).toBeFocused();
  await search.fill(barcode); await search.press('Enter');
  await expect(page.getByLabel(`Jumlah ${products[0].name}`, { exact: true })).toHaveValue('1');
  await expect(page.getByRole('status').filter({ hasText: 'stok tersedia 10' })).toBeVisible();
  await search.press('Enter');
  await expect(page.getByLabel(`Jumlah ${products[0].name}`, { exact: true })).toHaveValue('1');
  await search.fill(barcode); await search.press('Enter');
  await search.fill(barcode); await search.press('Enter');
  await expect(page.getByLabel(`Jumlah ${products[0].name}`, { exact: true })).toHaveValue('3');
  await page.getByLabel(`Jumlah ${products[0].name}`, { exact: true }).fill('10');
  await expect(page.getByLabel(`Jumlah ${products[0].name}`, { exact: true })).toHaveValue('10');
  await search.fill(barcode); await search.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Jumlah melebihi stok' })).toBeVisible();
  await page.getByLabel(`Jumlah ${products[0].name}`, { exact: true }).fill('3');
  await search.fill('00000000000000'); await search.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'tidak ditemukan atau produk tidak aktif' })).toBeVisible();
  await search.fill(inactiveBarcode); await search.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'tidak ditemukan atau produk tidak aktif' })).toBeVisible();
  await search.fill(emptyBarcode); await search.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'habis. Stok tersedia: 0' })).toBeVisible();
  await expect(page.getByLabel(`Jumlah ${products[0].name}`, { exact: true })).toHaveValue('3');
  await search.fill('nama produk'); await page.keyboard.press('F4');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(search).toHaveValue('nama produk');
  await search.fill(''); await page.getByLabel('Diskon (IDR)').focus();
  await page.keyboard.press('F2'); await expect(page.getByLabel('Diskon (IDR)')).toBeFocused();
  await page.keyboard.press('F8'); await expect(page).toHaveURL(/\/pos$/);
  await page.locator('body').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('F6'); await page.keyboard.press('F7'); await expect(page).toHaveURL(/\/pos$/);
  await page.keyboard.press('Control+F4'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('F4');
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Uang tunai diterima')).toBeFocused();
  await page.keyboard.press('F8'); await expect(page).toHaveURL(/\/pos$/);
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(search).toBeFocused();
  await page.locator('body').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('F8'); await expect(page).toHaveURL(/\/transactions$/);
  expect(await page.evaluate(() => window.__posShortcutListeners())).toBe(0);
  await page.getByRole('link', { name: 'Kasir', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tambah E2E product 1', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__posShortcutListeners())).toBe(1);
  await page.keyboard.press('F2'); await expect(page.getByLabel('Cari nama, SKU, atau pindai barcode')).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
