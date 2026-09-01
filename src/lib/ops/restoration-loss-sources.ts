/**
 * Selecting a source pre-selects the category, because remembering that
 * groundwater is Category 3 at 2 a.m. is exactly the thing that gets missed.
 * Every one stays overridable.
 */
export const LOSS_SOURCES: Array<{
  value: string
  label: string
  category: 1 | 2 | 3
}> = [
  { value: 'supply_line', label: 'Supply line', category: 1 },
  { value: 'water_heater', label: 'Water heater', category: 1 },
  { value: 'toilet_supply', label: 'Toilet supply line', category: 1 },
  { value: 'sprinkler', label: 'Fire sprinkler', category: 1 },
  { value: 'hvac_condensate', label: 'HVAC condensate', category: 2 },
  { value: 'dishwasher', label: 'Dishwasher', category: 2 },
  { value: 'washing_machine', label: 'Washing machine', category: 2 },
  {
    value: 'toilet_overflow',
    label: 'Toilet overflow (no solids)',
    category: 2,
  },
  { value: 'roof', label: 'Roof / rain intrusion', category: 2 },
  { value: 'sewage_backup', label: 'Sewage backup', category: 3 },
  {
    value: 'exterior_groundwater',
    label: 'Exterior / groundwater',
    category: 3,
  },
  { value: 'other', label: 'Other', category: 1 },
]

export function lossSourceLabel(value: string | null): string {
  if (!value) return 'Not set'
  return LOSS_SOURCES.find((s) => s.value === value)?.label ?? value
}
