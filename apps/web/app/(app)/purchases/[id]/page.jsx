'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Access } from '../../../../components/access';
import { DataState, formatIDR, PageHeading } from '../../../../components/catalog-ui';
import { PurchaseBuilder } from '../../../../components/purchase-builder';
import { request } from '../../../../lib/api';
import { PURCHASE_STATUSES } from '../../../../../../shared/purchases';

function Confirmation({ purchase, onConfirm, onClose }) {
  const dialog = useRef(null); const submitting = useRef(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function confirm() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try { await onConfirm(); onClose(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); submitting.current = false; }
  }
  return <dialog ref={dialog} className="stock-dialog" onClose={onClose} aria-labelledby="receive-title"><h2 id="receive-title">Konfirmasi penerimaan penuh</h2><p className="invoice-number">{purchase.poNumber}</p><p>Pastikan seluruh barang dan jumlah pada PO sudah tiba. Stok dan biaya beli terakhir akan diperbarui sekaligus.</p>
    <p>{purchase.items.length} produk · Total {formatIDR(purchase.totalAmount)}</p>
    <p className="field-hint">Jika koneksi terputus, ulangi penerimaan PO yang sama. Barang tidak akan ditambahkan dua kali.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}<div className="row-actions"><button className="primary-button" type="button" disabled={busy} onClick={confirm}>{busy ? 'Menerima stok…' : 'Konfirmasi terima semua'}</button><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>Batal</button></div>
  </dialog>;
}

function PurchaseDetails({ id }) {
  const [data, setData] = useState(null); const [status, setStatus] = useState('loading'); const [reload, setReload] = useState(0);
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [receiving, setReceiving] = useState(false); const [editing, setEditing] = useState(false);
  useEffect(() => {
    let active = true;
    request(`/api/purchases/${id}`).then((result) => { if (active) { setData(result); setStatus('ready'); } }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [id, reload]);
  async function order() {
    setBusy(true); setMessage('');
    try { const result = await request(`/api/purchases/${id}/order`, { method: 'POST', body: { version: data.purchase.version } });
      setData({ ...data, purchase: result.purchase }); setEditing(false); setMessage('PO dipesan. Stok belum berubah.'); }
    catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  async function receive() {
    const result = await request(`/api/purchases/${id}/receive`, { method: 'POST', body: {} });
    setData((old) => ({ ...old, purchase: result.purchase })); setReload((n) => n + 1);
    setMessage(result.replayed ? 'PO ini sudah diterima sebelumnya. Tidak ada penambahan stok ulang.' : 'PO diterima. Stok dan riwayat diperbarui.');
  }
  const purchase = data?.purchase;
  const date = (value) => value ? new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : 'Belum';
  return <><PageHeading title="Detail purchase order" description="Periksa rincian pesanan dan penerimaan stok." action={<Link className="secondary-button" href="/purchases">Daftar pembelian</Link>} />
    <DataState status={status} retry={() => { setStatus('loading'); setReload((n) => n + 1); }} />
    {message ? <p className="feedback" role="status">{message}</p> : null}
    {status === 'ready' && purchase ? <><section className="work-panel purchase-items"><h2 className="invoice-number">{purchase.poNumber}</h2>
      <dl className="detail-grid"><div><dt>Supplier saat pemesanan</dt><dd>{purchase.supplierNameSnapshot}</dd></div><div><dt>Status</dt><dd>{PURCHASE_STATUSES[purchase.status]}</dd></div><div><dt>Pembuat</dt><dd>{purchase.createdBy.name}</dd></div><div><dt>Dibuat (Jakarta)</dt><dd>{date(purchase.createdAt)}</dd></div><div><dt>Dipesan</dt><dd>{date(purchase.orderedAt)}</dd></div><div><dt>Diterima</dt><dd>{date(purchase.receivedAt)}{purchase.receivedBy ? ` oleh ${purchase.receivedBy.name}` : ''}</dd></div></dl>
      <div className="table-scroll"><table><thead><tr><th>Produk saat dipesan / SKU</th><th className="numeric">Jumlah</th><th className="numeric">Biaya satuan</th><th className="numeric">Jumlah biaya</th></tr></thead><tbody>{purchase.items.map((item) => <tr key={item.id}><td><strong>{item.productNameSnapshot}</strong><span className="subline">{item.skuSnapshot}</span></td><td className="numeric">{item.quantity}</td><td className="numeric">{formatIDR(item.unitCost)}</td><td className="numeric">{formatIDR(item.lineTotal)}</td></tr>)}</tbody></table></div>
      <p className="purchase-total">Total PO: <strong>{formatIDR(purchase.totalAmount)}</strong></p>
      <div className="row-actions purchase-actions">{purchase.status === 'DRAFT' ? <><button className="secondary-button" type="button" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? 'Tutup editor' : 'Ubah draf'}</button><button className="primary-button" type="button" disabled={busy || editing} onClick={order}>{busy ? 'Memesan…' : 'Tandai dipesan'}</button></> : purchase.status === 'ORDERED' ? <button className="primary-button" type="button" onClick={() => setReceiving(true)}>Terima semua stok</button> : <p>Penerimaan selesai. PO ini tidak dapat diubah atau diterima ulang.</p>}
        <Link className="inline-button" href={`/purchases?supplierId=${purchase.supplierId}`}>Riwayat pembelian supplier</Link>
        <button className="inline-button" type="button" onClick={() => { setStatus('loading'); setReload((n) => n + 1); setEditing(false); }}>Muat ulang PO</button>
      </div></section>
      {editing && purchase.status === 'DRAFT' ? <PurchaseBuilder key={purchase.version} purchase={purchase} disabled={busy} onSaved={(updated) => { setData({ ...data, purchase: updated }); setEditing(false); setMessage('Draf diperbarui.'); }} /> : null}
      {purchase.status === 'RECEIVED' ? <section className="work-panel purchase-items"><h2>Pergerakan stok terkait</h2>{data.movements.length ? <div className="table-scroll"><table><thead><tr><th>Produk</th><th className="numeric">Masuk</th><th className="numeric">Sebelum</th><th className="numeric">Sesudah</th><th>Referensi</th></tr></thead><tbody>{data.movements.map((movement) => <tr key={movement.id}><td>{purchase.items.find((item) => item.productId === movement.productId)?.productNameSnapshot}</td><td className="numeric">+{movement.quantityChange}</td><td className="numeric">{movement.stockBefore}</td><td className="numeric">{movement.stockAfter}</td><td><span className="invoice-number">{purchase.poNumber}</span></td></tr>)}</tbody></table></div> : <p>Riwayat sedang diperbarui. Klik Muat ulang PO bila belum tampil.</p>}</section> : null}
    </> : null}{receiving && purchase ? <Confirmation purchase={purchase} onConfirm={receive} onClose={() => setReceiving(false)} /> : null}</>;
}

export default function PurchasePage({ params }) { const { id } = use(params); return <Access admin><PurchaseDetails key={id} id={id} /></Access>; }
