'use client';

import { formatIDR } from './catalog-ui';

export function Receipt({ sale }) {
  const store = sale.storeSnapshot;
  return <><div className="receipt-actions"><button type="button" className="primary-button" onClick={() => window.print()}>Cetak struk</button><p>Gunakan kertas 80 mm pada pengaturan cetak browser.</p></div>
    <article className="receipt-sheet" aria-label="Struk transaksi"><header><h1>{store.storeName}</h1>{store.address ? <p>{store.address}</p> : null}{store.phone ? <p>{store.phone}</p> : null}</header>
      <div className="receipt-meta"><p>{sale.invoiceNumber}</p><p>{new Date(sale.createdAt).toLocaleString('id-ID')}</p><p>Kasir: {sale.cashierNameSnapshot}</p></div>
      <table><caption className="sr-only">Barang belanja</caption><tbody>{sale.items.map((item) => <tr key={item.id}><td><strong>{item.productNameSnapshot}</strong><span className="subline">{item.quantity} × {formatIDR(item.unitPrice)}</span></td><td className="numeric">{formatIDR(item.lineTotal)}</td></tr>)}</tbody></table>
      <dl className="totals receipt-totals"><div><dt>Subtotal</dt><dd>{formatIDR(sale.subtotal)}</dd></div><div><dt>Diskon</dt><dd>{formatIDR(sale.discount)}</dd></div><div><dt>Pajak</dt><dd>{formatIDR(sale.tax)}</dd></div><div className="grand-total"><dt>Total</dt><dd>{formatIDR(sale.total)}</dd></div><div><dt>Tunai</dt><dd>{formatIDR(sale.payment.amountReceived)}</dd></div><div><dt>Kembalian</dt><dd>{formatIDR(sale.payment.changeAmount)}</dd></div></dl>
      {store.receiptFooter ? <footer>{store.receiptFooter}</footer> : null}
    </article></>;
}
