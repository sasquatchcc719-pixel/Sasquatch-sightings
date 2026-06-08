const NON_DELIVERABLE_DOMAINS = new Set(['import.local'])

export function isDeliverableCustomerEmail(
  value: string | null | undefined,
): value is string {
  const email = String(value || '')
    .trim()
    .toLowerCase()
  const atIndex = email.lastIndexOf('@')
  if (atIndex <= 0 || atIndex === email.length - 1) return false

  return !NON_DELIVERABLE_DOMAINS.has(email.slice(atIndex + 1))
}
