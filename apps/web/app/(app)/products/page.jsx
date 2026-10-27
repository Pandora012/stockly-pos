'use client';

import { useDeferredValue, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../../components/auth-provider';
import { DataState, formatIDR, PageHeading, Pagination, StockLevel } from '../../../components/catalog-ui';
import { request } from '../../../lib/api';

const positive = z.number().int('Gunakan bilangan bulat.').min(1, 'Harus lebih dari nol.').max(1_000_000_000);
const nonnegative = z.number().int('Gunakan bilangan bulat.').min(0, 'Tidak boleh negatif.').max(1_000_000_000);
const schema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi.').max(160),
  categoryId: z.string().uuid('Pilih kategori.'),
  sku: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'SKU hanya huruf, angka, _ atau -').max(64),
  barcode: z.string().regex(/^[0-9]*$/, 'Barcode hanya angka.').max(64),
  description: z.string().max(1000),
  purchasePrice: positive, sellingPrice: positive, minimumStock: nonnegative,
  initialStock: nonnegative, imageUrl: z.string().refine((value) => !value || /^https?:\/\//.test(value), 'Gunakan URL http atau https.')
});
const defaults = { name: '', categoryId: '', sku: '', barcode: '', description: '', purchasePrice: 0,
  sellingPrice: 0, minimumStock: 0, initialStock: 0, imageUrl: '' };

function ProductForm({ product, categories, onSaved, onCancel }) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), defaultValues: defaults });
  const [error, setError] = useState('');
  useEffect(() => { reset(product ? { ...product, barcode: product.barcode ?? '', imageUrl: product.imageUrl ?? '', initialStock: 0 } : defaults); setError(''); }, [product, reset]);

  async function submit(values) {
    setError('');
    const { initialStock, ...fields } = values;
    const body = { ...fields, sku: fields.sku.toUpperCase(), barcode: fields.barcode || null,
      imageUrl: fields.imageUrl || null, ...(!product && { initialStock }) };
    try {
      await request(product ? `/api/products/${product.id}` : '/api/products', { method: product ? 'PATCH' : 'POST', body });
      onSaved(product ? 'Produk diperbarui.' : 'Produk ditambahkan.');
    } catch (failure) { setError(failure.message); }
  }
  const field = (label, name, props = {}) => <label>{label}<input {...props} {...register(name, props.type === 'number' ? { valueAsNumber: true } : {})} aria-invalid={!!errors[name]} />{errors[name] ? <small role="alert">{errors[name].message}</small> : null}</label>;
  return <section className="work-panel editor-panel" aria-label={product ? 'Ubah produk' : 'Tambah produk'}><h2>{product ? 'Ubah produk' : 'Tambah produk'}</h2>
    <form onSubmit={handleSubmit(submit)} noValidate>
      {field('Nama produk', 'name', { maxLength: 160 })}
      <label>Kategori<select {...register('categoryId')} aria-invalid={!!errors.categoryId}><option value="">Pilih kategori</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.isActive ? '' : ' (nonaktif)'}</option>)}</select>{errors.categoryId ? <small role="alert">{errors.categoryId.message}</small> : null}</label>
      <div className="form-pair">{field('SKU', 'sku', { maxLength: 64 })}{field('Barcode (opsional)', 'barcode', { maxLength: 64 })}</div>
      <label>Deskripsi<textarea rows="3" maxLength="1000" {...register('description')} />{errors.description ? <small role="alert">{errors.description.message}</small> : null}</label>
      <div className="form-pair">{field('Harga beli (IDR)', 'purchasePrice', { type: 'number', min: 1, step: 1 })}{field('Harga jual (IDR)', 'sellingPrice', { type: 'number', min: 1, step: 1 })}</div>
      <div className="form-pair">{product ? null : field('Stok awal', 'initialStock', { type: 'number', min: 0, step: 1 })}{field('Stok minimum', 'minimumStock', { type: 'number', min: 0, step: 1 })}</div>
      {field('URL gambar (opsional)', 'imageUrl', { type: 'url', maxLength: 500 })}
      {product ? <p className="field-hint">Stok diubah hanya melalui Inventaris, bukan formulir produk.</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="row-actions"><button className="primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : product ? 'Simpan produk' : 'Tambah produk'}</button><button className="secondary-button" type="button" onClick={onCancel}>Batal</button></div>
    </form></section>;
}

