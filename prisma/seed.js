import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = 'Store Admin', STORE_NAME = 'Stockly Store' } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12 || ADMIN_PASSWORD.includes('replace-with-')) {
  throw new Error('Set ADMIN_EMAIL and a real ADMIN_PASSWORD (at least 12 characters) before seeding.');
}

const prisma = new PrismaClient();
try {
  const email = ADMIN_EMAIL.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  let admin = existing;
  if (!admin) {
    admin = await prisma.user.create({ data: {
      email, name: ADMIN_NAME, passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12), role: 'ADMIN'
    } });
    console.log('Initial admin created.');
  } else {
    console.log('Admin email already exists; credentials left unchanged.');
  }
  await prisma.storeSetting.upsert({
    where: { id: 1 }, update: {}, create: { id: 1, storeName: STORE_NAME }
  });
  console.log('Store settings ready.');

  if (process.env.NODE_ENV === 'production') {
    console.log('Demo catalog skipped in production.');
  } else {
    if (admin.role !== 'ADMIN') throw new Error('Seed email belongs to a non-admin account.');
    const groups = [
      ['Minuman', 'minuman'], ['Makanan Ringan', 'makanan-ringan'], ['Kebutuhan Rumah', 'kebutuhan-rumah'],
      ['Perawatan Diri', 'perawatan-diri'], ['Alat Tulis', 'alat-tulis']
    ];
    const categories = {};
    for (const [name, slug] of groups) {
      categories[slug] = await prisma.category.upsert({ where: { slug }, update: {}, create: { name, slug } });
    }
    const samples = [
      ['minuman', 'Air Mineral Tirta 600 ml', 'MIN-001', 2300, 4000, 48, 12],
      ['minuman', 'Teh Melati Langit 350 ml', 'MIN-002', 3900, 6500, 30, 10],
      ['minuman', 'Kopi Susu Aruna 240 ml', 'MIN-003', 6200, 9500, 14, 8],
      ['minuman', 'Jus Jambu Sora 250 ml', 'MIN-004', 5100, 8000, 9, 10],
      ['makanan-ringan', 'Keripik Singkong Rimba 75 g', 'MKN-001', 6900, 10500, 22, 8],
      ['makanan-ringan', 'Biskuit Gandum Pagi 120 g', 'MKN-002', 8700, 13000, 18, 6],
      ['makanan-ringan', 'Kacang Panggang Pelangi 80 g', 'MKN-003', 7800, 12000, 6, 8],
      ['makanan-ringan', 'Wafer Cokelat Damar 100 g', 'MKN-004', 6600, 10000, 32, 10],
      ['kebutuhan-rumah', 'Sabun Cuci Piring Sinar 500 ml', 'RUM-001', 10800, 15500, 16, 6],
      ['kebutuhan-rumah', 'Tisu Serbaguna Hutan 200 lembar', 'RUM-002', 11200, 16500, 8, 8],
      ['kebutuhan-rumah', 'Kantong Sampah Karya 20 lembar', 'RUM-003', 9700, 14000, 19, 5],
      ['kebutuhan-rumah', 'Pembersih Lantai Loka 450 ml', 'RUM-004', 13500, 19000, 11, 5],
      ['perawatan-diri', 'Sampo Harian Rami 170 ml', 'RAW-001', 13900, 20000, 12, 5],
      ['perawatan-diri', 'Sabun Mandi Arum 80 g', 'RAW-002', 4300, 7000, 24, 8],
      ['perawatan-diri', 'Pasta Gigi Senyum 100 g', 'RAW-003', 9600, 14500, 7, 8],
      ['alat-tulis', 'Pulpen Hitam Garis 0.7 mm', 'ATK-001', 2200, 4000, 40, 10],
      ['alat-tulis', 'Buku Catatan Titik A5', 'ATK-002', 7900, 12000, 13, 5],
      ['alat-tulis', 'Pensil Kayu Bumi HB', 'ATK-003', 1700, 3000, 35, 10]
    ];
    let created = 0;
    for (const [categorySlug, name, skuCode, purchasePrice, sellingPrice, stock, minimumStock] of samples) {
      const sku = `DEMO-${skuCode}`;
      if (await prisma.product.findUnique({ where: { sku } })) continue;
      const serial = String(samples.findIndex((row) => row[2] === skuCode) + 1).padStart(5, '0');
      const digits = `8991234${serial}`;
      const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
      const barcode = `${digits}${(10 - sum % 10) % 10}`;
      await prisma.$transaction(async (tx) => {
        const product = await tx.product.create({ data: {
          categoryId: categories[categorySlug].id, name, sku, barcode, purchasePrice, sellingPrice,
          stock, minimumStock, description: 'Contoh produk untuk pengembangan.'
        } });
        await tx.stockMovement.create({ data: {
          productId: product.id, userId: admin.id, type: 'INITIAL', quantityChange: stock,
          stockBefore: 0, stockAfter: stock, referenceType: 'PRODUCT', referenceId: product.id,
          note: 'Data demo: stok awal'
        } });
      });
      created += 1;
    }
    console.log(`Demo catalog ready; ${created} products created (18 total in sample set).`);
  }
} finally {
  await prisma.$disconnect();
}
