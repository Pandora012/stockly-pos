'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Access } from '../../../components/access';
import { DataState, PageHeading, Pagination, StockLevel } from '../../../components/catalog-ui';
import { request } from '../../../lib/api';

const adjustmentSchema = z.object({ quantityChange: z.number().int().min(-1_000_000_000).max(1_000_000_000).refine((n) => n !== 0),
  reason: z.string().trim().min(1).max(500) });
const movementNames = { INITIAL: 'Stok awal', ADJUSTMENT: 'Penyesuaian', IN: 'Masuk', OUT: 'Keluar', SALE: 'Penjualan' };

function AdjustmentDialog({ product, onClose, onSaved }) {
  const dialog = useRef(null);
  const quantity = useRef(null);
  const [change, setChange] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { dialog.current?.showModal(); quantity.current?.focus(); }, []);

  async function submit(event) {
    event.preventDefault();
    const parsed = adjustmentSchema.safeParse({ quantityChange: Number(change), reason });
    if (!parsed.success) { setError('Jumlah harus bilangan bulat selain nol, dan alasan wajib diisi.'); return; }
    setSaving(true); setError('');
    try {
      await request('/api/inventory/adjustments', { method: 'POST', body: { productId: product.id, ...parsed.data } });
      onSaved();
    } catch (failure) { setError(failure.status === 409 ? 'Stok berubah atau jumlah tidak mencukupi. Periksa stok lalu coba lagi.' : failure.message); }
    finally { setSaving(false); }
  }
  return <dialog ref={dialog} className="stock-dialog" onClose={onClose} aria-labelledby="adjust-title">
    <h2 id="adjust-title">Sesuaikan stok</h2><p><strong>{product.name}</strong> · Stok saat ini: {product.stock}</p>
    <form onSubmit={submit}><label>Perubahan jumlah<input ref={quantity} type="number" step="1" value={change} onChange={(event) => setChange(event.target.value)} required /></label>
      <p className="field-hint">Gunakan angka positif untuk menambah, negatif untuk mengurangi. Penyesuaian tidak boleh membuat stok negatif.</p>
      <label>Alasan<textarea rows="3" maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="row-actions"><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan penyesuaian'}</button><button type="button" className="secondary-button" onClick={() => dialog.current?.close()}>Batal</button></div>
    </form>
  </dialog>;
}