export default function ProductsPage() {
  const { user } = useAuth();
  const admin = user?.role === 'ADMIN';
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const deferredQuery = useDeferredValue(q);
  const [categoryId, setCategoryId] = useState('');
  const [active, setActive] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [editing, setEditing] = useState(undefined);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let mounted = true;
    request('/api/categories').then((data) => { if (mounted) setCategories(data.categories); })
      .catch(() => { if (mounted) setMessage('Kategori tidak dapat dimuat. Coba muat ulang halaman.'); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    let mounted = true;
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (deferredQuery) params.set('q', deferredQuery);
    if (categoryId) params.set('categoryId', categoryId);
    if (admin && active) params.set('isActive', active);
    if (lowStock) params.set('lowStock', 'true');
    request(`/api/products?${params}`).then((data) => { if (mounted) {
      setItems(data.items); setTotal(data.total); setPages(data.pages); setStatus('ready');
    } }).catch(() => { if (mounted) setStatus('error'); });
    return () => { mounted = false; };
  }, [page, deferredQuery, categoryId, active, lowStock, admin, reload]);

  function saved(text) { setEditing(undefined); setMessage(text); setStatus('loading'); setReload((n) => n + 1); }
  async function toggle(product) {
    setBusy(product.id); setMessage('');
    try { await request(`/api/products/${product.id}`, { method: 'PATCH', body: { isActive: !product.isActive } }); saved(`Produk ${product.isActive ? 'dinonaktifkan' : 'diaktifkan'}.`); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(null); }
  }
  function filter(setter, value) { setter(value); setPage(1); setStatus('loading'); }

  return <><PageHeading title="Produk" description="Cari dan kelola katalog yang tersedia di toko." action={admin ? <button type="button" className="primary-button" onClick={() => { setEditing(null); setMessage(''); }}>Tambah produk</button> : null} />
    <div className="catalog-layout"><section className="work-panel"><div className="catalog-toolbar"><label>Cari nama, SKU, atau barcode<input type="search" value={q} onChange={(event) => filter(setQ, event.target.value)} placeholder="Ketik untuk mencari" /></label>
      <label>Kategori<select value={categoryId} onChange={(event) => filter(setCategoryId, event.target.value)}><option value="">Semua kategori</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      {admin ? <label>Status<select value={active} onChange={(event) => filter(setActive, event.target.value)}><option value="">Semua</option><option value="true">Aktif</option><option value="false">Nonaktif</option></select></label> : null}
      <label className="checkbox-field"><input type="checkbox" checked={lowStock} onChange={(event) => filter(setLowStock, event.target.checked)} /> Stok rendah</label></div>
      <DataState status={status} retry={() => { setStatus('loading'); setReload((n) => n + 1); }} empty={status === 'ready' && total === 0} />
      {status === 'ready' && total > 0 ? <><div className="table-scroll"><table><thead><tr><th>Produk</th><th>SKU / Barcode</th><th>Kategori</th><th className="numeric">Harga jual</th><th className="numeric">Stok</th>{admin ? <><th>Status</th><th>Tindakan</th></> : null}</tr></thead><tbody>{items.map((product) => <tr key={product.id}><td><strong>{product.name}</strong>{product.sku.startsWith('DEMO-') ? <span className="demo-tag">Data demo</span> : null}</td><td>{product.sku}<span className="subline">{product.barcode || 'Tanpa barcode'}</span></td><td>{product.category.name}</td><td className="numeric">{formatIDR(product.sellingPrice)}</td><td className="numeric"><StockLevel stock={product.stock} minimumStock={product.minimumStock} /></td>{admin ? <><td>{product.isActive ? 'Aktif' : 'Nonaktif'}</td><td><div className="row-actions"><button className="inline-button" type="button" onClick={() => setEditing(product)}>Ubah</button><button className="inline-button" type="button" disabled={busy === product.id} onClick={() => toggle(product)}>{product.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button></div></td></> : null}</tr>)}</tbody></table></div><Pagination page={page} pages={pages} total={total} onChange={(value) => { setPage(value); setStatus('loading'); }} /></> : null}
    </section>{admin && editing !== undefined ? <ProductForm key={editing?.id ?? 'new'} product={editing} categories={categories} onSaved={saved} onCancel={() => setEditing(undefined)} /> : null}</div>
    {message ? <p className="feedback" role="status">{message}</p> : null}</>;
}
