'use client';

export default function ErrorPage({ reset }) {
  return <div className="notice" role="alert"><p>Halaman tidak dapat ditampilkan.</p><button className="secondary-button" type="button" onClick={reset}>Coba lagi</button></div>;
}
