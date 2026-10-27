import crypto from 'node:crypto';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createApp } from '../src/app.js';

dotenv.config({ path: new URL('../../../.env', import.meta.url) });

const integration = process.env.DATABASE_URL ? it : it.skip;

integration('catalog and stock controls against PostgreSQL', async () => {
  const db = new PrismaClient();
  const suffix = crypto.randomUUID().slice(0, 8);
  const password = `test-password-${suffix}-long`;
  const barcode = crypto.randomInt(1e12, 1e13).toString();
  const users = [];
  const products = [];
  const categories = [];
  try {
    await db.$connect();
    for (const role of ['ADMIN', 'CASHIER']) {
      const user = await db.user.create({ data: {
        name: `Catalog ${role}`, email: `catalog-${role.toLowerCase()}-${suffix}@example.invalid`,
        passwordHash: await bcrypt.hash(password, 10), role
      } });
      users.push(user);
    }
    const app = createApp(db, { jwtSecret: crypto.randomBytes(48).toString('hex'),
      webOrigin: 'http://localhost:3000', sameSite: 'lax', production: false });
    const admin = request.agent(app);
    const cashier = request.agent(app);
    const csrf = async (agent) => (await agent.get('/api/auth/csrf')).body.csrfToken;
    const mutate = async (agent, method, path, body) => {
      const token = await csrf(agent);
      return agent[method](path).set('x-csrf-token', token).send(body);
    };
    const adminLogin = await mutate(admin, 'post', '/api/auth/login', { email: users[0].email, password });
    expect(adminLogin.status).toBe(200);
    expect((await mutate(cashier, 'post', '/api/auth/login', { email: users[1].email, password })).status).toBe(200);
    const createdCategory = await mutate(admin, 'post', '/api/categories', { name: 'Test category', slug: `test-${suffix}` });
    expect(createdCategory.status).toBe(201);
    expect((await mutate(cashier, 'post', '/api/categories', { name: 'Denied' })).status).toBe(403);
    categories.push(createdCategory.body.category.id);
    const categoryId = categories[0];
    const input = { categoryId, name: `Test item ${suffix}`, sku: `TEST-${suffix}-001`, barcode,
      purchasePrice: 1000, sellingPrice: 2000, minimumStock: 5, initialStock: 3 };
    expect((await mutate(cashier, 'post', '/api/products', input)).status).toBe(403);
    const created = await mutate(admin, 'post', '/api/products', input);
    expect(created.status).toBe(201);
    products.push(created.body.product.id);
    const productId = products[0];
    expect(created.body.product.stock).toBe(3);
    expect(await db.stockMovement.count({ where: { productId, type: 'INITIAL' } })).toBe(1);

    expect((await mutate(admin, 'post', '/api/products', { ...input, barcode: null })).status).toBe(409);
    expect((await mutate(admin, 'post', '/api/products', { ...input, sku: `TEST-${suffix}-002` })).status).toBe(409);
    expect((await mutate(admin, 'post', '/api/products', { ...input, sku: `TEST-${suffix}-003`, barcode: null, sellingPrice: -1 })).status).toBe(400);
    expect((await mutate(admin, 'patch', `/api/products/${productId}`, { stock: 99 })).status).toBe(400);

    const second = await mutate(admin, 'post', '/api/products', { ...input, name: `Test item two ${suffix}`,
      sku: `TEST-${suffix}-002`, barcode: null, initialStock: 12 });
    expect(second.status).toBe(201);
    products.push(second.body.product.id);
    const found = await admin.get('/api/products').query({ q: `TEST-${suffix}`, categoryId, page: 1, pageSize: 1 });
    expect(found.status).toBe(200);
    expect(found.body.total).toBe(2);
    expect(found.body.items).toHaveLength(1);
    const nextPage = await admin.get('/api/products').query({ q: `TEST-${suffix}`, categoryId, page: 2, pageSize: 1 });
    expect(nextPage.body.items).toHaveLength(1);
    expect(nextPage.body.items[0].id).not.toBe(found.body.items[0].id);
    expect((await admin.get('/api/products').query({ q: barcode })).body.total).toBe(1);
    expect((await cashier.get('/api/products').query({ barcode, pageSize: 1 })).body.items[0].id).toBe(productId);
    expect((await cashier.get('/api/products').query({ barcode: `${barcode}0` })).body.total).toBe(0);
    expect((await cashier.get('/api/products').query({ barcode: 'invalid' })).status).toBe(400);
    expect((await admin.get('/api/products').query({ categoryId, lowStock: true })).body.total).toBe(1);
    expect((await cashier.get(`/api/products/${productId}`)).status).toBe(200);

    const adjusted = await mutate(admin, 'post', '/api/inventory/adjustments', {
      productId, quantityChange: -2, reason: 'Damaged test item'
    });
    expect(adjusted.status).toBe(201);
    expect(adjusted.body.movement.stockBefore).toBe(3);
    expect(adjusted.body.movement.stockAfter).toBe(1);
    expect(adjusted.body.movement.referenceId).toBe(adjusted.body.adjustment.id);
    expect((await db.product.findUnique({ where: { id: productId } })).stock).toBe(1);
    expect((await mutate(admin, 'post', '/api/inventory/adjustments', {
      productId, quantityChange: -2, reason: 'Should fail'
    })).status).toBe(409);
    expect(await db.stockMovement.count({ where: { productId } })).toBe(2);
    expect(await db.stockAdjustment.count({ where: { productId } })).toBe(1);
    expect((await cashier.get('/api/inventory')).status).toBe(403);
    expect((await mutate(cashier, 'post', '/api/inventory/adjustments', {
      productId, quantityChange: 1, reason: 'Denied'
    })).status).toBe(403);
    expect((await admin.get('/api/inventory/movements').query({ productId })).body.total).toBe(2);
    const today = new Date().toISOString().slice(0, 10);
    expect((await admin.get('/api/inventory/movements').query({ productId, from: today, to: today })).body.total).toBe(2);

    const csrfResponse = await admin.get('/api/auth/csrf');
    const sessionCookie = adminLogin.headers['set-cookie'].find((cookie) => cookie.startsWith('stockly_session=')).split(';')[0];
    const csrfCookie = csrfResponse.headers['set-cookie'].find((cookie) => cookie.startsWith('stockly_csrf=')).split(';')[0];
    const concurrent = () => request(app).post('/api/inventory/adjustments')
      .set('Cookie', `${sessionCookie}; ${csrfCookie}`).set('x-csrf-token', csrfResponse.body.csrfToken)
      .send({ productId, quantityChange: -1, reason: 'Concurrent adjustment test' });
    const results = await Promise.all([concurrent(), concurrent()]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect((await db.product.findUnique({ where: { id: productId } })).stock).toBe(0);
    expect(await db.stockMovement.count({ where: { productId } })).toBe(3);
    expect(await db.stockAdjustment.count({ where: { productId } })).toBe(2);

    const deactivated = await mutate(admin, 'patch', `/api/products/${productId}`, { isActive: false });
    expect(deactivated.status).toBe(200);
    expect((await cashier.get(`/api/products/${productId}`)).status).toBe(404);
    expect((await cashier.get('/api/products').query({ barcode })).body.total).toBe(0);
    expect((await admin.get('/api/products').query({ barcode, isActive: 'false' })).body.total).toBe(1);
    expect((await cashier.get('/api/products').query({ q: `TEST-${suffix}` })).body.total).toBe(1);
    expect((await admin.get('/api/products').query({ categoryId, isActive: 'false' })).body.total).toBe(1);
    expect((await mutate(admin, 'patch', `/api/categories/${categoryId}`, { isActive: false })).status).toBe(200);
    expect((await cashier.get('/api/products').query({ q: `TEST-${suffix}` })).body.total).toBe(0);
    expect((await cashier.get(`/api/products/${products[1]}`)).status).toBe(404);
    expect((await cashier.get('/api/categories')).body.categories.some((category) => category.id === categoryId)).toBe(false);
  } finally {
    if (products.length) {
      await db.stockMovement.deleteMany({ where: { productId: { in: products } } });
      await db.stockAdjustment.deleteMany({ where: { productId: { in: products } } });
      await db.product.deleteMany({ where: { id: { in: products } } });
    }
    if (categories.length) await db.category.deleteMany({ where: { id: { in: categories } } });
    if (users.length) await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    await db.$disconnect();
  }
}, 30_000);
