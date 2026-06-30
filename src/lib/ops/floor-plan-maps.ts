/**
 * Annotated building-diagram images ("Area Maps") for recurring jobs, keyed by
 * recurring_template_id. The highlighted areas show what's cleaned on each visit.
 * Images live in /public/maps/. Currently built out for Recovery Village.
 *
 * Single source of truth — used by the tech portal (field crew), the admin recurring
 * visit detail, and the client portal. Add new buildings here only.
 */
export const FLOOR_PLAN_MAPS: Record<string, { file: string; label: string }> =
  {
    'c3ba2b05-b816-4fab-b9a7-35bff32f2451': {
      file: 'map_common_areas.jpg',
      label: 'Common Areas + Steps',
    },
    'd12374f9-3d2f-4711-8034-0346ff85f8cd': {
      file: 'map_kitchen.jpg',
      label: 'Kitchen & Pantry',
    },
    '0be48a79-d3bb-4e97-92e8-d29b90aaf9c5': {
      file: 'map_yoga_dining.jpg',
      label: 'Yoga / Dining / Family Room',
    },
    'c32f23a1-26bb-4997-be32-b0906b37a42d': {
      file: 'map_offices.jpg',
      label: 'Offices + Bears Den + Eagles Nest',
    },
    'f5b12000-6768-4854-bb7e-1606e699af57': {
      file: 'map_rec_fortitude.jpg',
      label: 'Rec Room + Fortitude',
    },
    '15531b8e-445b-46c3-83e5-5e7b7a119996': {
      file: 'map_pool.jpg',
      label: 'Pool Deck',
    },
    '4e7349a7-e74f-4f34-bca6-ed0fe1f2ab99': {
      file: 'map_c_building.jpg',
      label: 'C Building',
    },
    '7492bd31-9b72-4571-b7a1-b5c6222f2e67': {
      file: 'map_d_building.jpg',
      label: 'D Building',
    },
    '40a6c284-ecde-47ea-8f93-223898be88d8': {
      file: 'map_e_building.jpg',
      label: 'E Building',
    },
  }

/** Look up the Area Map for a recurring template, if one exists. */
export function getFloorPlanMap(
  templateId: string | null | undefined,
): { file: string; label: string } | null {
  if (!templateId) return null
  return FLOOR_PLAN_MAPS[templateId] ?? null
}
