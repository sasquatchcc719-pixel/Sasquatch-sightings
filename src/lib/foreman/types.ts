/**
 * Foreman — field AI chemical assistant (Module 4).
 * Types shared by the inventory admin, spec scraper, and diagnostic endpoint.
 */

export const CHEMICAL_SCENARIOS = [
  'pet_urine',
  'traffic_lanes',
  'red_dye',
  'tannin',
  'browning',
  'tile_grout',
  'grease_oil',
  'general_prespray',
  'rinse',
  'deodorizer',
  'upholstery',
  'spot_removal',
] as const

export type ChemicalScenario = (typeof CHEMICAL_SCENARIOS)[number]

export type ChemicalProduct = {
  id: string
  name: string
  brand: string | null
  /** chemicals get dilution/pH specs; supplies/equipment are gear the assistant can reference */
  item_type: 'chemical' | 'supply' | 'equipment'
  in_stock: boolean
  /** product photo from the supplier page, for visual bottle matching */
  image_url: string | null
  quantity_on_hand: number | null
  quantity_unit: string
  reorder_threshold: number | null
  low_stock_alerted_at: string | null
  ph_range: string | null
  dilution_hydroforce: string | null
  dilution_pump_sprayer: string | null
  label_instructions: string | null
  sds_warnings: string | null
  scenarios: string[]
  incompatible_with: string[]
  source_urls: string[]
  scrape_status: 'pending' | 'scraped' | 'reviewed' | 'failed'
  scrape_error: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** What the web scraper extracts from label/SDS pages — all fields optional. */
export type ScrapedSpecs = {
  image_url: string | null
  ph_range: string | null
  dilution_hydroforce: string | null
  dilution_pump_sprayer: string | null
  label_instructions: string | null
  sds_warnings: string | null
  scenarios: string[]
  incompatible_with: string[]
  source_urls: string[]
}
