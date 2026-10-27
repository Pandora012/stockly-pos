'use client';

export function PageHeading({ title, description, action }) {
  return <div className="page-heading heading-action"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

export function DataState({ status, retry, empty }) {
  if (status === 'loading') return <p role="status">Memuat data…</p>;
  if (status === 'error') return <div role="alert"><p>Data tidak dapat dimuat. Periksa koneksi lalu coba lagi.</p><button type="button" className="secondary-button" onClick={retry}>Coba lagi</button></div>;
  if (empty) return <p>Belum ada data untuk filter ini.</p>;
  return null;
}

export function Pagination({ page, pages, total, onChange }) {
  if (!total) return null;
  return <div className="pagination"><span>Halaman {page} dari {pages} · {total} hasil</span><div className="row-actions"><button type="button" className="secondary-button" disabled={page <= 1} onClick={() => onChange(page - 1)}>Sebelumnya</button><button type="button" className="secondary-button" disabled={page >= pages} onClick={() => onChange(page + 1)}>Berikutnya</button></div></div>;
}

export function StockLevel({ stock, minimumStock }) {
  return <span className={stock <= minimumStock ? 'stock-low' : ''}>{stock} {stock <= minimumStock ? '(rendah)' : ''}</span>;
}

export function formatIDR(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}
