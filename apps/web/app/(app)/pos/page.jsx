'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../components/auth-provider';
import { DataState, formatIDR, PageHeading, Pagination } from '../../../components/catalog-ui';
import { PaymentDialog } from '../../../components/payment-dialog';
import { HoldDialog, HeldCartsPanel } from '../../../components/held-carts';
import { request } from '../../../lib/api';
import { MAX_MONEY, saleTotals } from '../../../../../shared/money';

function CartQuantity({ item, disabled, maxQuantity, onQuantity, onError }) {
  const [draft, setDraft] = useState(String(item.quantity));
  useEffect(() => { setDraft(String(item.quantity)); }, [item.quantity]);
  function change(value) {
    setDraft(value);
    if (value !== '' && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= maxQuantity) {
      onQuantity(item.id, value);
    }
  }
  function restore() {
    if (draft !== String(item.quantity)) onError('Jumlah harus bilangan bulat positif dan tidak melebihi stok.');
    setDraft(String(item.quantity));
  }
  return <input id={`qty-${item.id}`} type="number" min="1" max={maxQuantity} step="1" value={draft} disabled={disabled}
    onChange={(event) => change(event.target.value)} onBlur={restore} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); setDraft(String(item.quantity)); event.currentTarget.blur(); }
      if (event.key === 'Enter') event.currentTarget.blur();
    }} />;
}

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
  const [scanning, setScanning] = useState(false);
  const [holding, setHolding] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [heldReload, setHeldReload] = useState(0);
  const [activeHeld, setActiveHeld] = useState(null);
  const [needsHeldReview, setNeedsHeldReview] = useState(false);
  const [pending, setPending] = useState(null);
  const [storageReady, setStorageReady] = useState(false);
  const pendingRef = useRef(null);
  const checkoutLock = useRef(false);
  const searchRef = useRef(null);
  const scanQueue = useRef(Promise.resolve());
  const scanCount = useRef(0);
  const cartRef = useRef([]);
  const stateRef = useRef({ pending: false, storageReady: false, checkoutReady: false });
  const mounted = useRef(false);
  const wasPaying = useRef(false);
  const storageKey = `stockly-pending-checkout:${user?.id}`;
  const heldKey = (id) => `stockly-resumed-cart:${user?.id}:${id}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (wasPaying.current && !paying) searchRef.current?.focus();
    wasPaying.current = paying;
  }, [paying]);

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
  const checkoutReady = !pending && !scanning && !needsHeldReview && storageReady && cart.length > 0 && !!totals && settingsReady &&
    !cart.some((item) => !item.isActive || !item.category.isActive || item.quantity > item.stock);
  const holdReady = !activeHeld && !pending && !scanning && storageReady && !paying && !needsHeldReview &&
    cart.length > 0 && !!totals && settingsReady && !cart.some((item) => !item.isActive || !item.category.isActive || item.quantity > item.stock);
  stateRef.current = { pending: !!pending, storageReady, checkoutReady, holdReady, paying, activeHeld: !!activeHeld, needsHeldReview };

  useEffect(() => {
    function shortcuts(event) {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || document.querySelector('dialog[open]')) return;
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, select, [contenteditable="true"]'));
      if (event.key === 'F2' && (!editing || target === searchRef.current)) {
        event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select();
      } else if (event.key === 'F4' && !editing && stateRef.current.checkoutReady) {
        event.preventDefault(); setPaying(true);
      } else if (event.key === 'F6' && !editing && stateRef.current.holdReady) {
        event.preventDefault(); setHolding(true);
      } else if (event.key === 'F7' && !editing) {
        event.preventDefault(); setHeldOpen(true);
      }
    }
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, []);

  function updateCart(updater) {
    const next = updater(cartRef.current);
    cartRef.current = next; setCart(next);
  }

  function add(product) {
    if (pendingRef.current || !stateRef.current.storageReady || stateRef.current.paying) { setMessage('Keranjang terkunci selama pembayaran.'); return; }
    if (stateRef.current.activeHeld || stateRef.current.needsHeldReview) { setMessage('Selesaikan atau buang keranjang yang dilanjutkan sebelum menambah produk.'); return; }
    if (!product.isActive || !product.category.isActive) { setMessage('Produk tidak aktif dan tidak dapat ditambahkan.'); return; }
    const existing = cartRef.current.find((entry) => entry.id === product.id);
    if (product.stock < 1) { setMessage(`${product.name} habis. Stok tersedia: 0.`); return; }
    if ((existing?.quantity ?? 0) >= Math.min(product.stock, 10000) || (!existing && cartRef.current.length >= 100)) {
      setMessage('Jumlah melebihi stok atau batas keranjang.'); return; }
    setMessage('');
    updateCart((old) => existing ? old.map((entry) => entry.id === product.id ? { ...entry, ...product, quantity: entry.quantity + 1 } : entry)
      : [...old, { ...product, quantity: 1 }]);
    return (existing?.quantity ?? 0) + 1;
  }
  function scan(event) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const barcode = event.currentTarget.value.trim();
    if (!barcode) return;
    setQ(''); setPage(1);
    if (!/^[0-9]{1,64}$/.test(barcode)) { setMessage('Barcode harus berisi angka. Untuk nama atau SKU, gunakan hasil pencarian.'); return; }
    scanCount.current += 1; setScanning(true); stateRef.current.checkoutReady = false;
    scanQueue.current = scanQueue.current.catch(() => {}).then(async () => {
      try {
        const result = await request(`/api/products?${new URLSearchParams({ barcode, pageSize: '1' })}`);
        if (!mounted.current) return;
        const product = result.items[0];
        if (!product) { setMessage(`Barcode ${barcode} tidak ditemukan atau produk tidak aktif.`); return; }
        const count = add(product);
        if (count) setMessage(`${product.name} ditambahkan. Jumlah ${count}; stok tersedia ${product.stock}.`);
      } catch { if (mounted.current) setMessage(`Barcode ${barcode} gagal diperiksa. Pindai ulang.`); }
      finally { scanCount.current -= 1; if (scanCount.current === 0 && mounted.current) setScanning(false); }
    });
  }
  function quantity(productId, value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) return;
    const product = cartRef.current.find((entry) => entry.id === productId);
    if (number > Math.min(product.stock, 10000, activeHeld?.limits[productId] ?? 10000)) { setMessage('Jumlah melebihi stok atau jumlah keranjang saat ditahan.'); return; }
    setMessage(''); updateCart((old) => old.map((entry) => entry.id === productId ? { ...entry, quantity: number } : entry));
  }
  async function refreshCart() {
    if (pending || activeHeld || needsHeldReview) { setHeldOpen(true); setMessage('Periksa ulang keranjang ditahan melalui daftar sebelum membayar.'); return; }
    try {
      const [settings, updated] = await Promise.all([request('/api/sales/settings'), Promise.all(cart.map((entry) => request(`/api/products/${entry.id}`)))]);
      setTaxRate(settings.defaultTaxRate);
      updateCart((old) => old.map((entry) => ({ ...updated.find((result) => result.product.id === entry.id).product, quantity: entry.quantity })));
      setReload((n) => n + 1); setMessage('Harga dan stok keranjang diperbarui. Periksa kembali jumlah barang.');
    } catch { setMessage('Keranjang tidak dapat diperbarui. Produk mungkin sudah dinonaktifkan. Hapus produk tersebut atau coba lagi.'); }
  }
  async function confirm(amountReceived) {
    if (checkoutLock.current) throw new Error('Pembayaran sedang diproses.');
    checkoutLock.current = true;
    try {
      const body = pendingRef.current ?? { idempotencyKey: crypto.randomUUID(),
        items: cart.map((item) => ({ productId: item.id, quantity: item.quantity })),
        discount: Number(discount), expectedTotal: totals.total, amountReceived,
        ...(activeHeld && { heldCartId: activeHeld.id, resumeToken: activeHeld.resumeToken,
          acceptedPrices: cart.map((item) => ({ productId: item.id, unitPrice: item.sellingPrice })) }) };
      try { sessionStorage.setItem(storageKey, JSON.stringify(body)); }
      catch { throw new Error('Pembayaran belum dikirim: penyimpanan sesi tidak tersedia.'); }
      pendingRef.current = body; setPending(body);
      try {
        const result = await request('/api/sales', { method: 'POST', body });
        sessionStorage.removeItem(storageKey); pendingRef.current = null; setPending(null);
        if (body.heldCartId) { sessionStorage.removeItem(heldKey(body.heldCartId)); setActiveHeld(null); setNeedsHeldReview(false); setHeldReload((n) => n + 1); }
        updateCart(() => []); setDiscount(0); setReload((n) => n + 1); setMessage('Pembayaran berhasil disimpan.');
        return result.sale;
      } catch (error) {
        if (error.status === 400 || error.status === 409) {
          sessionStorage.removeItem(storageKey); pendingRef.current = null; setPending(null);
          if (body.heldCartId) { setNeedsHeldReview(true); setHeldOpen(true); }
          setPaying(false); setMessage(error.message);
        }
        throw error;
      }
    } finally { checkoutLock.current = false; }
  }
  function applyHeld(result, items) {
    const limits = Object.fromEntries(result.review.map((entry) => [entry.productId, entry.quantity]));
    let nextDiscount = result.cart.discount;
    try { saleTotals(items.map((item) => ({ unitPrice: item.sellingPrice, quantity: item.quantity })), nextDiscount, taxRate); }
    catch { nextDiscount = 0; }
    updateCart(() => items); setDiscount(nextDiscount);
    setActiveHeld({ id: result.cart.id, resumeToken: result.resumeToken, limits }); setNeedsHeldReview(false); setHeldOpen(false);
    setMessage(nextDiscount === result.cart.discount ? 'Keranjang dilanjutkan dengan harga saat ini. Periksa total sebelum membayar.'
      : 'Keranjang dilanjutkan. Diskon lama tidak sesuai total baru dan diatur menjadi nol; periksa kembali.');
  }
  function discardActive(id) {
    if (activeHeld?.id !== id) return;
    updateCart(() => []); setDiscount(0); setActiveHeld(null); setNeedsHeldReview(false);
  }
  function heldSaved(saved) {
    updateCart(() => []); setDiscount(0); setHolding(false); setHeldOpen(true); setHeldReload((n) => n + 1);
    setMessage(`Keranjang ${saved.label} disimpan. Stok tidak dicadangkan.`);
  }
  return <><PageHeading title="Kasir" description="Pilih produk, periksa keranjang, lalu terima pembayaran tunai." />
    {message ? <p className="feedback" role="status">{message}</p> : null}
    {pending && !paying ? <div className="pending-payment" role="status"><p>Pembayaran {formatIDR(pending.expectedTotal)} belum terkonfirmasi. Keranjang dikunci untuk menghindari transaksi ganda.</p><button type="button" className="primary-button" onClick={() => setPaying(true)}>Periksa pembayaran tertunda</button></div> : null}
     <div className="pos-grid"><section className="work-panel pos-products"><div className="catalog-toolbar"><label>Cari nama, SKU, atau pindai barcode<input ref={searchRef} type="search" value={q} onKeyDown={(event) => { if (event.key === 'Escape') { setQ(''); return; } scan(event); }} onChange={(event) => { setQ(event.target.value); setPage(1); setStatus('loading'); }} autoComplete="off" /></label><label>Kategori<select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); setStatus('loading'); }}><option value="">Semua kategori</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div><p className="field-hint">F2 cari · Enter pindai · F4 bayar · F6 tahan · F7 keranjang ditahan · F8 transaksi.</p>
      <button type="button" className="inline-button" onClick={() => { setStatus('loading'); setReload((n) => n + 1); }}>Muat ulang</button>
      <DataState status={status} empty={status === 'ready' && products.length === 0} retry={() => { setStatus('loading'); setReload((n) => n + 1); }} />
       {status === 'ready' ? <div className="product-picks">{products.map((product) => <button key={product.id} type="button" className="product-pick" disabled={product.stock < 1 || !!pending || !!activeHeld || needsHeldReview} onClick={() => add(product)} aria-label={`Tambah ${product.name}`}><strong>{product.name}</strong><span className="subline">{product.sku}{product.sku.startsWith('DEMO-') ? ' (demo)' : ''}</span><span className="pick-bottom"><b>{formatIDR(product.sellingPrice)}</b><span>Stok {product.stock}</span></span></button>)}</div> : null}
      <Pagination page={page} pages={paging.pages} total={paging.total} onChange={(value) => { setPage(value); setStatus('loading'); }} />
    </section><section className="work-panel cart-panel"><h2>Keranjang</h2>
       {activeHeld ? <p className="field-hint">Keranjang ditahan sedang dibuka. Tambah produk baru tidak tersedia sampai keranjang ini selesai atau dibuang.</p> : null}
       {needsHeldReview && activeHeld ? <div className="pending-payment"><p>Periksa ulang keranjang ini. Jika sudah dibayar di sesi lain, periksa riwayat transaksi sebelum mengosongkan layar.</p><button className="secondary-button" type="button" onClick={() => {
         if (!window.confirm('Kosongkan tampilan keranjang? Data keranjang ditahan di server tidak akan dihapus. Periksa riwayat transaksi lebih dahulu jika pembayaran mungkin sudah terjadi.')) return;
         updateCart(() => []); setDiscount(0); setActiveHeld(null); setNeedsHeldReview(false); setMessage('Tampilan dikosongkan. Keranjang di server tetap dapat diperiksa melalui daftar.');
       }}>Kosongkan tampilan saja</button></div> : null}
       {cart.length === 0 ? <p>Belum ada barang. Pilih produk di sebelah kiri.</p> : <ul className="cart-items">{cart.map((item) => <li key={item.id}><div className="cart-item-title"><strong>{item.name}</strong><button type="button" className="inline-button" disabled={!!pending || needsHeldReview} aria-label={`Hapus ${item.name}`} onClick={() => updateCart((old) => old.filter((entry) => entry.id !== item.id))}>Hapus</button></div><span className="subline">{formatIDR(item.sellingPrice)} per unit · Stok tersedia {item.stock}</span><div className="cart-quantity"><button type="button" className="secondary-button" disabled={!!pending || needsHeldReview || item.quantity <= 1} aria-label={`Kurangi ${item.name}`} onClick={() => quantity(item.id, item.quantity - 1)}>−</button><label className="sr-only" htmlFor={`qty-${item.id}`}>Jumlah {item.name}</label><CartQuantity item={item} disabled={!!pending || needsHeldReview} maxQuantity={Math.min(item.stock, 10000, activeHeld?.limits[item.id] ?? 10000)} onQuantity={quantity} onError={setMessage} /><button type="button" className="secondary-button" disabled={!!pending || needsHeldReview || item.quantity >= Math.min(item.stock, 10000, activeHeld?.limits[item.id] ?? 10000)} aria-label={`Tambah jumlah ${item.name}`} onClick={() => quantity(item.id, item.quantity + 1)}>+</button><strong>{formatIDR(item.sellingPrice * item.quantity)}</strong></div></li>)}</ul>}
       <button className="inline-button" type="button" disabled={!!pending || !cart.length} onClick={refreshCart}>{activeHeld ? 'Periksa ulang keranjang ditahan' : 'Perbarui harga dan stok'}</button>
      <label>Diskon (IDR)<input type="number" min="0" max={MAX_MONEY} step="1" value={discount} disabled={!!pending} onChange={(event) => setDiscount(event.target.value)} /></label>
      {totalError ? <p className="form-error" role="alert">{totalError}</p> : null}
      <dl className="totals"><div><dt>Subtotal</dt><dd>{formatIDR(totals?.subtotal ?? 0)}</dd></div><div><dt>Diskon</dt><dd>{formatIDR(totals?.discount ?? 0)}</dd></div><div><dt>Pajak ({taxRate / 100}%)</dt><dd>{formatIDR(totals?.tax ?? 0)}</dd></div><div className="grand-total"><dt>Total</dt><dd>{formatIDR(totals?.total ?? 0)}</dd></div></dl>
       <button type="button" className="primary-button checkout-button" disabled={!checkoutReady} onClick={() => setPaying(true)}>Bayar tunai <span className="shortcut-hint">F4</span></button>
       <button type="button" className="secondary-button checkout-button" disabled={!holdReady} onClick={() => setHolding(true)}>Tahan keranjang · F6</button>
       <p className="field-hint">Harga dan stok akan diperiksa kembali oleh server.</p>
     </section></div>
     <HeldCartsPanel opened={heldOpen} onOpen={setHeldOpen} userId={user?.id} cartSize={cart.length} activeHeldId={activeHeld?.id}
       locked={!!pending || paying} onApply={applyHeld} onDiscardActive={discardActive} refreshKey={heldReload} />
     {holding ? <HoldDialog cart={cart} discount={discount} onSaved={heldSaved} onClose={() => setHolding(false)} /> : null}
    {paying ? <PaymentDialog total={totals?.total ?? 0} pending={pending} onConfirm={confirm} onClose={() => setPaying(false)} /> : null}</>;
}
