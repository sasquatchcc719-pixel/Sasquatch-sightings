export function buildVenmoPaymentLink(params: {
  username: string
  invoiceNumber: number | string
  amount: number
  customerName: string
}): string {
  const note = encodeURIComponent(
    `Sasquatch Invoice #${String(params.invoiceNumber).trim()} - ${params.customerName}`,
  )
  return `https://venmo.com/${params.username}?txn=pay&amount=${params.amount.toFixed(2)}&note=${note}`
}
