export const PURCHASE_STATUSES = { DRAFT: 'Draf', ORDERED: 'Dipesan', RECEIVED: 'Diterima' };

export function purchaseTotal(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) throw new Error('PO harus berisi 1 sampai 100 produk.');
  let total = 0n;
  for (const item of items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000 ||
        !Number.isSafeInteger(item.unitCost) || item.unitCost < 1 || item.unitCost > 1000000000) {
      throw new Error('Jumlah harus 1–10.000 dan biaya satuan harus rupiah bulat positif.');
    }
    total += BigInt(item.quantity) * BigInt(item.unitCost);
  }
  if (total > 2000000000n) throw new Error('Total PO melebihi batas Rp 2.000.000.000.');
  return Number(total);
}
