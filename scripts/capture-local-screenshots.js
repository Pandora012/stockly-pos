import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { chromium } from '@playwright/test';

if (process.env.NODE_ENV === 'production') throw new Error('Screenshots require a local development database.');
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) throw new Error('Set local ADMIN_EMAIL and ADMIN_PASSWORD in .env.');

const db = new PrismaClient();
try {
  const admin = await db.user.findUnique({ where: { email: process.env.ADMIN_EMAIL.trim().toLowerCase() } });
  if (!admin || admin.role !== 'ADMIN' || await db.user.count() !== 1 ||
      await db.product.count({ where: { NOT: { sku: { startsWith: 'DEMO-' } } } }) ||
      await db.supplier.count({ where: { NOT: { name: { startsWith: 'DEMO:' } } } }) ||
      await db.purchaseOrder.count({ where: { NOT: { poNumber: { startsWith: 'DEMO-' } } } }) ||
      await db.sale.count({ where: { NOT: { invoiceNumber: { startsWith: 'DEMO-' } } } })) {
    throw new Error('Screenshots need a dedicated demo-only database: no real users or store records may be captured.');
  }
} finally { await db.$disconnect(); }

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://localhost:3000/login');
  await page.getByLabel('Email', { exact: true }).fill(process.env.ADMIN_EMAIL);
  await page.getByLabel('Kata sandi', { exact: true }).fill(process.env.ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.waitForURL('**/dashboard');
  await mkdir('docs/screenshots', { recursive: true });

  const views = [
    ['/dashboard', 'dashboard.png', 'DEMO-INV-001'],
    ['/pos', 'pos-cashier.png', 'DEMO-MIN-001'],
    ['/products', 'products.png', 'DEMO-MIN-001'],
    ['/inventory', 'inventory.png', 'DEMO-MIN-001'],
    ['/suppliers', 'suppliers.png', 'DEMO: Mitra Grosir Fiktif'],
    ['/purchases', 'purchase-orders.png', 'DEMO-PO-001'],
    ['/reports', 'sales-reports.png', 'Penjualan per kategori']
  ];
  for (const [url, filename, text] of views) {
    await page.goto(`http://localhost:3000${url}`);
    await page.getByText(text, { exact: url === '/dashboard' || url === '/suppliers' }).first().waitFor();
    if (url === '/reports') {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric',
        month: '2-digit', day: '2-digit' }).format(new Date());
      await page.getByLabel('Dari tanggal', { exact: true }).fill(today);
      await page.getByRole('button', { name: 'Terapkan filter' }).click();
      await page.getByText(`Periode diterapkan: ${today} sampai ${today} (Asia/Jakarta)`).waitFor();
    }
    if (url === '/dashboard' || url === '/reports') await page.locator('.recharts-surface').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `docs/screenshots/${filename}`, fullPage: true });
    console.log(`Captured docs/screenshots/${filename}`);
  }
  if (errors.length) throw new Error(`Browser page errors: ${errors.join(' | ')}`);
} finally { await browser.close(); }
