'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { request } from '../lib/api';
import { DataState, formatIDR } from './catalog-ui';
import { purchaseTotal } from '../../../shared/purchases';

export function PurchaseBuilder({ purchase = null, onSaved, disabled = false }) {
  const [supplier, setSupplier] = useState(purchase?.supplier ?? null);
  const [rows, setRows] = useState(() => purchase?.items.map((item) => ({ productId: item.productId,
    name: item.productNameSnapshot, sku: item.skuSnapshot, quantity: item.quantity, unitCost: item.unitCost })) ?? []);
  const [supplierQuery, setSupplierQuery] = useState(''); const [productQuery, setProductQuery] = useState('');
  const [suppliers, setSuppliers] = useState([]); const [products, setProducts] = useState([]);
  const [supplierState, setSupplierState] = useState('loading'); const [productState, setProductState] = useState('loading');
  const [reload, setReload] = useState(0); const [saving, setSaving] = useState(false); const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ q: supplierQuery, isActive: 'true', pageSize: '10' });
    request(`/api/suppliers?${params}`).then((data) => { if (active) { setSuppliers(data.items); setSupplierState('ready'); } })
      .catch(() => { if (active) setSupplierState('error'); });
    return () => { active = false; };
  }, [supplierQuery, reload]);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ q: productQuery, isActive: 'true', pageSize: '10' });
    request(`/api/products?${params}`).then((data) => { if (active) { setProducts(data.items.filter((item) => item.category.isActive)); setProductState('ready'); } })
      .catch(() => { if (active) setProductState('error'); });
    return () => { active = false; };
  }, [productQuery, reload]);
  let total = null; let error = '';
  try { total = purchaseTotal(rows); } catch (failure) { error = failure.message; }
  function add(product) {
    if (rows.some((item) => item.productId === product.id) || rows.length >= 100) return;
    setRows((old) => [...old, { productId: product.id, name: product.name, sku: product.sku, quantity: 1, unitCost: product.purchasePrice }]);
  }
  function change(productId, field, value) { setRows((old) => old.map((item) => item.productId === productId ? { ...item, [field]: value === '' ? '' : Number(value) } : item)); }
  async function submit(event) {
    event.preventDefault(); if (inFlight.current) return;
    if (!supplier?.isActive || total === null) { setMessage('Pilih supplier aktif dan periksa jumlah/biaya semua produk.'); return; }
    inFlight.current = true; setSaving(true); setMessage('');
    const body = { supplierId: supplier.id, items: rows.map(({ productId, quantity, unitCost }) => ({ productId, quantity, unitCost })),
      ...(purchase && { version: purchase.version }) };
    try { const data = await request(purchase ? `/api/purchases/${purchase.id}` : '/api/purchases', { method: purchase ? 'PATCH' : 'POST', body }); onSaved(data.purchase); }
    catch (failure) { setMessage(failure.message); }
    finally { setSaving(false); inFlight.current = false; }
  }
  function lineTotal(item) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.unitCost) || item.unitCost < 1 || item.quantity * item.unitCost > 2000000000) return 'Periksa nilai';
    return formatIDR(item.quantity * item.unitCost);
  }
  return <form onSubmit={submit}><fieldset className="purchase-fieldset" disabled={saving || disabled}>
    <div className="purchase-picker-grid"><section className="work-panel"><h2>Supplier</h2>
      {supplier ? <p className="selected-filter">Dipilih: <strong>{supplier.name}</strong>{!supplier.isActive ? ' (nonaktif, pilih pengganti)' : ''}</p> : <p>Pilih supplier untuk PO ini.</p>}
      <label>Cari supplier aktif<input type="search" value={supplierQuery} onChange={(event) => { setSupplierQuery(event.target.value); setSupplierState('loading'); }} /></label>
      <DataState status={supplierState} empty={supplierState === 'ready' && !suppliers.length} retry={() => { setSupplierState('loading'); setReload((n) => n + 1); }} />
      {supplierState === 'ready' ? <ul className="picker-list">{suppliers.map((item) => <li key={item.id}><span><strong>{item.name}</strong><span className="subline">{item.contactPerson || item.phone}</span></span><button className="inline-button" type="button" disabled={item.id === supplier?.id} onClick={() => setSupplier(item)}>{item.id === supplier?.id ? 'Dipilih' : 'Pilih supplier'}</button></li>)}</ul> : null}
      <Link className="inline-button" href="/suppliers">Kelola supplier</Link>
    </section><section className="work-panel"><h2>Pilih produk</h2><label>Cari nama produk atau SKU<input type="search" value={productQuery} onChange={(event) => { setProductQuery(event.target.value); setProductState('loading'); }} /></label>
      <DataState status={productState} empty={productState === 'ready' && !products.length} retry={() => { setProductState('loading'); setReload((n) => n + 1); }} />
      {productState === 'ready' ? <ul className="picker-list">{products.map((product) => <li key={product.id}><span><strong>{product.name}</strong><span className="subline">{product.sku} · Stok {product.stock}</span></span><button className="inline-button" type="button" aria-label={`Tambah ${product.name}`} disabled={rows.some((row) => row.productId === product.id) || rows.length >= 100} onClick={() => add(product)}>Tambah</button></li>)}</ul> : null}
      <p className="field-hint">Hasil pencarian dibatasi 10. Cari SKU spesifik untuk menemukan produk lain.</p>
    </section></div>
    <section className="work-panel purchase-items"><h2>Item purchase order</h2><p className="field-hint">Biaya satuan adalah harga pembelian yang disepakati untuk PO ini, bukan harga jual.</p>
      {rows.length ? <div className="table-scroll"><table><thead><tr><th>Produk / SKU</th><th>Jumlah</th><th>Biaya satuan (IDR)</th><th className="numeric">Jumlah biaya</th><th>Tindakan</th></tr></thead><tbody>{rows.map((item) => <tr key={item.productId}><td><strong>{item.name}</strong><span className="subline">{item.sku}</span></td><td><label className="sr-only" htmlFor={`purchase-qty-${item.productId}`}>Jumlah {item.name}</label><input className="purchase-number" id={`purchase-qty-${item.productId}`} type="number" min="1" max="10000" step="1" value={item.quantity} onChange={(event) => change(item.productId, 'quantity', event.target.value)} required /></td><td><label className="sr-only" htmlFor={`purchase-cost-${item.productId}`}>Biaya satuan {item.name}</label><input className="purchase-cost" id={`purchase-cost-${item.productId}`} type="number" min="1" max="1000000000" step="1" value={item.unitCost} onChange={(event) => change(item.productId, 'unitCost', event.target.value)} required /></td><td className="numeric">{lineTotal(item)}</td><td><button type="button" className="inline-button" aria-label={`Hapus ${item.name}`} onClick={() => setRows((old) => old.filter((row) => row.productId !== item.productId))}>Hapus</button></td></tr>)}</tbody></table></div> : <p>Belum ada produk dipilih.</p>}
      {rows.length > 0 && error ? <p className="form-error" role="alert">{error}</p> : null}
      <p className="purchase-total">Total PO: <strong>{total === null ? 'Periksa item' : formatIDR(total)}</strong></p>
      <p className="field-hint">Menyimpan draf tidak mengubah stok. Jika respons penyimpanan hilang, periksa daftar PO sebelum membuat draf baru.</p>
      {message ? <p className="form-error" role="alert">{message}</p> : null}
      <div className="row-actions"><button className="primary-button" type="submit" disabled={total === null || !supplier?.isActive}>{saving ? 'Menyimpan…' : 'Simpan draf'}</button><Link className="secondary-button" href="/purchases">Kembali ke pembelian</Link></div>
    </section></fieldset></form>;
}
