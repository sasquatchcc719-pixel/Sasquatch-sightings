import { InvoiceDetail } from '@/components/admin/ops/invoice-detail'

type InvoiceDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function InvoiceDetailPage({
  params,
}: InvoiceDetailPageProps) {
  const { id } = await params
  return <InvoiceDetail invoiceId={id} />
}
