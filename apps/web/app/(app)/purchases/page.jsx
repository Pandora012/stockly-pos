'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Access } from '../../../components/access';
import { PageHeading } from '../../../components/catalog-ui';
import { PurchaseList } from '../../../components/purchase-list';

function Purchases() {
  const supplierId = useSearchParams().get('supplierId') ?? '';
  return <><PageHeading title="Pembelian" description="Draf, pemesanan, dan penerimaan stok penuh dari supplier." action={<Link className="primary-button" href="/purchases/new">Buat PO</Link>} />
    {supplierId ? <p>Difilter menurut supplier. <Link className="inline-button" href="/purchases">Tampilkan semua supplier</Link></p> : null}
    <section className="work-panel"><PurchaseList key={supplierId} supplierId={supplierId} /></section></>;
}

export default function PurchasesPage() { return <Access admin><Suspense fallback={<p role="status">Memuat pembelian…</p>}><Purchases /></Suspense></Access>; }
