'use client';

import { useRouter } from 'next/navigation';
import { Access } from '../../../../components/access';
import { PageHeading } from '../../../../components/catalog-ui';
import { PurchaseBuilder } from '../../../../components/purchase-builder';

function NewPurchase() {
  const router = useRouter();
  return <><PageHeading title="Buat purchase order" description="Pilih supplier, produk, jumlah, dan biaya pembelian dalam rupiah." /><PurchaseBuilder onSaved={(purchase) => router.replace(`/purchases/${purchase.id}`)} /></>;
}

export default function NewPurchasePage() { return <Access admin><NewPurchase /></Access>; }
