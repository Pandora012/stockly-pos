'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { request } from '../../../../../lib/api';
import { Receipt } from '../../../../../components/receipt';
import { DataState } from '../../../../../components/catalog-ui';

export default function ReceiptPage({ params }) {
  const { id } = use(params);
  const [sale, setSale] = useState(null); const [status, setStatus] = useState('loading'); const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    request(`/api/sales/${id}/receipt`).then((data) => { if (active) { setSale(data.sale); setStatus('ready'); } })
      .catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [id, reload]);
  return <><div className="receipt-nav"><Link className="inline-button" href="/transactions">Kembali ke transaksi</Link><Link className="inline-button" href="/pos">Kembali ke kasir</Link></div><DataState status={status} retry={() => { setStatus('loading'); setReload((n) => n + 1); }} />{sale && status === 'ready' ? <Receipt sale={sale} /> : null}</>;
}
