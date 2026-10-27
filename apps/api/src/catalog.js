import { Router } from 'express';
import { z } from 'zod';

const id = z.string().uuid();
const positive = z.number().int().min(1).max(1_000_000_000);
const nonnegative = z.number().int().min(0).max(1_000_000_000);
const text = (max) => z.string().trim().min(1).max(max);
const categoryInput = z.object({
  name: text(120), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(120).optional(),
  isActive: z.boolean().optional()
}).strict();
const productFields = {
  categoryId: id, name: text(160), sku: text(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  barcode: z.union([text(64).regex(/^[0-9]+$/), z.null()]).optional(),
  description: z.string().trim().max(1000), purchasePrice: positive, sellingPrice: positive,
  minimumStock: nonnegative, imageUrl: z.union([z.string().url().max(500), z.null()]).optional(),
  isActive: z.boolean()
};
const productInput = z.object({ ...productFields,
  description: productFields.description.default(''), minimumStock: nonnegative.default(0),
  isActive: z.boolean().default(true), initialStock: nonnegative.default(0)
}).strict();
const productUpdate = z.object(Object.fromEntries(Object.entries(productFields).map(([key, schema]) => [key, schema.optional()])))
  .strict().refine((value) => Object.keys(value).length > 0);
const adjustmentInput = z.object({
  productId: id, quantityChange: z.number().int().min(-1_000_000_000).max(1_000_000_000).refine((n) => n !== 0),
  reason: text(500)
}).strict();
const pageInput = { page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20) };
const productQuery = z.object({ ...pageInput, q: z.string().trim().max(160).optional(), categoryId: id.optional(),
  isActive: z.enum(['true', 'false']).optional(), lowStock: z.enum(['true', 'false']).optional() }).strict();
const movementQuery = z.object({ ...pageInput, productId: id.optional(),
  from: z.string().date().optional(), to: z.string().date().optional() }).strict().refine(
  (value) => !value.from || !value.to || value.from <= value.to, { message: 'Invalid date range' }
);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function slugOf(name) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
}

async function requireCategory(db, categoryId) {
  const category = await db.category.findUnique({ where: { id: categoryId } });
  if (!category) throw new HttpError(400, 'Category not found');
}

function stockWhere(db, query, admin) {
  const where = {};
  if (query.q) where.OR = [
    { name: { contains: query.q, mode: 'insensitive' } },
    { sku: { contains: query.q, mode: 'insensitive' } },
    { barcode: { contains: query.q } }
  ];
  if (query.categoryId) where.categoryId = query.categoryId;
  if (!admin) { where.isActive = true; where.category = { isActive: true }; }
  else if (query.isActive !== undefined) where.isActive = query.isActive === 'true';
  if (query.lowStock === 'true') where.stock = { lte: db.product.fields.minimumStock };
  return where;
}

function pageResult(items, total, query) {
  return { items, total, page: query.page, pageSize: query.pageSize, pages: Math.ceil(total / query.pageSize) };
}

