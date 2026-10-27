import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from './catalog.js';
import { purchaseTotal } from '../../../shared/purchases.js';

const uuid = z.string().uuid();
const supplierInput = z.object({ name: z.string().trim().min(1).max(160),
  contactPerson: z.string().trim().max(120).optional(), phone: z.string().trim().max(30).optional(),
  email: z.string().trim().toLowerCase().max(255).refine((value) => !value || z.string().email().safeParse(value).success).optional(),
  address: z.string().trim().max(500).optional(), notes: z.string().trim().max(1000).optional(), isActive: z.boolean().optional()
}).strict();
const draftInput = z.object({ supplierId: uuid,
  items: z.array(z.object({ productId: uuid, quantity: z.number().int().min(1).max(10000),
    unitCost: z.number().int().min(1).max(1000000000) }).strict()).min(1).max(100)
}).strict().refine((value) => new Set(value.items.map((item) => item.productId)).size === value.items.length,
  { message: 'Gabungkan jumlah produk yang sama.' });
const versionInput = z.object({ version: z.number().int().min(0).max(2147483646) }).strict();
const paging = { page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20) };
const supplierQuery = z.object({ ...paging, q: z.string().trim().max(160).optional(), isActive: z.enum(['true', 'false']).optional() }).strict();
const purchaseQuery = z.object({ ...paging, q: z.string().trim().max(160).optional(), supplierId: uuid.optional(),
  status: z.enum(['DRAFT', 'ORDERED', 'RECEIVED']).optional() }).strict();
const purchaseInclude = { supplier: true, createdBy: { select: { id: true, name: true } },
  receivedBy: { select: { id: true, name: true } }, items: { orderBy: { skuSnapshot: 'asc' } } };
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
const paged = (items, total, query) => ({ items, total, page: query.page, pageSize: query.pageSize, pages: Math.ceil(total / query.pageSize) });

async function serializable(db, operation) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { return await db.$transaction(operation, { isolationLevel: 'Serializable', timeout: 15000 }); }
    catch (error) {
      if (error.code !== 'P2034') throw error;
      if (attempt === 3) throw new HttpError(409, 'Stok atau PO sedang berubah. Muat ulang lalu ulangi permintaan yang sama.');
    }
  }
}

async function loadPurchase(tx, id) {
  const order = await tx.purchaseOrder.findUnique({ where: { id }, include: purchaseInclude });
  if (!order) throw new HttpError(404, 'PO tidak ditemukan.');
  return order;
}

async function validateDraft(tx, raw) {
  const parsed = draftInput.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, 'Pilih supplier dan produk unik, jumlah 1–10.000, serta biaya rupiah bulat positif.');
  const input = parsed.data;
  let totalAmount;
  try { totalAmount = purchaseTotal(input.items); } catch (error) { throw new HttpError(400, error.message); }
  const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier?.isActive) throw new HttpError(409, 'Supplier tidak aktif atau tidak ditemukan.');
  const products = await tx.product.findMany({ where: { id: { in: input.items.map((item) => item.productId) },
    isActive: true, category: { isActive: true } } });
  if (products.length !== input.items.length) throw new HttpError(409, 'Produk tidak aktif atau tidak ditemukan. Periksa isi PO.');
  return { supplierId: supplier.id, supplierNameSnapshot: supplier.name, totalAmount,
    items: input.items.map((item) => {
      const product = products.find((entry) => entry.id === item.productId);
      return { ...item, productNameSnapshot: product.name, skuSnapshot: product.sku, lineTotal: item.quantity * item.unitCost };
    }) };
}

export async function receivePurchase(db, purchaseId, userId) {
  return serializable(db, async (tx) => {
    const order = await loadPurchase(tx, purchaseId);
    if (order.status === 'RECEIVED') return { purchase: order, replayed: true };
    if (order.status !== 'ORDERED') throw new HttpError(409, 'Hanya PO berstatus dipesan yang dapat diterima.');
    const claimed = await tx.purchaseOrder.updateMany({ where: { id: order.id, status: 'ORDERED', version: order.version },
      data: { status: 'RECEIVED', receivedAt: new Date(), receivedById: userId, version: { increment: 1 } } });
    if (claimed.count !== 1) throw new HttpError(409, 'PO telah berubah. Muat ulang dan ulangi penerimaan.');
    for (const item of [...order.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product || product.stock > 1000000000 - item.quantity) throw new HttpError(409, `Stok ${item.productNameSnapshot} melebihi batas penerimaan.`);
      const changed = await tx.product.updateMany({ where: { id: product.id, stock: product.stock },
        data: { stock: { increment: item.quantity }, purchasePrice: item.unitCost } });
      if (changed.count !== 1) throw new HttpError(409, 'Stok berubah. Ulangi penerimaan PO yang sama.');
      await tx.stockMovement.create({ data: { productId: product.id, userId, type: 'IN', quantityChange: item.quantity,
        stockBefore: product.stock, stockAfter: product.stock + item.quantity,
        referenceType: 'PURCHASE_ORDER', referenceId: order.id, note: order.poNumber } });
    }
    return { purchase: await loadPurchase(tx, order.id), replayed: false };
  });
}

