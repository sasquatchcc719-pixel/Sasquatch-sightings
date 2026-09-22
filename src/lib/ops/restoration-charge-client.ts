export async function deleteRestorationChargeAndRefresh(
  url: string,
  refresh: () => Promise<void>,
): Promise<void> {
  const response = await fetch(url, { method: 'DELETE' })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(result.error || 'Could not remove this charge')
  }
  await refresh()
}
