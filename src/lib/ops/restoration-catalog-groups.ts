/**
 * Grouping for the manual line-item picker.
 *
 * Dictation is the fast path, but finding an item by hand has to stay good:
 * it is the fallback when the phrasing is unusual, when there is no signal, and
 * when Charles simply wants to browse what is available. Searching only works
 * if you already know the word to type, so the picker is grouped by the kind of
 * work instead of being a flat list of several hundred rows.
 */

export type CatalogGroup =
  | 'Extraction'
  | 'Carpet & pad'
  | 'Drywall, trim & insulation'
  | 'Equipment'
  | 'Treatment & cleanup'
  | 'Service calls & labor'
  | 'Containment & safety'
  | 'Other'

export const GROUP_ORDER: CatalogGroup[] = [
  'Extraction',
  'Carpet & pad',
  'Drywall, trim & insulation',
  'Treatment & cleanup',
  'Equipment',
  'Containment & safety',
  'Service calls & labor',
  'Other',
]

/**
 * Group from the Xactimate code stem first — codes are systematic, and the
 * abbreviated descriptions are not. Falls back to keywords in the description.
 */
export function groupForConcept(conceptCode: string, description: string): CatalogGroup {
  const code = conceptCode.toUpperCase()
  const text = description.toLowerCase()

  if (code.startsWith('EXTW')) return 'Extraction'
  if (code.startsWith('EXT')) return 'Extraction'

  if (
    code.startsWith('FCC') ||
    code.startsWith('PAD') ||
    code.startsWith('TACK') ||
    code.startsWith('LIFT') ||
    code.startsWith('HDRY')
  ) {
    return 'Carpet & pad'
  }

  if (
    code.startsWith('DRYW') ||
    code.startsWith('DRYN') ||
    code.startsWith('BASE') ||
    code.startsWith('INS') ||
    code.startsWith('ACT') ||
    code.startsWith('CAB') ||
    code.startsWith('TOE')
  ) {
    return 'Drywall, trim & insulation'
  }

  // Equipment is anything billed per 24-hour period, plus the heat-drying family.
  if (
    /per 24|per 24 hr|24 hour period/.test(text) ||
    code.startsWith('DHM') ||
    code === 'DRY' ||
    code.startsWith('DRY+') ||
    code.startsWith('DRY-') ||
    code.startsWith('HEAT') ||
    code.startsWith('HTAM') ||
    code.startsWith('FURN') ||
    code.startsWith('NAFAN') ||
    code.startsWith('WALL') ||
    code.startsWith('WFD') ||
    code.startsWith('RM')
  ) {
    return 'Equipment'
  }

  if (code.startsWith('GRM') || code.startsWith('MUCK') || /clean|anti-micro/.test(text)) {
    return 'Treatment & cleanup'
  }

  if (code.startsWith('BARR') || code.startsWith('PPE') || code.startsWith('MASK') || code.startsWith('HBAG')) {
    return 'Containment & safety'
  }

  if (code.startsWith('ESRV') || code.startsWith('EQ') || code === 'MN' || /labor|hourly|per hour/.test(text)) {
    return 'Service calls & labor'
  }

  return 'Other'
}
