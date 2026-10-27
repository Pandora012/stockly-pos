import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { test, expect } from '@playwright/test';

let db; let users; let category; let product; let password;
test.beforeEach(async () => {
  db = new PrismaClient(); users = [];
  const suffix = crypto.randomUUID(); password = crypto.randomBytes(24).toString('hex');
  for (const role of ['ADMIN', 'CASHIER']) users.push(await db.user.create({ data: {
    name: `Catalog E2E ${role}`, email: `catalog-e2e-${role.toLowerCase()}-${suffix}@example.invalid`,
    passwordHash: await bcrypt.hash(password, 10), role
  } }));
  category = await db.category.create({ data: { name: 'Catalog E2E', slug: `catalog-e2e-${suffix}` } });
});
test.afterEach(async () => {
  if (category) {
    await db.stockMovement.deleteMany({ where: { product: { categoryId: category.id } } });
    await db.stockAdjustment.deleteMany({ where: { product: { categoryId: category.id } } });
    await db.product.deleteMany({ where: { categoryId: category.id } });
  }
  if (category) await db.category.delete({ where: { id: category.id } });
  if (users?.length) await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await db?.$disconnect(); product = null; category = null; users = [];
});

async function login(page, user) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Kata sandi', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.waitForURL('**/dashboard');
}

test('admin creates a product, records a bounded stock adjustment, and sees low-stock warning', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await login(page, users[0]);
  await page.getByRole('link', { name: 'Produk', exact: true }).click();
  await page.getByRole('button', { name: 'Tambah produk', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Tambah produk' });
  await editor.getByRole('button', { name: 'Tambah produk', exact: true }).click();
  await expect(editor.getByRole('alert').first()).toBeVisible();
  const sku = `CAT-E2E-${crypto.randomUUID()}`;
  await editor.getByLabel('Nama produk').fill('Produk audit stok');
  await editor.getByLabel('Kategori').selectOption(category.id);
  await editor.getByLabel('SKU').fill(sku);
  await editor.getByLabel('Harga beli (IDR)').fill('2000');
  await editor.getByLabel('Harga jual (IDR)').fill('5000');
  await editor.getByLabel('Stok awal').fill('3');
  await editor.getByLabel('Stok minimum').fill('2');
  await editor.getByRole('button', { name: 'Tambah produk', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Produk ditambahkan.' })).toBeVisible();
  product = await db.product.findUniqueOrThrow({ where: { sku: sku.toUpperCase() } });
  expect(product.stock).toBe(3);
  expect(await db.stockMovement.count({ where: { productId: product.id, type: 'INITIAL' } })).toBe(1);
  await page.getByRole('link', { name: 'Inventaris', exact: true }).click();
  await page.getByLabel('Cari produk atau SKU').fill(sku);
  await page.getByRole('button', { name: 'Sesuaikan', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sesuaikan stok' });
  await expect(dialog.getByLabel('Perubahan jumlah')).toBeFocused();
  await dialog.getByLabel('Perubahan jumlah').fill('-4');
  await dialog.getByLabel('Alasan').fill('Penyesuaian audit');
  await dialog.getByRole('button', { name: 'Simpan penyesuaian' }).click();
  await expect(dialog.getByRole('alert')).toContainText('jumlah tidak mencukupi');
  expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(3);
  await dialog.getByLabel('Perubahan jumlah').fill('-2');
  await dialog.getByRole('button', { name: 'Simpan penyesuaian' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Stok dan riwayat pergerakan diperbarui.' })).toBeVisible();
  expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(1);
  expect(await db.stockAdjustment.count({ where: { productId: product.id } })).toBe(1);
  await expect(page.locator('.inventory-section').first().getByRole('row').filter({ hasText: sku })).toContainText('1 (rendah)');
  await page.getByRole('button', { name: 'Riwayat', exact: true }).click();
  await expect(page.getByText('Penyesuaian audit')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('cashier cannot open inventory or mutate the product catalog', async ({ page }) => {
  await login(page, users[1]);
  await expect(page.getByRole('link', { name: 'Inventaris', exact: true })).toHaveCount(0);
  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Akses dibatasi' })).toBeVisible();
  await page.goto('/products');
  await expect(page.getByRole('button', { name: 'Tambah produk', exact: true })).toHaveCount(0);
  const csrf = await (await page.request.get('http://localhost:4100/api/auth/csrf')).json();
  const response = await page.request.post('http://localhost:4100/api/products', {
    headers: { 'x-csrf-token': csrf.csrfToken }, data: { name: 'Ditolak' }
  });
  expect(response.status()).toBe(403);
});