export function purchasingRouter(db, authenticate, adminOnly) {
  const router = Router(); router.use(['/suppliers', '/purchases'], authenticate, adminOnly);
  router.get('/suppliers', asyncRoute(async (req, res) => {
    const query = supplierQuery.parse(req.query);
    const where = { ...(query.isActive !== undefined && { isActive: query.isActive === 'true' }),
      ...(query.q && { OR: ['name', 'contactPerson', 'phone', 'email'].map((field) => ({ [field]: { contains: query.q, mode: 'insensitive' } })) }) };
    const [items, total] = await Promise.all([db.supplier.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize }), db.supplier.count({ where })]);
    res.json(paged(items, total, query));
  }));
  router.get('/suppliers/:id', asyncRoute(async (req, res) => {
    const supplier = await db.supplier.findUnique({ where: { id: uuid.parse(req.params.id) } });
    if (!supplier) throw new HttpError(404, 'Supplier tidak ditemukan.');
    res.json({ supplier });
  }));
  router.post('/suppliers', asyncRoute(async (req, res) => {
    const supplier = await db.supplier.create({ data: supplierInput.parse(req.body) });
    res.status(201).json({ supplier });
  }));
  router.patch('/suppliers/:id', asyncRoute(async (req, res) => {
    const data = supplierInput.partial().refine((value) => Object.keys(value).length > 0).parse(req.body);
    const supplier = await db.supplier.update({ where: { id: uuid.parse(req.params.id) }, data });
    res.json({ supplier });
  }));
  router.get('/purchases', asyncRoute(async (req, res) => {
    const query = purchaseQuery.parse(req.query);
    const where = { ...(query.status && { status: query.status }), ...(query.supplierId && { supplierId: query.supplierId }),
      ...(query.q && { OR: [{ poNumber: { contains: query.q, mode: 'insensitive' } }, { supplierNameSnapshot: { contains: query.q, mode: 'insensitive' } }] }) };
    const [items, total] = await Promise.all([db.purchaseOrder.findMany({ where, select: { id: true, poNumber: true,
      supplierId: true, supplierNameSnapshot: true, status: true, totalAmount: true, createdAt: true, orderedAt: true, receivedAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), db.purchaseOrder.count({ where })]);
    res.json(paged(items, total, query));
  }));
  router.get('/purchases/:id', asyncRoute(async (req, res) => {
    const purchase = await loadPurchase(db, uuid.parse(req.params.id));
    const movements = await db.stockMovement.findMany({ where: { referenceType: 'PURCHASE_ORDER', referenceId: purchase.id, type: 'IN' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, productId: true, quantityChange: true, stockBefore: true, stockAfter: true, createdAt: true } });
    res.json({ purchase, movements });
  }));
  router.post('/purchases', asyncRoute(async (req, res) => {
    const purchase = await serializable(db, async (tx) => {
      const { items, ...data } = await validateDraft(tx, req.body);
      return tx.purchaseOrder.create({ data: { ...data, createdById: req.user.id,
        poNumber: `PO-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID()}`, items: { create: items } }, include: purchaseInclude });
    });
    res.status(201).json({ purchase });
  }));
  router.patch('/purchases/:id', asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { version } = versionInput.parse({ version: req.body.version });
    const { version: _version, ...body } = req.body;
    const purchase = await serializable(db, async (tx) => {
      const existing = await loadPurchase(tx, id);
      if (existing.status !== 'DRAFT' || existing.version !== version) throw new HttpError(409, 'PO sudah berubah atau bukan draf. Muat ulang sebelum mengedit.');
      const { items, ...data } = await validateDraft(tx, body);
      const changed = await tx.purchaseOrder.updateMany({ where: { id, status: 'DRAFT', version }, data: { ...data, version: { increment: 1 } } });
      if (changed.count !== 1) throw new HttpError(409, 'PO berubah. Muat ulang sebelum mengedit.');
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      await tx.purchaseOrderItem.createMany({ data: items.map((item) => ({ ...item, purchaseOrderId: id })) });
      return loadPurchase(tx, id);
    });
    res.json({ purchase });
  }));
  router.post('/purchases/:id/order', asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id); const { version } = versionInput.parse(req.body);
    const purchase = await serializable(db, async (tx) => {
      const existing = await loadPurchase(tx, id);
      if (existing.status !== 'DRAFT') return existing;
      if (existing.version !== version) throw new HttpError(409, 'Draf sudah berubah. Muat ulang lalu periksa ulang PO.');
      const { items, ...data } = await validateDraft(tx, { supplierId: existing.supplierId,
        items: existing.items.map(({ productId, quantity, unitCost }) => ({ productId, quantity, unitCost })) });
      const changed = await tx.purchaseOrder.updateMany({ where: { id, status: 'DRAFT', version },
        data: { ...data, status: 'ORDERED', orderedAt: new Date(), version: { increment: 1 } } });
      if (changed.count !== 1) throw new HttpError(409, 'PO berubah. Muat ulang lalu periksa ulang.');
      for (const item of items) await tx.purchaseOrderItem.update({ where: { purchaseOrderId_productId: { purchaseOrderId: id, productId: item.productId } }, data: item });
      return loadPurchase(tx, id);
    });
    res.json({ purchase });
  }));
  router.post('/purchases/:id/receive', asyncRoute(async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    res.json(await receivePurchase(db, uuid.parse(req.params.id), req.user.id));
  }));
  return router;
}
