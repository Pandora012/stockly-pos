export const MAX_MONEY = 2_000_000_000;

export function saleTotals(items, discount = 0, taxRate = 0) {
  const valid = (value, max = MAX_MONEY) => Number.isSafeInteger(value) && value >= 0 && value <= max;
  if (!valid(discount) || !valid(taxRate, 10000)) throw new Error('Diskon atau tarif pajak tidak valid.');
  let subtotal = 0n;
  for (const item of items) {
    if (!valid(item.unitPrice) || !valid(item.quantity, 10000) || item.quantity === 0) throw new Error('Harga atau jumlah tidak valid.');
    subtotal += BigInt(item.unitPrice) * BigInt(item.quantity);
  }
  if (subtotal > BigInt(MAX_MONEY) || BigInt(discount) > subtotal) throw new Error('Nilai belanja terlalu besar atau diskon melebihi subtotal.');
  const taxable = subtotal - BigInt(discount);
  const tax = (taxable * BigInt(taxRate) + 5000n) / 10000n;
  const total = taxable + tax;
  if (total > BigInt(MAX_MONEY)) throw new Error('Total melebihi batas transaksi.');
  return { subtotal: Number(subtotal), discount, tax: Number(tax), total: Number(total) };
}
