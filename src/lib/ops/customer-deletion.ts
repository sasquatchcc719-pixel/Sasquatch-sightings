export type CustomerDeletionCount = {
  key: string
  label: string
  count: number
}

export type CustomerDeletionPreview = {
  customer: {
    id: string
    label: string
    fullName: string
    phone: string
    email: string | null
    quickbooksCustomerId: string | null
  }
  blocking: CustomerDeletionCount[]
  removed: CustomerDeletionCount[]
  detached: CustomerDeletionCount[]
  canDelete: boolean
}

export function hasBlockingCustomerHistory(
  counts: CustomerDeletionCount[],
): boolean {
  return counts.some((item) => item.count > 0)
}

export function totalCustomerDeletionCount(
  counts: CustomerDeletionCount[],
): number {
  return counts.reduce((total, item) => total + item.count, 0)
}
