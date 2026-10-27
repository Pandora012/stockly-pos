import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { test, expect } from '@playwright/test';

const ExcelJS = createRequire(import.meta.url)('exceljs');

let db; let users; let category; let product; let password;
test.beforeEach(async () => {
  db = new PrismaClient(); users = []; password = crypto.randomBytes(24).toString('hex');
  const suffix = crypto.randomUUID();
  for (const role of ['ADMIN', 'CASHIER']) users.push(await db.user.create({ data: { name: `Report E2E ${role}`, role,
    email: `report-e2e-${users.length}-${suffix}@example.invalid`, passwordHash: await bcrypt.hash(password, 10) } }));
  category = await db.category.create({ data: { name: 'Report E2E category', slug: `report-e2e-${suffix}` } });
  product = await db.product.create({ data: { name: 'Report E2E product', sku: `REPORT-E2E-${suffix}`, categoryId: category.id,
    purchasePrice: 99999, sellingPrice: 10000, stock: 2, minimumStock: 5 } });
  for (const createdAt of [new Date('2002-05-31T17:00:00Z'), new Date()]) {
    await db.sale.create({ data: { invoiceNumber: `REPORT-E2E-${crypto.randomUUID()}`, cashierId: users[1].id,
      cashierNameSnapshot: users[1].name, subtotal: 20000, discount: 1000, tax: 0, total: 19000,
      idempotencyKey: crypto.randomUUID(), requestHash: 'e2e', storeSnapshot: { storeName: 'Report fixture', currency: 'IDR' }, createdAt,
      items: { create: { productId: product.id, productNameSnapshot: product.name, skuSnapshot: product.sku,
        categoryIdSnapshot: category.id, categoryNameSnapshot: category.name, quantity: 2, unitPrice: 10000, unitCostSnapshot: 4000, lineTotal: 20000 } },
      payment: { create: { amountReceived: 20000, changeAmount: 1000 } } } });
  }
});
test.afterEach(async () => {
  if (users?.length) {
    const sale = { cashierId: { in: users.map((user) => user.id) } };
    await db.payment.deleteMany({ where: { sale } }); await db.saleItem.deleteMany({ where: { sale } }); await db.sale.deleteMany({ where: sale });
    if (product) await db.product.delete({ where: { id: product.id } });
    if (category) await db.category.delete({ where: { id: category.id } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  }
  await db?.$disconnect(); users = []; product = null; category = null;
});

async function login(page, user) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Kata sandi', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.waitForURL('**/dashboard');
}

test('admin sees live overview, filters reports, downloads workbook and handles empty/error states', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const overviewResponse = page.waitForResponse((response) => response.url().endsWith('/api/reports/overview') && response.status() === 200);
  await login(page, users[0]);
  const overview = await (await overviewResponse).json();
  const money = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
  await expect(page.locator('.metric-strip > div').filter({ hasText: 'Penjualan bruto hari ini' })).toContainText(money(overview.today.grossSales));
  await expect(page.getByRole('heading', { name: 'Lima produk terlaris (7 hari)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lihat struk' }).first()).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dashboard-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: 'Lihat struk' }).first().click();
  await expect(page.getByRole('article', { name: 'Struk transaksi' })).toBeVisible();
  await page.getByRole('link', { name: 'Ringkasan', exact: true }).click();
  await page.getByRole('link', { name: 'Buka laporan', exact: true }).click();
  await page.getByLabel('Dari tanggal', { exact: true }).fill('2002-06-01');
  await page.getByLabel('Sampai tanggal', { exact: true }).fill('2002-06-01');
  await page.getByRole('button', { name: 'Terapkan filter' }).click();
  await expect(page.locator('.report-period')).toContainText('2002-06-01 sampai 2002-06-01');
  await expect(page.locator('.metric-strip > div').filter({ hasText: 'Estimasi laba kotor' })).toContainText(money(11000));
  await expect(page.getByRole('heading', { name: 'Penjualan neto harian' })).toBeVisible();
  await expect(page.getByText('Report E2E product', { exact: true })).toBeVisible();
  await expect(page.getByText('Report E2E category', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Ringkasan', exact: true }).selectOption('monthly');
  await page.getByRole('button', { name: 'Terapkan filter' }).click();
  await expect(page.getByRole('heading', { name: 'Penjualan neto bulanan' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Unduh Excel', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('stockly-report-2002-06-01-2002-06-01.xlsx');
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(await download.path());
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Sales Summary', 'Transaction Details', 'Top Products', 'Stock Report']);
  expect(workbook.getWorksheet('Sales Summary').getRow(4).getCell(5).value).toBe(19000);
  await page.screenshot({ path: testInfo.outputPath('reports-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('reports-mobile.png'), fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel('Dari tanggal', { exact: true }).fill('2000-01-01');
  await page.getByLabel('Sampai tanggal', { exact: true }).fill('2000-01-01');
  await page.getByRole('button', { name: 'Terapkan filter' }).click();
  await expect(page.getByText('Belum ada penjualan pada periode ini.', { exact: true })).toBeVisible();
  await expect(page.getByText('Belum ada produk terjual pada periode ini.', { exact: true })).toBeVisible();
  await page.route('**/api/reports/sales?**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test report unavailable' }) }));
  await page.getByRole('button', { name: 'Terapkan filter' }).click();
  await expect(page.getByRole('button', { name: 'Coba lagi', exact: true })).toBeVisible();
  await page.unroute('**/api/reports/sales?**');
  await page.getByRole('button', { name: 'Coba lagi', exact: true }).click();
  await expect(page.getByText('Belum ada penjualan pada periode ini.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('cashier cannot navigate to admin reports or download exports', async ({ page }) => {
  await login(page, users[1]);
  await expect(page.getByRole('link', { name: 'Laporan', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Transaksi saya', exact: true })).toBeVisible();
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Akses dibatasi' })).toBeVisible();
  const response = await page.request.get('http://localhost:4100/api/reports/export');
  expect(response.status()).toBe(403);
});
