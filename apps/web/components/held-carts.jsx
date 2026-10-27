'use client';

import { useEffect, useRef, useState } from 'react';
import { DataState, formatIDR } from './catalog-ui';
import { request } from '../lib/api';

export function HoldDialog({ cart, discount, onSaved, onClose }) {
  const dialog = useRef(null); const lock = useRef(false);
  const [label, setLabel] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(event) {
    event.preventDefault(); if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await request('/api/held-carts', { method: 'POST', body: {
        label: label.trim(), discount: Number(discount), items: cart.map((item) => ({ productId: item.id, quantity: item.quantity }))
      } });
      onSaved(result.cart);
    } catch (failure) { setError(`${failure.message} Jika respons tidak pasti, periksa daftar keranjang sebelum menyimpan lagi.`); }
    finally { lock.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="stock-dialog" onClose={onClose} aria-labelledby="hold-title"><h2 id="hold-title">Tahan keranjang</h2>
    <p>Barang yang ditahan tidak memesan atau mengurangi stok. Harga dan ketersediaan akan diperiksa kembali saat dilanjutkan.</p>
    <form onSubmit={submit}><label>Label keranjang<input value={label} maxLength={120} required autoFocus onChange={(event) => setLabel(event.target.value)} placeholder="Contoh: pelanggan meja depan" /></label>
      <p>{cart.length} produk · {cart.reduce((sum, item) => sum + item.quantity, 0)} unit</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="row-actions"><button className="primary-button" type="submit" disabled={busy || !label.trim()}>{busy ? 'Menyimpan…' : 'Simpan keranjang'}</button><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>Batal</button></div>
    </form>
  </dialog>;
}

function ReviewDialog({ result, onApply, onClose, replacing }) {
  const dialog = useRef(null);
  const [selections, setSelections] = useState(() => Object.fromEntries(result.review.map((entry) => [entry.productId, {
    included: !entry.inactive && entry.product.stock > 0,
    quantity: Math.min(entry.quantity, entry.product.stock, 10000)
  }])));
  const available = result.review.filter((entry) => selections[entry.productId].included);
  const valid = available.length > 0 && available.every((entry) => {
    const quantity = selections[entry.productId].quantity;
    return Number.isInteger(quantity) && quantity >= 1 && quantity <= Math.min(entry.quantity, entry.product.stock, 10000) && !entry.inactive;
  });
  useEffect(() => { dialog.current?.showModal(); }, []);
  function apply() {
    if (!valid) return;
    onApply(result, available.map((entry) => ({ ...entry.product, quantity: selections[entry.productId].quantity })));
    onClose();
  }
  return <dialog ref={dialog} className="stock-dialog held-review" onClose={onClose} aria-labelledby="held-review-title"><h2 id="held-review-title">Periksa sebelum melanjutkan</h2>
    <p><strong>{result.cart.label}</strong> · Stok tidak dicadangkan saat keranjang ditahan.</p>
    {replacing ? <p className="form-error" role="alert">Melanjutkan keranjang ini akan mengganti isi keranjang POS yang belum disimpan.</p> : null}
    <p>Harga saat ditahan dibandingkan dengan harga saat ini. Pilih barang yang tersedia dan periksa jumlahnya sebelum mengonfirmasi.</p>
    <div className="table-scroll"><table><thead><tr><th>Sertakan / produk</th><th>Harga dulu / sekarang</th><th>Jumlah / stok</th></tr></thead><tbody>{result.review.map((entry) => {
      const choice = selections[entry.productId]; const max = Math.min(entry.quantity, entry.product.stock, 10000);
      return <tr key={entry.productId}><td><label className="held-choice"><input type="checkbox" checked={choice.included} disabled={entry.inactive || max < 1} onChange={(event) => setSelections((old) => ({ ...old, [entry.productId]: { ...choice, included: event.target.checked } }))} /><span><strong>{entry.product.name}</strong><span className="subline">{entry.product.sku}{entry.inactive ? ' · Nonaktif: tidak dapat dibayar' : ''}</span></span></label></td>
        <td>{formatIDR(entry.unitPriceSnapshot)}<span className="subline">Sekarang {formatIDR(entry.product.sellingPrice)}{entry.priceChanged ? ' · Harga berubah' : ''}</span></td>
        <td>{choice.included ? <><label className="sr-only" htmlFor={`review-qty-${entry.productId}`}>Jumlah {entry.product.name}</label><input id={`review-qty-${entry.productId}`} className="purchase-number" type="number" min="1" max={max} step="1" value={choice.quantity} onChange={(event) => setSelections((old) => ({ ...old, [entry.productId]: { ...choice, quantity: event.target.value === '' ? '' : Number(event.target.value) } }))} /></> : entry.quantity}<span className="subline">Ditahan {entry.quantity} · Stok {entry.product.stock}{entry.insufficientStock ? ' · Stok berkurang' : ''}</span></td></tr>;
    })}</tbody></table></div>
    <p className="field-hint">Sesi resume berlaku sampai {new Date(result.expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB. Jika habis, buka ulang dan periksa kembali.</p>
    <div className="row-actions"><button className="primary-button" type="button" disabled={!valid} onClick={apply}>Gunakan keranjang yang diperiksa</button><button className="secondary-button" type="button" onClick={onClose}>Kembali ke daftar</button></div>
  </dialog>;
}

export function HeldCartsPanel({ opened, onOpen, userId, cartSize, onApply, onDiscardActive, refreshKey, locked, activeHeldId }) {
  const section = useRef(null);
  const [data, setData] = useState({ items: [], total: 0, pages: 0 });
  const [page, setPage] = useState(1); const [reload, setReload] = useState(0);
  const [status, setStatus] = useState('loading'); const [message, setMessage] = useState('');
  const [review, setReview] = useState(null); const [discarding, setDiscarding] = useState(null); const [busy, setBusy] = useState(false);
  const resumeKey = (id) => `stockly-resumed-cart:${userId}:${id}`;
  useEffect(() => {
    if (opened) section.current?.focus();
  }, [opened]);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    request(`/api/held-carts?${new URLSearchParams({ mine: 'true', page: String(page), pageSize: '20' })}`)
      .then((result) => { if (active) { setData(result); setStatus('ready'); } })
      .catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [page, userId, reload, refreshKey]);
  async function resume(id) {
    if (locked || (activeHeldId && activeHeldId !== id)) return;
    setBusy(true); setMessage('');
    try {
      let saved;
      try { saved = JSON.parse(sessionStorage.getItem(resumeKey(id))); } catch { saved = null; }
      const resumeToken = saved?.resumeToken ?? crypto.randomUUID();
      sessionStorage.setItem(resumeKey(id), JSON.stringify({ resumeToken }));
      const result = await request(`/api/held-carts/${id}/resume`, { method: 'POST', body: { resumeToken } });
      setReview(result); setReload((n) => n + 1);
    } catch (error) {
      if (error.status === 409) sessionStorage.removeItem(resumeKey(id));
      setMessage(`${error.message} Jika sesi lain menguasainya, tunggu kedaluwarsa atau periksa transaksi.`);
    }
    finally { setBusy(false); }
  }
  async function discard() {
    if (locked) return;
    setBusy(true); setMessage('');
    try {
      await request(`/api/held-carts/${discarding.id}`, { method: 'DELETE' });
      sessionStorage.removeItem(resumeKey(discarding.id));
      onDiscardActive(discarding.id); setDiscarding(null); setReload((n) => n + 1); setMessage('Keranjang dibuang. Tidak ada stok atau pembayaran yang diubah.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <section ref={section} tabIndex={-1} className="work-panel held-panel" aria-label="Keranjang ditahan"><div className="row-actions held-heading"><h2>Keranjang ditahan ({data.total})</h2><button type="button" className="secondary-button" aria-expanded={opened} onClick={() => onOpen(!opened)}>{opened ? 'Tutup daftar' : 'Buka daftar · F7'}</button></div>
    {opened ? <><p className="field-hint">Keranjang ditahan tidak mencadangkan stok. Harga dan ketersediaan dicek ulang ketika dilanjutkan.</p>
      {message ? <p className="feedback" role="status">{message}</p> : null}
      <DataState status={status} empty={status === 'ready' && !data.total} retry={() => { setStatus('loading'); setReload((n) => n + 1); }} />
      {status === 'ready' && data.items.length ? <><ul className="held-list">{data.items.map((item) => <li key={item.id}><div><strong>{item.label}</strong><span className="subline">{item._count.items} produk · {item.status === 'RESUMED' ? 'Sedang dibuka' : 'Ditahan'} · Diperbarui {new Date(item.updatedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</span></div><div className="row-actions"><button className="inline-button" type="button" disabled={busy || locked || (activeHeldId && activeHeldId !== item.id)} onClick={() => resume(item.id)}>Lanjutkan / periksa</button><button className="inline-button" type="button" disabled={busy || locked} onClick={() => setDiscarding(item)}>Buang</button></div></li>)}</ul><div className="row-actions"><button className="secondary-button" type="button" disabled={page <= 1} onClick={() => { setPage(page - 1); setStatus('loading'); }}>Sebelumnya</button><span>Halaman {page} dari {data.pages}</span><button className="secondary-button" type="button" disabled={page >= data.pages} onClick={() => { setPage(page + 1); setStatus('loading'); }}>Berikutnya</button></div></> : null}</> : null}
    {review ? <ReviewDialog result={review} replacing={cartSize > 0} onClose={() => setReview(null)} onApply={onApply} /> : null}
    {discarding ? <dialog ref={(node) => { if (node && !node.open) node.showModal(); }} className="stock-dialog" onClose={() => setDiscarding(null)} aria-labelledby="discard-title"><h2 id="discard-title">Buang keranjang?</h2><p><strong>{discarding.label}</strong> tidak dapat dilanjutkan setelah dibuang. Tidak ada penjualan atau perubahan stok.</p><div className="row-actions"><button className="primary-button" type="button" disabled={busy} onClick={discard}>{busy ? 'Membuang…' : 'Ya, buang'}</button><button className="secondary-button" type="button" disabled={busy} onClick={() => setDiscarding(null)}>Batal</button></div></dialog> : null}
  </section>;
}
