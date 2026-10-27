import crypto from 'node:crypto';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { receivePurchase } from '../src/purchases.js';

dotenv.config({ path: new URL('../../../.env', import.meta.url) });

describe.skipIf(!process.env.DATABASE_URL)('suppliers and full-order restocking on PostgreSQL', () => {
  const db = new PrismaClient(); const suffix = crypto.randomUUID();
  const users = []; const suppliers = []; const products = []; let category; let app; let admin; let cashier;
  beforeAll(async () => {
    for (const role of ['ADMIN', 'CASHIER']) users.push(await db.user.create({ data: { name: `Purchase test ${role}`,
      email: `purchase-${users.length}-${suffix}@example.invalid`, passwordHash: await bcrypt.hash('test-password-46', 4), role } }));
    category = await db.category.create({ data: { name: 'Purchase tests', slug: `purchase-${suffix}` } });
    suppliers.push(await db.supplier.create({ data: { name: `Supplier ${suffix}` } }));
    for (const index of [0, 1]) products.push(await db.product.create({ data: { name: `Purchase fixture ${index}`,
      sku: `PURCHASE-${index}-${suffix}`, categoryId: category.id, stock: 5, purchasePrice: 1700, sellingPrice: 5000 } }));
    app = createApp(db, { jwtSecret: crypto.randomBytes(48).toString('hex'), webOrigin: 'http://localhost:3000', sameSite: 'lax', production: false });
    admin = request.agent(app); cashier = request.agent(app);
    for (const [agent, user] of [[admin, users[0]], [cashier, users[1]]]) {
      expect((await mutate(agent, 'post', '/api/auth/login', { email: user.email, password: 'test-password-46' })).status).toBe(200);
    }
  });
  afterAll(async () => {
    await db.stockMovement.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
    if (users[0]) {
      await db.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { createdById: users[0].id } } });
      await db.purchaseOrder.deleteMany({ where: { createdById: users[0].id } });
    }
    await db.supplier.deleteMany({ where: { id: { in: suppliers.map((supplier) => supplier.id) } } });
    await db.product.deleteMany({ where: { id: { in: products.map((product) => product.id) } } });
    if (category) await db.category.delete({ where: { id: category.id } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } }); await db.$disconnect();
  });
  async function mutate(agent, method, path, body) {
    const token = (await agent.get('/api/auth/csrf')).body.csrfToken;
    return agent[method](path).set('x-csrf-token', token).send(body);
  }
  const draft = (items = [{ productId: products[0].id, quantity: 3, unitCost: 2300 }]) => ({ supplierId: suppliers[0].id, items });
  async function createOrdered(items) {
    const response = await mutate(admin, 'post', '/api/purchases', draft(items)); expect(response.status).toBe(201);
    const order = await mutate(admin, 'post', `/api/purchases/${response.body.purchase.id}/order`, { version: 0 });
    expect(order.status).toBe(200); return order.body.purchase;
  }

  it('creates, searches, reads and deactivates suppliers without losing history', async () => {
    const created = await mutate(admin, 'post', '/api/suppliers', { name: `Contact ${suffix}`, contactPerson: 'Buyer', phone: '081234', email: 'BUYER@example.invalid', notes: 'Fixture' });
    expect(created.status).toBe(201); suppliers.push(created.body.supplier);
    const id = created.body.supplier.id;
    expect((await admin.get(`/api/suppliers/${id}`)).body.supplier.email).toBe('buyer@example.invalid');
    expect((await admin.get('/api/suppliers').query({ q: `Contact ${suffix}`, pageSize: 1 })).body.total).toBe(1);
    expect((await mutate(admin, 'patch', `/api/suppliers/${id}`, { isActive: false })).body.supplier.isActive).toBe(false);
    expect((await db.supplier.findUnique({ where: { id } })).notes).toBe('Fixture');
    expect((await mutate(admin, 'post', '/api/purchases', { ...draft(), supplierId: id })).status).toBe(409);
    expect((await admin.get('/api/purchases').query({ supplierId: id })).body.items).toEqual([]);
  });

  it('recalculates integer totals and rejects zero, negative, fractional or repeated quantities/products', async () => {
    const body = draft([{ productId: products[0].id, quantity: 3, unitCost: 2300 }, { productId: products[1].id, quantity: 2, unitCost: 4000 }]);
    const response = await mutate(admin, 'post', '/api/purchases', body);
    expect(response.status).toBe(201); expect(response.body.purchase.totalAmount).toBe(14900);
    expect(response.body.purchase.items.map((row) => row.lineTotal).sort((a, b) => a - b)).toEqual([6900, 8000]);
    expect((await mutate(admin, 'post', '/api/purchases', { ...body, totalAmount: 1 })).status).toBe(400);
    for (const quantity of [0, -1, 1.5, '1', 10001]) expect((await mutate(admin, 'post', '/api/purchases', draft([{ productId: products[0].id, quantity, unitCost: 1000 }]))).status).toBe(400);
    expect((await mutate(admin, 'post', '/api/purchases', draft([{ productId: products[0].id, quantity: 1, unitCost: 0 }]))).status).toBe(400);
    expect((await mutate(admin, 'post', '/api/purchases', draft([body.items[0], body.items[0]]))).status).toBe(400);
    expect((await mutate(admin, 'post', '/api/purchases', draft([{ productId: products[0].id, quantity: 10000, unitCost: 1000000000 }]))).status).toBe(400);
  });

  it('only edits version-matching drafts and refuses early receiving', async () => {
    const response = await mutate(admin, 'post', '/api/purchases', draft()); const po = response.body.purchase;
    expect((await mutate(admin, 'post', `/api/purchases/${po.id}/receive`, {})).status).toBe(409);
    const changed = await mutate(admin, 'patch', `/api/purchases/${po.id}`, { ...draft([{ productId: products[0].id, quantity: 2, unitCost: 5000 }]), version: 0 });
    expect(changed.body.purchase.totalAmount).toBe(10000); expect(changed.body.purchase.version).toBe(1);
    expect((await mutate(admin, 'patch', `/api/purchases/${po.id}`, { ...draft(), version: 0 })).status).toBe(409);
    expect((await mutate(admin, 'post', `/api/purchases/${po.id}/order`, { version: 0 })).status).toBe(409);
    expect((await mutate(admin, 'post', `/api/purchases/${po.id}/order`, { version: 1 })).body.purchase.status).toBe('ORDERED');
    expect((await mutate(admin, 'patch', `/api/purchases/${po.id}`, { ...draft(), version: 2 })).status).toBe(409);
  });

  it('receives full orders with preserved costs, linked movements, and harmless retries', async () => {
    const po = await createOrdered();
    const before = await db.product.findUniqueOrThrow({ where: { id: products[0].id } });
    await db.product.update({ where: { id: products[0].id }, data: { name: 'Renamed after order', purchasePrice: 8888 } });
    const result = await mutate(admin, 'post', `/api/purchases/${po.id}/receive`, {});
    expect(result.body.replayed).toBe(false); expect(result.body.purchase.status).toBe('RECEIVED');
    expect(result.body.purchase.receivedById).toBe(users[0].id);
    const after = await db.product.findUniqueOrThrow({ where: { id: products[0].id } });
    expect(after.stock).toBe(before.stock + 3); expect(after.purchasePrice).toBe(2300);
    const movement = await db.stockMovement.findFirstOrThrow({ where: { referenceType: 'PURCHASE_ORDER', referenceId: po.id } });
    expect(movement).toMatchObject({ type: 'IN', quantityChange: 3, stockBefore: before.stock, stockAfter: before.stock + 3, userId: users[0].id });
    expect((await mutate(admin, 'post', `/api/purchases/${po.id}/receive`, {})).body.replayed).toBe(true);
    expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(after.stock);
    await db.product.update({ where: { id: products[0].id }, data: { purchasePrice: 9999 } });
    const details = await admin.get(`/api/purchases/${po.id}`);
    expect(details.body.purchase.items[0]).toMatchObject({ unitCost: 2300, productNameSnapshot: po.items[0].productNameSnapshot });
    expect(details.body.movements).toHaveLength(1);
    expect((await admin.get('/api/purchases').query({ supplierId: suppliers[0].id, q: po.poNumber })).body.total).toBe(1);
    expect((await mutate(admin, 'post', `/api/purchases/${po.id}/receive`, { quantity: 1 })).status).toBe(400);
  });

  it('serializes concurrent receives so the same PO restocks once', async () => {
    const po = await createOrdered(); const before = (await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock;
    const csrf = await admin.get('/api/auth/csrf');
    const signed = await mutate(admin, 'post', '/api/auth/login', { email: users[0].email, password: 'test-password-46' });
    const cookies = [csrf.headers['set-cookie'][0].split(';')[0], signed.headers['set-cookie'][0].split(';')[0]].join('; ');
    const receive = () => request(app).post(`/api/purchases/${po.id}/receive`).set('Cookie', cookies).set('x-csrf-token', csrf.body.csrfToken).send({});
    const results = await Promise.all([receive(), receive()]);
    expect(results.map((entry) => entry.status)).toEqual([200, 200]);
    expect(results.map((entry) => entry.body.replayed).sort()).toEqual([false, true]);
    expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(before + 3);
    expect(await db.stockMovement.count({ where: { referenceId: po.id, referenceType: 'PURCHASE_ORDER' } })).toBe(1);
  });

  it('rolls back status, stock, costs and ledger if receiving fails midway', async () => {
    const po = await createOrdered([{ productId: products[0].id, quantity: 2, unitCost: 3100 }, { productId: products[1].id, quantity: 1, unitCost: 3200 }]);
    const before = await db.product.findMany({ where: { id: { in: products.map((row) => row.id) } }, orderBy: { id: 'asc' } });
    const broken = { $transaction: (callback, options) => db.$transaction((tx) => callback(new Proxy(tx, {
      get(target, key) { return key === 'stockMovement' ? { create: () => { throw new Error('Injected receiving ledger failure'); } } : target[key]; }
    })), options) };
    await expect(receivePurchase(broken, po.id, users[0].id)).rejects.toThrow('Injected receiving ledger failure');
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('ORDERED');
    const after = await db.product.findMany({ where: { id: { in: products.map((row) => row.id) } }, orderBy: { id: 'asc' } });
    expect(after.map(({ stock, purchasePrice }) => ({ stock, purchasePrice }))).toEqual(before.map(({ stock, purchasePrice }) => ({ stock, purchasePrice })));
    expect(await db.stockMovement.count({ where: { referenceId: po.id } })).toBe(0);
  });

  it('does not lose increments when different POs receive the same product concurrently', async () => {
    const first = await createOrdered([{ productId: products[0].id, quantity: 3, unitCost: 2500 }]);
    const second = await createOrdered([{ productId: products[0].id, quantity: 4, unitCost: 2600 }]);
    const before = (await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock;
    await Promise.all([receivePurchase(db, first.id, users[0].id), receivePurchase(db, second.id, users[0].id)]);
    expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).stock).toBe(before + 7);
    const movements = await db.stockMovement.findMany({ where: { referenceId: { in: [first.id, second.id] }, referenceType: 'PURCHASE_ORDER' }, orderBy: { stockBefore: 'asc' } });
    expect(movements).toHaveLength(2); expect(movements[0].stockBefore).toBe(before);
    expect(movements[1].stockBefore).toBe(movements[0].stockAfter); expect(movements[1].stockAfter).toBe(before + 7);
  });

  it('rejects stock overflow atomically and permits receiving already-ordered inactive goods', async () => {
    const po = await createOrdered([{ productId: products[1].id, quantity: 2, unitCost: 4500 }]);
    await db.product.update({ where: { id: products[1].id }, data: { stock: 1000000000 } });
    expect((await mutate(admin, 'post', `/api/purchases/${po.id}/receive`, {})).status).toBe(409);
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('ORDERED');
    await db.product.update({ where: { id: products[1].id }, data: { stock: 5, isActive: false } });
    await db.supplier.update({ where: { id: suppliers[0].id }, data: { isActive: false } });
    expect((await mutate(admin, 'post', `/api/purchases/${po.id}/receive`, {})).status).toBe(200);
    expect((await db.product.findUniqueOrThrow({ where: { id: products[1].id } })).stock).toBe(7);
    await db.supplier.update({ where: { id: suppliers[0].id }, data: { isActive: true } });
  });

  it('restricts every supplier/purchase operation to admin', async () => {
    const id = crypto.randomUUID();
    for (const path of ['/api/suppliers', `/api/suppliers/${suppliers[0].id}`, '/api/purchases', `/api/purchases/${id}`]) {
      expect((await request(app).get(path)).status).toBe(401); expect((await cashier.get(path)).status).toBe(403);
    }
    for (const [method, path, body] of [['post', '/api/suppliers', { name: 'Denied' }], ['patch', `/api/suppliers/${suppliers[0].id}`, { isActive: false }],
      ['post', '/api/purchases', draft()], ['patch', `/api/purchases/${id}`, draft()], ['post', `/api/purchases/${id}/order`, { version: 0 }], ['post', `/api/purchases/${id}/receive`, {}]]) {
      expect((await mutate(cashier, method, path, body)).status).toBe(403);
    }
    expect((await cashier.get('/api/products')).status).toBe(200);
  });
});