export function catalogRouter(db, authenticate, adminOnly) {
  const router = Router();
  router.use(authenticate);

  router.get('/categories', asyncRoute(async (req, res) => {
    z.object({}).strict().parse(req.query);
    const categories = await db.category.findMany({
      where: req.user.role === 'ADMIN' ? {} : { isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }]
    });
    res.json({ categories });
  }));
  router.post('/categories', adminOnly, asyncRoute(async (req, res) => {
    const input = categoryInput.parse(req.body);
    const slug = input.slug ?? slugOf(input.name);
    if (!slug) throw new HttpError(400, 'Provide a valid category slug');
    const category = await db.category.create({ data: { ...input, slug } });
    res.status(201).json({ category });
  }));
  router.patch('/categories/:id', adminOnly, asyncRoute(async (req, res) => {
    const categoryId = id.parse(req.params.id);
    const input = categoryInput.partial().strict().refine((value) => Object.keys(value).length > 0).parse(req.body);
    const category = await db.category.update({ where: { id: categoryId }, data: input });
    res.json({ category });
  }));

  router.get('/products', asyncRoute(async (req, res) => {
    const query = productQuery.parse(req.query);
    const where = stockWhere(db, query, req.user.role === 'ADMIN');
    const [items, total] = await Promise.all([
      db.product.findMany({ where, include: { category: { select: { id: true, name: true, isActive: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      db.product.count({ where })
    ]);
    res.json(pageResult(items, total, query));
  }));
  router.get('/products/:id', asyncRoute(async (req, res) => {
    const productId = id.parse(req.params.id);
    const product = await db.product.findFirst({ where: { id: productId,
      ...(req.user.role !== 'ADMIN' ? { isActive: true, category: { isActive: true } } : {})
    }, include: { category: { select: { id: true, name: true, isActive: true } } } });
    if (!product) throw new HttpError(404, 'Product not found');
    res.json({ product });
  }));
  router.post('/products', adminOnly, asyncRoute(async (req, res) => {
    const { initialStock, ...input } = productInput.parse(req.body);
    await requireCategory(db, input.categoryId);
    const product = await db.$transaction(async (tx) => {
      const created = await tx.product.create({ data: { ...input, sku: input.sku.toUpperCase(), stock: initialStock } });
      if (initialStock > 0) await tx.stockMovement.create({ data: {
        productId: created.id, userId: req.user.id, type: 'INITIAL', quantityChange: initialStock,
        stockBefore: 0, stockAfter: initialStock, referenceType: 'PRODUCT', referenceId: created.id,
        note: 'Initial stock'
      } });
      return created;
    });
    res.status(201).json({ product });
  }));
  router.patch('/products/:id', adminOnly, asyncRoute(async (req, res) => {
    const productId = id.parse(req.params.id);
    const input = productUpdate.parse(req.body);
    if (input.categoryId) await requireCategory(db, input.categoryId);
    const product = await db.product.update({ where: { id: productId }, data: {
      ...input, ...(input.sku && { sku: input.sku.toUpperCase() })
    } });
    res.json({ product });
  }));

  router.get('/inventory', adminOnly, asyncRoute(async (req, res) => {
    const query = productQuery.parse(req.query);
    const where = stockWhere(db, query, true);
    const [items, total] = await Promise.all([
      db.product.findMany({ where, select: { id: true, name: true, sku: true, stock: true,
        minimumStock: true, isActive: true, category: { select: { name: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      db.product.count({ where })
    ]);
    res.json(pageResult(items, total, query));
  }));
  router.get('/inventory/movements', adminOnly, asyncRoute(async (req, res) => {
    const query = movementQuery.parse(req.query);
    const where = { ...(query.productId && { productId: query.productId }),
      ...((query.from || query.to) && { createdAt: {
        ...(query.from && { gte: new Date(`${query.from}T00:00:00.000Z`) }),
        ...(query.to && { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000) })
      } }) };
    const [items, total] = await Promise.all([
      db.stockMovement.findMany({ where, include: { product: { select: { name: true, sku: true } },
        user: { select: { name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      db.stockMovement.count({ where })
    ]);
    res.json(pageResult(items, total, query));
  }));
  router.post('/inventory/adjustments', adminOnly, asyncRoute(async (req, res) => {
    const input = adjustmentInput.parse(req.body);
    let result;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await db.$transaction(async (tx) => {
          const product = await tx.product.findUnique({ where: { id: input.productId } });
          if (!product) throw new HttpError(404, 'Product not found');
          const stockAfter = product.stock + input.quantityChange;
          if (stockAfter < 0 || stockAfter > 1_000_000_000) throw new HttpError(409, 'Stock would exceed allowed bounds');
          const updated = await tx.product.updateMany({ where: { id: product.id, stock: product.stock },
            data: { stock: { increment: input.quantityChange } } });
          if (updated.count !== 1) throw new HttpError(409, 'Stock changed; retry adjustment');
          const adjustment = await tx.stockAdjustment.create({ data: { ...input, userId: req.user.id } });
          const movement = await tx.stockMovement.create({ data: {
            productId: product.id, userId: req.user.id, type: 'ADJUSTMENT',
            quantityChange: input.quantityChange, stockBefore: product.stock, stockAfter,
            referenceType: 'ADJUSTMENT', referenceId: adjustment.id, note: input.reason
          } });
          return { adjustment, movement };
        }, { isolationLevel: 'Serializable' });
        break;
      } catch (error) {
        if (error.code !== 'P2034' || attempt === 2) throw error;
      }
    }
    res.status(201).json(result);
  }));
  return router;
}
