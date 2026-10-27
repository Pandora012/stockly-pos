import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { test, expect } from '@playwright/test';

let db; let users; let suppliers; let products; let category; let password; let suffix;
test.beforeEach(async () => {
  db = new PrismaClient(); users = []; suppliers = []; products = []; suffix = crypto.randomUUID(); password = crypto.randomBytes(24).toString('hex');
  for (const role of ['ADMIN', 'CASHIER']) users.push(await db.user.create({ data: { name: `Purchase E2E ${role}`,
    email: `purchase-e2e-${users.length}-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 10), role } }));
  category = await db.category.create({ data: { name: 'Purchase E2E', slug: `purchase-e2e-${suffix}` } });
  suppliers.push(await db.supplier.create({ data: { name: `Restock supplier ${suffix}` } }));
  for (const index of [1, 2]) products.push(await db.product.create({ data: { name: `Restock E2E product ${index}`,
    sku: `PURCHASE-E2E-${suffix}-${index}`, categoryId: category.id, purchasePrice: 1700, sellingPrice: 5000, stock: 5 } }));
});
test.afterEach(async () => {
  if (users?.[0]) {
    await db.stockMovement.deleteMany({ where: { userId: users[0].id } });
    await db.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { createdById: users[0].id } } });
    await db.purchaseOrder.deleteMany({ where: { createdById: users[0].id } });
    await db.supplier.deleteMany({ where: { id: { in: suppliers.map((supplier) => supplier.id) } } });
    await db.product.deleteMany({ where: { id: { in: products.map((product) => product.id) } } });
    if (category) await db.category.delete({ where: { id: category.id } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  }
  await db?.$disconnect(); users = []; category = null;
});

async function login(page, user = users[0]) {
  await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Kata sandi', { exact: true }).fill(password); await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.waitForURL('**/dashboard');
}
async function chooseProducts(page, supplier = suppliers[0]) {
  await page.getByLabel('Cari supplier aktif').fill(supplier.name);
  await page.getByRole('button', { name: 'Pilih supplier', exact: true }).click();
  await page.getByLabel('Cari nama produk atau SKU').fill(`PURCHASE-E2E-${suffix}`);
  for (const product of products) await page.getByRole('button', { name: `Tambah ${product.name}`, exact: true }).click();
}

test('admin manages supplier, builds and edits a PO, receives full stock and follows references', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await login(page); await page.getByRole('link', { name: 'Supplier', exact: true }).click();
  await page.getByLabel('Cari supplier atau kontak').fill(`unmatched-${suffix}`);
  await expect(page.getByText('Belum ada data untuk filter ini.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tambah supplier', exact: true }).click();
  const name = `UI restock ${suffix}`;
  await page.getByLabel('Nama supplier', { exact: true }).fill(name);
  await page.getByLabel('Kontak person', { exact: true }).fill('Kontak uji');
  await page.getByLabel('Email', { exact: true }).fill('supplier-test@example.invalid');
  await page.getByRole('button', { name: 'Simpan supplier', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Supplier disimpan.' })).toBeVisible();
  const supplier = await db.supplier.findFirstOrThrow({ where: { name } }); suppliers.push(supplier);
  await page.getByLabel('Cari supplier atau kontak').fill(name);
  await page.getByRole('button', { name: 'Ubah', exact: true }).click();
  await page.getByLabel('Telepon', { exact: true }).fill('08123456789');
  await page.getByRole('button', { name: 'Simpan supplier', exact: true }).click();
  await page.getByRole('button', { name: 'Nonaktifkan', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Supplier dinonaktifkan.' })).toBeVisible();
  await page.getByRole('button', { name: 'Aktifkan', exact: true }).click();
  await page.getByRole('button', { name: 'Detail / riwayat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Riwayat purchase order' })).toBeVisible();
  await page.getByRole('link', { name: 'Pembelian', exact: true }).click();
  await page.getByRole('link', { name: 'Buat PO', exact: true }).click();
  await chooseProducts(page, supplier);
  await page.getByLabel(`Jumlah ${products[0].name}`, { exact: true }).fill('3');
  await page.getByLabel(`Biaya satuan ${products[0].name}`, { exact: true }).fill('2300');
  await page.getByLabel(`Jumlah ${products[1].name}`, { exact: true }).fill('2');
  await page.getByLabel(`Biaya satuan ${products[1].name}`, { exact: true }).fill('4000');
  await page.screenshot({ path: testInfo.outputPath('purchase-builder-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Simpan draf', exact: true }).click();
  await page.waitForURL(/\/purchases\/[0-9a-f-]+$/);
  const id = page.url().split('/').at(-1);
  expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id } })).totalAmount).toBe(14900);
  expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(5);
  await page.getByRole('button', { name: 'Ubah draf', exact: true }).click();
  await page.getByLabel(`Jumlah ${products[1].name}`, { exact: true }).fill('0');
  await expect(page.getByRole('button', { name: 'Simpan draf', exact: true })).toBeDisabled();
  await page.getByLabel(`Jumlah ${products[1].name}`, { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Simpan draf', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draf diperbarui.' })).toBeVisible();
  await page.getByRole('button', { name: 'Tandai dipesan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Terima semua stok', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Terima semua stok', exact: true }).click();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Terima semua stok', exact: true }).click();
  await page.getByRole('button', { name: 'Konfirmasi terima semua', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'PO diterima.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pergerakan stok terkait' })).toBeVisible();
  expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(8);
  expect((await db.product.findUniqueOrThrow({ where: { id: products[1].id } })).stock).toBe(9);
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });
  expect(po.totalAmount).toBe(22900); expect(po.status).toBe('RECEIVED');
  await expect(page.getByRole('button', { name: 'Terima semua stok', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('purchase-received-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('purchase-received-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('link', { name: 'Riwayat pembelian supplier', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Buka PO', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Inventaris', exact: true }).click();
  await page.getByLabel('Cari produk atau SKU').fill(products[0].sku);
  await page.getByRole('button', { name: 'Riwayat', exact: true }).click();
  await page.getByRole('link', { name: po.poNumber, exact: true }).click();
  await expect(page.getByRole('heading', { name: po.poNumber, exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('retrying a lost receive response is safe and cashier routes are blocked', async ({ page }) => {
  await login(page); await page.goto('/purchases/new'); await chooseProducts(page);
  await page.getByRole('button', { name: 'Simpan draf', exact: true }).click();
  await page.waitForURL(/\/purchases\/[0-9a-f-]+$/); const id = page.url().split('/').at(-1);
  await page.getByRole('button', { name: 'Tandai dipesan', exact: true }).click();
  let lost = false;
  await page.route(`**/api/purchases/${id}/receive`, async (route) => {
    if (!lost) { lost = true; await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await page.getByRole('button', { name: 'Terima semua stok', exact: true }).click();
  await page.getByRole('button', { name: 'Konfirmasi terima semua', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Tidak dapat terhubung');
  await page.getByRole('button', { name: 'Konfirmasi terima semua', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tidak ada penambahan stok ulang.' })).toBeVisible();
  expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(6);
  expect(await db.stockMovement.count({ where: { referenceType: 'PURCHASE_ORDER', referenceId: id } })).toBe(2);
  await page.getByRole('button', { name: 'Keluar', exact: true }).click(); await page.waitForURL('**/login');
  await login(page, users[1]);
  await expect(page.getByRole('link', { name: 'Pembelian', exact: true })).toHaveCount(0);
  for (const path of ['/suppliers', '/purchases', '/purchases/new', `/purchases/${id}`]) {
    await page.goto(path); await expect(page.getByRole('heading', { name: 'Akses dibatasi' })).toBeVisible();
  }
});
