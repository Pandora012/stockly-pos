'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { formatIDR } from './catalog-ui';
import { MAX_MONEY } from '../../../shared/money';

export function PaymentDialog({ total, pending, onConfirm, onClose }) {
  const dialog = useRef(null);
  const cashInput = useRef(null);
  const receiptLink = useRef(null);
  const lock = useRef(false);
  const [cash, setCash] = useState(pending?.amountReceived ?? total);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sale, setSale] = useState(null);
  const due = pending?.expectedTotal ?? total;
  const cashValue = Number(cash);
  const change = Number.isSafeInteger(cashValue) && cashValue >= due ? cashValue - due : 0;
  useEffect(() => { dialog.current?.showModal(); cashInput.current?.focus(); }, []);
  useEffect(() => { if (sale) receiptLink.current?.focus(); }, [sale]);
  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    if (!Number.isSafeInteger(Number(cash)) || Number(cash) < due || Number(cash) > MAX_MONEY) {
      setError('Masukkan uang tunai yang cukup dalam rupiah bulat.'); return;
    }
    lock.current = true; setBusy(true); setError('');
    try { setSale(await onConfirm(Number(cash))); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); lock.current = false; }
  }
  const choices = [...new Set([due, 20000, 50000, 100000].filter((value) => value >= due))];
  return <dialog className="stock-dialog payment-dialog" ref={dialog} aria-labelledby="payment-title" onClose={onClose}>
    <h2 id="payment-title">{sale ? 'Pembayaran tersimpan' : 'Pembayaran tunai'}</h2>
    {sale ? <><p>{sale.invoiceNumber}</p><p>Total {formatIDR(sale.total)} · Kembalian {formatIDR(sale.payment.changeAmount)}</p><div className="row-actions"><Link ref={receiptLink} className="primary-button" href={`/transactions/${sale.id}/receipt`}>Buka struk untuk cetak</Link><button className="secondary-button" type="button" onClick={onClose}>Transaksi berikutnya</button></div></> : <form onSubmit={submit}>
      <div className="amount-due"><span>Jumlah dibayar</span><strong>{formatIDR(due)}</strong></div>
      {pending ? <p role="status">Pembayaran belum terkonfirmasi. Ulangi permintaan yang sama agar tidak tercatat dua kali.</p> : null}
      <label>Uang tunai diterima<input ref={cashInput} type="number" min={due} max={MAX_MONEY} step="1" value={cash} onChange={(event) => setCash(event.target.value)} disabled={busy || !!pending} required /></label>
      <div className="quick-cash">{choices.map((amount) => <button key={amount} type="button" className="secondary-button" disabled={busy || !!pending} onClick={() => setCash(amount)}>{amount === due ? 'Uang pas' : formatIDR(amount)}</button>)}</div>
      <p>Kembalian: <strong>{formatIDR(change)}</strong></p>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <div className="row-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Menyimpan pembayaran…' : pending ? 'Periksa / ulangi pembayaran' : 'Konfirmasi pembayaran'}</button><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>{pending ? 'Tutup (permintaan disimpan)' : 'Batal'}</button></div>
    </form>}
  </dialog>;
}
