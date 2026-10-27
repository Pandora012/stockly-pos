import crypto from 'node:crypto';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { overview, reportRange, salesSummary, salesSeries } from '../src/report-data.js';
import { EXPORT_LIMIT, exportWorkbook, XLSX_TYPE } from '../src/report-workbook.js';

dotenv.config({ path: new URL('../../../.env', import.meta.url) });

describe.skipIf(!process.env.DATABASE_URL)('reports on PostgreSQL with Jakarta boundaries', () => {
  const db = new PrismaClient(); const suffix = crypto.randomUUID();
  const users = []; const categories = []; const products = []; let admin; let cashier; let app;
  const query = { from: '2001-02-01', to: '2001-02-01' };
  beforeAll(async () => {
    for (const role of ['ADMIN', 'CASHIER']) users.push(await db.user.create({ data: { name: '=Untrusted cashier',
      email: `reports-${users.length}-${suffix}@example.invalid`, passwordHash: await bcrypt.hash('test-password-46', 4), role } }));
    for (const index of [0, 1]) {
      const category = await db.category.create({ data: { name: `Category ${index}`, slug: `report-${index}-${suffix}` } }); categories.push(category);
      products.push(await db.product.create({ data: { name: index === 0 ? '=1+1' : 'Report product B',
        sku: `REPORT-${index}-${suffix}`, categoryId: category.id, stock: 5, minimumStock: 5, purchasePrice: 999999, sellingPrice: 999999 } }));
    }
    const sale = async (time, items, discount = 0, tax = 0) => {
      const subtotal = items.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0);
      return db.sale.create({ data: { invoiceNumber: `REPORT-${crypto.randomUUID()}`, cashierId: users[0].id,
        cashierNameSnapshot: users[0].name, subtotal, discount, tax, total: subtotal - discount + tax,
        createdAt: new Date(time), idempotencyKey: crypto.randomUUID(), requestHash: 'test', storeSnapshot: { storeName: 'Fixture', currency: 'IDR' },
        items: { create: items.map(({ index, ...row }) => ({ ...row, productId: products[index].id,
          productNameSnapshot: products[index].name, skuSnapshot: products[index].sku,
          categoryIdSnapshot: categories[index].id, categoryNameSnapshot: categories[index].name, lineTotal: row.quantity * row.unitPrice })) },
        payment: { create: { amountReceived: subtotal - discount + tax + 1000, changeAmount: 1000 } } } });
    };
    await sale('2001-01-31T16:59:59.999Z', [{ index: 0, quantity: 1, unitPrice: 1000, unitCostSnapshot: 500 }]);
    await sale('2001-01-31T17:00:00.000Z', [{ index: 0, quantity: 2, unitPrice: 10000, unitCostSnapshot: 4000 },
      { index: 1, quantity: 1, unitPrice: 10000, unitCostSnapshot: 5000 }], 3001, 2970);
    await sale('2001-02-01T16:59:59.999Z', [{ index: 1, quantity: 3, unitPrice: 5000, unitCostSnapshot: 1000 }]);
    await sale('2001-02-01T17:00:00.000Z', [{ index: 0, quantity: 1, unitPrice: 2000, unitCostSnapshot: 1000 }]);
    await sale('2001-02-28T17:00:00.000Z', [{ index: 1, quantity: 1, unitPrice: 7000, unitCostSnapshot: 2000 }]);
    app = createApp(db, { jwtSecret: crypto.randomBytes(48).toString('hex'), webOrigin: 'http://localhost:3000', sameSite: 'lax', production: false });
    admin = request.agent(app); cashier = request.agent(app);
    for (const [agent, user] of [[admin, users[0]], [cashier, users[1]]]) {
      const token = (await agent.get('/api/auth/csrf')).body.csrfToken;
      expect((await agent.post('/api/auth/login').set('x-csrf-token', token).send({ email: user.email, password: 'test-password-46' })).status).toBe(200);
    }
  });
  afterAll(async () => {
    const sale = { cashierId: { in: users.map((user) => user.id) } };
    await db.payment.deleteMany({ where: { sale } }); await db.saleItem.deleteMany({ where: { sale } }); await db.sale.deleteMany({ where: sale });
    await db.product.deleteMany({ where: { id: { in: products.map((product) => product.id) } } });
    await db.category.deleteMany({ where: { id: { in: categories.map((category) => category.id) } } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } }); await db.$disconnect();
  });

  it('aggregates real gross/net sales, quantities and profit from historical costs', async () => {
    const response = await admin.get('/api/reports/sales').query(query); expect(response.status).toBe(200);
    expect(response.body.timezone).toBe('Asia/Jakarta');
    expect(response.body.summary).toEqual({ grossSales: 45000, discount: 3001, netSales: 41999,
      tax: 2970, amountCollected: 44969, transactionCount: 2, unitsSold: 6, costOfGoods: 16000, grossProfit: 25999 });
    expect(response.body.series).toHaveLength(1); expect(response.body.series[0].period).toBe('2001-02-01');
    expect(response.body.categories.reduce((sum, row) => sum + row.netSales, 0)).toBe(41999);
    expect(response.body.categories.reduce((sum, row) => sum + row.grossProfit, 0)).toBe(25999);
  });

  it('ranks by quantity and preserves category and unit-cost snapshots after catalog edits', async () => {
    await db.product.update({ where: { id: products[0].id }, data: { name: 'Changed name', categoryId: categories[1].id, purchasePrice: 111111 } });
    const result = await admin.get('/api/reports/products').query({ ...query, pageSize: 1 }); expect(result.status).toBe(200);
    expect(result.body.total).toBe(2); expect(result.body.items[0]).toMatchObject({ id: products[1].id, unitsSold: 4, costOfGoods: 8000 });
    const next = await admin.get('/api/reports/products').query({ ...query, pageSize: 1, page: 2 });
    expect(next.body.items[0]).toMatchObject({ id: products[0].id, name: '=1+1', unitsSold: 2, costOfGoods: 8000 });
    const response = await admin.get('/api/reports/sales').query(query);
    expect(response.body.categories).toHaveLength(2); expect(response.body.summary.grossProfit).toBe(25999);
  });

  it('groups months at Jakarta midnight and fills empty days without fake sales', async () => {
    const response = await admin.get('/api/reports/sales').query({ from: '2001-02-01', to: '2001-03-01', groupBy: 'monthly' });
    expect(response.status).toBe(200);
    expect(response.body.series.map((row) => [row.period, row.grossSales])).toEqual([['2001-02', 47000], ['2001-03', 7000]]);
    const empty = await admin.get('/api/reports/sales').query({ from: '2000-01-01', to: '2000-01-02' });
    expect(empty.body.summary.transactionCount).toBe(0); expect(empty.body.summary.grossProfit).toBe(0);
    expect(empty.body.series).toHaveLength(2); expect(empty.body.categories).toEqual([]);
    expect((await admin.get('/api/reports/products').query({ from: '2000-01-01', to: '2000-01-02' })).body.items).toEqual([]);
  });

  it('does not depend on the PostgreSQL session timezone', async () => {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'America/New_York'`;
      expect((await salesSummary(tx, reportRange(query))).grossSales).toBe(45000);
      const series = await salesSeries(tx, reportRange(query));
      expect(series[0]).toMatchObject({ period: '2001-02-01', grossSales: 45000 });
    });
  });

  it('provides today, seven-day series and inventory counts from PostgreSQL', async () => {
    await db.$transaction(async (tx) => {
      const result = await overview({ $transaction: (callback) => callback(tx) }, new Date('2001-02-01T05:00:00Z'));
      expect(result.from).toBe('2001-02-01'); expect(result.today.grossSales).toBe(45000);
      expect(result.series).toHaveLength(7); expect(result.topProducts.length).toBeLessThanOrEqual(5);
      expect(result.activeProducts).toBe(await tx.product.count({ where: { isActive: true } }));
      expect(result.lowStockProducts).toBe(await tx.product.count({ where: { isActive: true, stock: { lte: tx.product.fields.minimumStock } } }));
    }, { isolationLevel: 'RepeatableRead' });
    expect((await admin.get('/api/reports/overview')).status).toBe(200);
  });

  it('rejects cashier and unauthenticated access and invalid/unbounded ranges', async () => {
    for (const path of ['overview', 'sales', 'products', 'export']) {
      expect((await request(app).get(`/api/reports/${path}`)).status).toBe(401);
      expect((await cashier.get(`/api/reports/${path}`)).status).toBe(403);
    }
    for (const params of [{ from: '2001-02-30' }, { from: '2001-02-02', to: '2001-02-01' }, { from: '2001-01-01', to: '2003-01-01' }, { timezone: 'UTC' }]) {
      expect((await admin.get('/api/reports/sales').query(params)).status).toBe(400);
    }
    expect((await admin.get('/api/reports/export').query({ from: '2001-01-01', to: '2001-12-31' })).status).toBe(400);
    const capped = { $transaction: (callback) => callback({ sale: { count: async () => EXPORT_LIMIT + 1 }, product: { count: async () => 1 } }) };
    await expect(exportWorkbook(capped, reportRange(query))).rejects.toMatchObject({ status: 413 });
  });

  it('exports a valid formatted four-sheet workbook with text cells and filtered totals', async () => {
    const response = await admin.get('/api/reports/export').query(query).buffer(true).parse((res, callback) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
    expect(response.status).toBe(200); expect(response.headers['content-type']).toContain(XLSX_TYPE);
    expect(response.headers['content-disposition']).toContain('2001-02-01-2001-02-01.xlsx');
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(response.body);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Sales Summary', 'Transaction Details', 'Top Products', 'Stock Report']);
    const sales = workbook.getWorksheet('Sales Summary'); expect(sales.getRow(4).getCell(3).value).toBe(45000);
    expect(sales.getRow(4).getCell(3).numFmt).toContain('Rp'); expect(sales.autoFilter).toBeTruthy();
    const details = workbook.getWorksheet('Transaction Details'); expect(details.rowCount).toBe(6);
    expect(details.getRow(4).getCell(2).value.toISOString()).toBe('2001-02-01T00:00:00.000Z');
    expect(details.getRow(4).getCell(3).value).toBe('=Untrusted cashier'); expect(details.getRow(4).getCell(3).type).toBe(ExcelJS.ValueType.String);
    const top = workbook.getWorksheet('Top Products'); expect(top.getRow(5).getCell(1).value).toBe('=1+1');
    expect(top.getRow(5).getCell(1).type).toBe(ExcelJS.ValueType.String);
    expect(top.getRow(top.rowCount).getCell(5).value).toBe(41999);
    const empty = await exportWorkbook(db, reportRange({ from: '2000-01-01', to: '2000-01-01' }));
    const emptyWorkbook = new ExcelJS.Workbook(); await emptyWorkbook.xlsx.load(empty);
    expect(emptyWorkbook.worksheets).toHaveLength(4); expect(emptyWorkbook.getWorksheet('Transaction Details').rowCount).toBe(4);
  });
});