function Inventory() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [status, setStatus] = useState('loading');
  const [movements, setMovements] = useState([]);
  const [movementTotal, setMovementTotal] = useState(0);
  const [movementPages, setMovementPages] = useState(0);
  const [movementPage, setMovementPage] = useState(1);
  const [movementStatus, setMovementStatus] = useState('loading');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [adjusting, setAdjusting] = useState(null);
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (q) params.set('q', q);
    if (lowStock) params.set('lowStock', 'true');
    request(`/api/inventory?${params}`).then((data) => { if (active) {
      setItems(data.items); setTotal(data.total); setPages(data.pages); setStatus('ready');
    } }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [q, lowStock, page, reload]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(movementPage), pageSize: '15' });
    if (selectedProduct) params.set('productId', selectedProduct.id);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    request(`/api/inventory/movements?${params}`).then((data) => { if (active) {
      setMovements(data.items); setMovementTotal(data.total); setMovementPages(data.pages); setMovementStatus('ready');
    } }).catch(() => { if (active) setMovementStatus('error'); });
    return () => { active = false; };
  }, [selectedProduct, from, to, movementPage, reload]);

  function saved() { setAdjusting(null); setMessage('Stok dan riwayat pergerakan diperbarui.'); setReload((n) => n + 1); }
  function selectProduct(product) { setSelectedProduct(product); setMovementPage(1); setMovementStatus('loading'); }
  function filter(setter, value, history = false) {
    setter(value); if (history) { setMovementPage(1); setMovementStatus('loading'); }
    else { setPage(1); setStatus('loading'); }
  }
  return <><PageHeading title="Inventaris" description="Pantau stok dan catat setiap perubahan dengan alasan yang jelas." />
    <section className="work-panel inventory-section"><h2>Stok saat ini</h2><div className="catalog-toolbar"><label>Cari produk atau SKU<input type="search" value={q} onChange={(event) => filter(setQ, event.target.value)} /></label>
      <label className="checkbox-field"><input type="checkbox" checked={lowStock} onChange={(event) => filter(setLowStock, event.target.checked)} /> Stok rendah saja</label></div>
      <DataState status={status} retry={() => { setStatus('loading'); setReload((n) => n + 1); }} empty={status === 'ready' && total === 0} />
      {status === 'ready' && total > 0 ? <><div className="table-scroll"><table><thead><tr><th>Produk / SKU</th><th>Kategori</th><th className="numeric">Stok</th><th className="numeric">Minimum</th><th>Tindakan</th></tr></thead><tbody>{items.map((product) => <tr key={product.id}><td><strong>{product.name}</strong>{product.sku.startsWith('DEMO-') ? <span className="demo-tag">Data demo</span> : null}<span className="subline">{product.sku}</span></td><td>{product.category.name}</td><td className="numeric"><StockLevel stock={product.stock} minimumStock={product.minimumStock} /></td><td className="numeric">{product.minimumStock}</td><td><div className="row-actions"><button type="button" className="inline-button" onClick={() => setAdjusting(product)}>Sesuaikan</button><button type="button" className="inline-button" onClick={() => selectProduct(product)}>Riwayat</button></div></td></tr>)}</tbody></table></div><Pagination page={page} pages={pages} total={total} onChange={(n) => { setPage(n); setStatus('loading'); }} /></> : null}
    </section>
    <section className="work-panel inventory-section"><h2>Riwayat pergerakan</h2><div className="catalog-toolbar">{selectedProduct ? <p className="selected-filter">Produk: <strong>{selectedProduct.name}</strong></p> : <p className="selected-filter">Semua produk. Klik Riwayat pada tabel stok untuk memfilter.</p>}
      <label>Dari tanggal<input type="date" value={from} onChange={(event) => filter(setFrom, event.target.value, true)} /></label><label>Sampai tanggal<input type="date" value={to} onChange={(event) => filter(setTo, event.target.value, true)} /></label>
      {selectedProduct ? <button type="button" className="secondary-button" onClick={() => selectProduct(null)}>Semua produk</button> : null}</div>
      <DataState status={movementStatus} retry={() => { setMovementStatus('loading'); setReload((n) => n + 1); }} empty={movementStatus === 'ready' && movementTotal === 0} />
      {movementStatus === 'ready' && movementTotal > 0 ? <><div className="table-scroll"><table><thead><tr><th>Waktu</th><th>Produk</th><th>Jenis</th><th className="numeric">Perubahan</th><th className="numeric">Stok akhir</th><th>Alasan / petugas</th></tr></thead><tbody>{movements.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('id-ID')}</td><td>{item.product.name}<span className="subline">{item.product.sku}</span></td><td>{movementNames[item.type]}</td><td className="numeric">{item.quantityChange > 0 ? '+' : ''}{item.quantityChange}</td><td className="numeric">{item.stockAfter}</td><td>{item.referenceType === 'PURCHASE_ORDER' ? <Link className="inline-button invoice-number" href={`/purchases/${item.referenceId}`}>{item.note || 'Buka PO'}</Link> : item.note || 'Tidak ada catatan'}<span className="subline">{item.user.name}</span></td></tr>)}</tbody></table></div><Pagination page={movementPage} pages={movementPages} total={movementTotal} onChange={(n) => { setMovementPage(n); setMovementStatus('loading'); }} /></> : null}
    </section>{message ? <p className="feedback" role="status">{message}</p> : null}
    {adjusting ? <AdjustmentDialog key={adjusting.id} product={adjusting} onClose={() => setAdjusting(null)} onSaved={saved} /> : null}</>;
}

export default function InventoryPage() { return <Access admin><Inventory /></Access>; }
