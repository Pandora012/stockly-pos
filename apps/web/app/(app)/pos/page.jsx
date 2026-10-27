'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../components/auth-provider';
import { DataState, formatIDR, PageHeading, Pagination } from '../../../components/catalog-ui';
import { PaymentDialog } from '../../../components/payment-dialog';
import { request } from '../../../lib/api';
import { MAX_MONEY, saleTotals } from '../../../../../shared/money';

export default function PosPage() {
  const { user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [taxRate, setTaxRate] = useState(0);
  const [settingsReady, setSettingsReady] = useState(false);
  const [status, setStatus] = useState('loading');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [paging, setPaging] = useState({ pages: 0, total: 0 });
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState('');
  const [paying, setPaying] = useState(false);
  const [pending, setPending] = useState(null);
  const [storageReady, setStorageReady] = useState(false);
  const pendingRef = useRef(null);
  const checkoutLock = useRef(false);
  const storageKey = `stockly-pending-checkout:${user?.id}`;

  useEffect(() => {
    if (!user) return;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const value = JSON.parse(saved);
        if (!value.idempotencyKey || !Array.isArray(value.items) || !Number.isInteger(value.expectedTotal)) throw new Error();
        pendingRef.current = value; setPending(value);
      }
      setStorageReady(true);
    } catch { setMessage('Penyimpanan pembayaran tidak tersedia atau rusak. Periksa riwayat sebelum transaksi baru.'); }
  }, [storageKey, user]);
  useEffect(() => {
    let active = true;
    Promise.all([request('/api/categories'), request('/api/sales/settings')]).then(([data, settings]) => {
      if (active) { setCategories(data.categories.filter((entry) => entry.isActive)); setTaxRate(settings.defaultTaxRate); setSettingsReady(true); }
    }).catch(() => { if (active) { setSettingsReady(false); setMessage('Kategori atau pengaturan pajak gagal dimuat. Klik Muat ulang.'); } });
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), pageSize: '20', isActive: 'true' });
    if (q) params.set('q', q);
    if (categoryId) params.set('categoryId', categoryId);
    request(`/api/products?${params}`).then((data) => {
      if (active) { setProducts(data.items.filter((entry) => entry.category.isActive)); setPaging(data); setStatus('ready'); }
    }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [q, categoryId, page, reload]);

  let totals = null; let totalError = '';
  try { totals = saleTotals(cart.map((item) => ({ unitPrice: item.sellingPrice, quantity: item.quantity })), Number(discount), taxRate); }
  catch (error) { totalError = error.message; }

  function add(product) {
    if (pendingRef.current || !storageReady) return;
    const existing = cart.find((entry) => entry.id === product.id);
    if ((existing?.quantity ?? 0) >= Math.min(product.stock, 10000) || (!existing && cart.length >= 100)) {
      setMessage('Jumlah melebihi stok atau batas keranjang.'); return;
    }
    setMessage('');
    setCart((old) => {
      return existing ? old.map((entry) => entry.id === product.id ? { ...entry, quantity: entry.quantity + 1 } : entry)
        : [...old, { ...product, quantity: 1 }];
    });
  }
  function quantity(productId, value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) return;
    const product = cart.find((entry) => entry.id === productId);
    if (number > Math.min(product.stock, 10000)) { setMessage('Jumlah melebihi stok yang tersedia.'); return; }
    setCart((old) => old.map((entry) => entry.id === productId ? { ...entry, quantity: number } : entry));
  }
  async function refreshCart() {
    if (pending) return;
    try {
      const [settings, updated] = await Promise.all([request('/api/sales/settings'), Promise.all(cart.map((entry) => request(`/api/products/${entry.id}`)))]);
      setTaxRate(settings.defaultTaxRate);
      setCart((old) => old.map((entry) => ({ ...updated.find((result) => result.product.id === entry.id).product, quantity: entry.quantity })));
      setReload((n) => n + 1); setMessage('Harga dan stok keranjang diperbarui. Periksa kembali jumlah barang.');
    } catch { setMessage('Keranjang tidak dapat diperbarui. Produk mungkin sudah dinonaktifkan. Hapus produk tersebut atau coba lagi.'); }
  }
  async function confirm(amountReceived) {
    if (checkoutLock.current) throw new Error('Pembayaran sedang diproses.');
    checkoutLock.current = true;
    try {
      const body = pendingRef.current ?? { idempotencyKey: crypto.randomUUID(),
        items: cart.map((item) => ({ productId: item.id, quantity: item.quantity })),
        discount: Number(discount), expectedTotal: totals.total, amountReceived };
      try { sessionStorage.setItem(storageKey, JSON.stringify(body)); }
      catch { throw new Error('Pembayaran belum dikirim: penyimpanan sesi tidak tersedia.'); }
      pendingRef.current = body; setPending(body);
      try {
        const result = await request('/api/sales', { method: 'POST', body });
        sessionStorage.removeItem(storageKey); pendingRef.current = null; setPending(null);
        setCart([]); setDiscount(0); setReload((n) => n + 1); setMessage('Pembayaran berhasil disimpan.');
        return result.sale;
      } catch (error) {
        if (error.status === 400 || error.status === 409) {
          sessionStorage.removeItem(storageKey); pendingRef.current = null; setPending(null);
          setPaying(false); setMessage(error.message);
        }
        throw error;
      }
    } finally { checkoutLock.current = false; }
  }
  return <><PageHeading title="Kasir" description="Pilih produk, periksa keranjang, lalu terima pembayaran tunai." />
    {message ? <p className="feedback" role="status">{message}</p> : null}
    {pending && !paying ? <div className="pending-payment" role="status"><p>Pembayaran {formatIDR(pending.expectedTotal)} belum terkonfirmasi. Keranjang dikunci untuk menghindari transaksi ganda.</p><button type="button" className="primary-button" onClick={() => setPaying(true)}>Periksa pembayaran tertunda</button></div> : null}
    <div className="pos-grid"><section className="work-panel pos-products"><div className="catalog-toolbar"><label>Cari nama atau SKU<input type="search" value={q} onChange={(event) => { setQ(event.target.value); setPage(1); setStatus('loading'); }} /></label><label>Kategori<select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); setStatus('loading'); }}><option value="">Semua kategori</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div>
      <button type="button" className="inline-button" onClick={() => { setStatus('loading'); setReload((n) => n + 1); }}>Muat ulang</button>
      <DataState status={status} empty={status === 'ready' && products.length === 0} retry={() => { setStatus('loading'); setReload((n) => n + 1); }} />
      {status === 'ready' ? <div className="product-picks">{products.map((product) => <button key={product.id} type="button" className="product-pick" disabled={product.stock < 1 || !!pending} onClick={() => add(product)} aria-label={`Tambah ${product.name}`}><strong>{product.name}</strong><span className="subline">{product.sku}{product.sku.startsWith('DEMO-') ? ' (demo)' : ''}</span><span className="pick-bottom"><b>{formatIDR(product.sellingPrice)}</b><span>Stok {product.stock}</span></span></button>)}</div> : null}
      <Pagination page={page} pages={paging.pages} total={paging.total} onChange={(value) => { setPage(value); setStatus('loading'); }} />
    </section><section className="work-panel cart-panel"><h2>Keranjang</h2>
      {cart.length === 0 ? <p>Belum ada barang. Pilih produk di sebelah kiri.</p> : <ul className="cart-items">{cart.map((item) => <li key={item.id}><div className="cart-item-title"><strong>{item.name}</strong><button type="button" className="inline-button" disabled={!!pending} aria-label={`Hapus ${item.name}`} onClick={() => setCart((old) => old.filter((entry) => entry.id !== item.id))}>Hapus</button></div><span className="subline">{formatIDR(item.sellingPrice)} per unit</span><div className="cart-quantity"><button type="button" className="secondary-button" disabled={!!pending || item.quantity <= 1} aria-label={`Kurangi ${item.name}`} onClick={() => quantity(item.id, item.quantity - 1)}>−</button><label className="sr-only" htmlFor={`qty-${item.id}`}>Jumlah {item.name}</label><input id={`qty-${item.id}`} type="number" min="1" max={Math.min(item.stock, 10000)} step="1" value={item.quantity} disabled={!!pending} onChange={(event) => quantity(item.id, event.target.value)} /><button type="button" className="secondary-button" disabled={!!pending || item.quantity >= Math.min(item.stock, 10000)} aria-label={`Tambah jumlah ${item.name}`} onClick={() => quantity(item.id, item.quantity + 1)}>+</button><strong>{formatIDR(item.sellingPrice * item.quantity)}</strong></div></li>)}</ul>}
      <button className="inline-button" type="button" disabled={!!pending || !cart.length} onClick={refreshCart}>Perbarui harga dan stok</button>
      <label>Diskon (IDR)<input type="number" min="0" max={MAX_MONEY} step="1" value={discount} disabled={!!pending} onChange={(event) => setDiscount(event.target.value)} /></label>
      {totalError ? <p className="form-error" role="alert">{totalError}</p> : null}
      <dl className="totals"><div><dt>Subtotal</dt><dd>{formatIDR(totals?.subtotal ?? 0)}</dd></div><div><dt>Diskon</dt><dd>{formatIDR(totals?.discount ?? 0)}</dd></div><div><dt>Pajak ({taxRate / 100}%)</dt><dd>{formatIDR(totals?.tax ?? 0)}</dd></div><div className="grand-total"><dt>Total</dt><dd>{formatIDR(totals?.total ?? 0)}</dd></div></dl>
      <button type="button" className="primary-button checkout-button" disabled={!!pending || !storageReady || !cart.length || !totals || !settingsReady || cart.some((item) => !item.isActive || !item.category.isActive || item.quantity > item.stock)} onClick={() => setPaying(true)}>Bayar tunai</button>
      <p className="field-hint">Harga dan stok akan diperiksa kembali oleh server.</p>
    </section></div>
    {paying ? <PaymentDialog total={totals?.total ?? 0} pending={pending} onConfirm={confirm} onClose={() => setPaying(false)} /> : null}</>;
}
