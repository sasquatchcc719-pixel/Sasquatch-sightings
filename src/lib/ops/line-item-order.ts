type OrderedLine = {
  sort_order?: number | null
  created_at?: string | null
  id?: string | null
}

/** Persisted positions first; older/unpositioned rows keep a deterministic order. */
export function sortLineItems<T>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const left = a.item as OrderedLine
      const right = b.item as OrderedLine
      const leftPosition =
        typeof left.sort_order === 'number' && Number.isFinite(left.sort_order)
          ? left.sort_order
          : Infinity
      const rightPosition =
        typeof right.sort_order === 'number' &&
        Number.isFinite(right.sort_order)
          ? right.sort_order
          : Infinity
      if (leftPosition !== rightPosition) return leftPosition - rightPosition
      const created = String(left.created_at || '').localeCompare(
        String(right.created_at || ''),
      )
      if (created) return created
      const id = String(left.id || '').localeCompare(String(right.id || ''))
      return id || a.index - b.index
    })
    .map(({ item }) => item)
}
