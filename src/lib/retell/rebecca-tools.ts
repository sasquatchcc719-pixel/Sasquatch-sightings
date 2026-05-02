import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
  DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
  getAvailableSlots,
  timeToMinutes,
  type ExistingAppointmentWindow,
} from '@/lib/ops/availability'
import { createAiStyleBooking } from '@/lib/ops/create-ai-style-booking'
import { createAiStyleEstimate } from '@/lib/ops/create-ai-style-estimate'
import { opsPhoneLookupVariants } from '@/lib/ops/phone'
import { sendAdminSMS } from '@/lib/twilio'
import { sendTelegramNotification } from '@/lib/telegram'
import { REBECCA_RETELL_CONFIG } from '@/lib/retell/rebecca-config'
import { Resend } from 'resend'
import type {
  RebeccaAddressArgs,
  RebeccaCustomerArgs,
  RetellFunctionName,
  RetellFunctionResponse,
} from '@/lib/retell/rebecca-types'

type RebeccaToolContext = {
  supabase: SupabaseClient
  callId?: string
  callerPhone?: string
}

type BookingLineItemInput = {
  service_id?: string
  catalog_item_id?: string
  catalog_slug?: string
  service_name?: string
  quantity?: number
  square_feet?: number
  sqft?: number
}

type CatalogItem = {
  id: string
  name: string
  slug: string
  category: string
  base_price: number
  pricing_unit: string | null
  default_duration_minutes: number | null
}

type PreparedLineItem = {
  service_id: string
  service_name: string
  catalog_slug: string
  category: string
  pricing_unit: string
  quantity: number
  unit_price: number
  total: number
}

type PriorAppointmentRow = {
  id: string
  customer_id: string
  service_address_id: string
  appointment_date: string
  start_time: string
  end_time: string
  status: string
  quoted_total: number | null
  source: string | null
  lead_source: string | null
  ops_customers:
    | {
        id: string
        full_name: string | null
        first_name: string | null
        last_name: string | null
        email: string | null
        phone: string | null
      }
    | Array<{
        id: string
        full_name: string | null
        first_name: string | null
        last_name: string | null
        email: string | null
        phone: string | null
      }>
    | null
  ops_service_addresses:
    | {
        id: string
        street_1: string | null
        street_2: string | null
        city: string | null
        state: string | null
        zip_code: string | null
      }
    | Array<{
        id: string
        street_1: string | null
        street_2: string | null
        city: string | null
        state: string | null
        zip_code: string | null
      }>
    | null
  ops_appointment_line_items: Array<{
    name_snapshot: string | null
    quantity: number | null
    duration_minutes: number | null
    line_total: number | null
  }> | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

function numberArg(args: Record<string, unknown>, key: string): number | null {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function firstRelated<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function addMinutesToTime(value: string, minutesToAdd: number): string {
  const [hours, minutes] = value.split(':').map(Number)
  const total = (hours || 0) * 60 + (minutes || 0) + minutesToAdd
  const normalized = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(
    normalized % 60,
  ).padStart(2, '0')}:00`
}

function todayIsoDate(): string {
  return businessDateParts().iso
}

function daysAgoIsoDate(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function normalizeLookup(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function catalogSearchTerm(value: string): string {
  return value.replace(/[%,]/g, ' ').trim()
}

function businessDateParts(date = new Date()): {
  iso: string
  year: number
  month: number
  day: number
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value || ''
  const year = Number(value('year'))
  const month = Number(value('month'))
  const day = Number(value('day'))

  return {
    iso: `${String(year).padStart(4, '0')}-${String(month).padStart(
      2,
      '0',
    )}-${String(day).padStart(2, '0')}`,
    year,
    month,
    day,
  }
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false

  const [, year, month, day] = match
  const parsed = new Date(`${value}T12:00:00Z`)
  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day)
  )
}

function normalizeRequestedDate(value: string):
  | {
      ok: true
      date: string
      normalizedFrom?: string
    }
  | {
      ok: false
      message: string
    } {
  const today = businessDateParts()
  if (!isValidIsoDate(value)) {
    return {
      ok: false,
      message: `date must be a real date in YYYY-MM-DD format. Today's date is ${today.iso} in America/Denver. Ask the caller for the appointment date again if needed.`,
    }
  }

  const [, inputYear, inputMonth, inputDay] =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) || []
  let normalized = value

  if (Number(inputYear) < today.year) {
    const currentYearCandidate = `${today.year}-${inputMonth}-${inputDay}`
    normalized =
      currentYearCandidate >= today.iso
        ? currentYearCandidate
        : `${today.year + 1}-${inputMonth}-${inputDay}`
  }

  if (normalized < today.iso) {
    return {
      ok: false,
      message: `The requested appointment date ${value} is in the past. Today's date is ${today.iso} in America/Denver. Ask the caller for a future appointment date.`,
    }
  }

  return {
    ok: true,
    date: normalized,
    ...(normalized === value ? {} : { normalizedFrom: value }),
  }
}

function splitCustomerName(name: string): {
  firstName: string
  lastName: string
} {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] || '',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : 'Unknown',
  }
}

function normalizeSpokenEmail(value: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bzero\b/gi, '0'],
    [/\bone\b/gi, '1'],
    [/\btwo\b/gi, '2'],
    [/\bthree\b/gi, '3'],
    [/\bfour\b/gi, '4'],
    [/\bfive\b/gi, '5'],
    [/\bsix\b/gi, '6'],
    [/\bseven\b/gi, '7'],
    [/\beight\b/gi, '8'],
    [/\bnine\b/gi, '9'],
    [/\bat\b/gi, '@'],
    [/\bdot\b/gi, '.'],
  ]

  let normalized = value.trim().toLowerCase()
  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement)
  }

  return normalized
    .replace(/\s+@\s+/g, '@')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s+/g, '')
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return value.trim()
}

function appointmentLookbackDays(args: Record<string, unknown>): number {
  return Math.max(1, Math.min(numberArg(args, 'lookback_days') || 730, 1095))
}

function appointmentLookupStatuses(args: Record<string, unknown>): string[] {
  const status = stringArg(args, 'appointment_status')
  if (status && status !== 'completed') return [status]
  return ['completed', 'booked', 'confirmed']
}

function normalizeServiceCity(city: string, zipCode: string): string {
  const value = city.trim()
  const compact = value.toLowerCase().replace(/[^a-z]/g, '')
  if (zipCode === '80133' && ['palmerlake', 'pommellake'].includes(compact)) {
    return 'Palmer Lake'
  }
  return value
}

function parseAddressString(value: string): RebeccaAddressArgs {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const street1 = parts[0] || value.trim()
  const city = parts[1] || ''
  const stateZip = parts.slice(2).join(' ')
  const zipMatch = /\b(\d{5}(?:-\d{4})?)\b/.exec(stateZip)
  const stateMatch = /\b([A-Za-z]{2}|Colorado|Colo\.?)\b/i.exec(stateZip)
  const stateValue = stateMatch?.[1] || ''

  return {
    street_1: street1,
    city: normalizeServiceCity(city, zipMatch?.[1] || ''),
    state: /^co(?:lorado|lo\.?)?$/i.test(stateValue)
      ? 'CO'
      : stateValue.toUpperCase() || 'CO',
    zip_code: zipMatch?.[1] || '',
  }
}

function positiveIntegerArg(
  args: Record<string, unknown>,
  keys: string[],
): number {
  for (const key of keys) {
    const value = numberArg(args, key)
    if (value && value > 0) return Math.floor(value)
  }
  return 0
}

const RABECCA_BOOKABLE_CATEGORIES = [
  'Carpet Cleaning',
  'Legendary Restoration Clean',
  'Upholstery Cleaning',
  'rug cleaning',
  'Hard Surface',
  'Carpet Deodorizer',
  'Checkout Upsells',
]

const RABECCA_BLOCKED_CATALOG_SLUGS = new Set([
  'card-fee',
  'commercial-carpet-cleaning',
  'commercial-deodorizer-per-sqft',
  'custom-amount',
  'discount',
  'gratuity',
  'low-moisture-encapsulation-cleaning-lvm-bonnet',
  'mileage-travel',
])

function isRabeccaBookableCatalogItem(
  item: Pick<CatalogItem, 'category' | 'slug'>,
) {
  return (
    RABECCA_BOOKABLE_CATEGORIES.includes(item.category) &&
    !RABECCA_BLOCKED_CATALOG_SLUGS.has(item.slug)
  )
}

async function loadRabeccaBookableCatalog(
  supabase: SupabaseClient,
): Promise<CatalogItem[]> {
  const { data, error } = await supabase
    .from('service_catalog_items')
    .select(
      'id, name, slug, category, base_price, pricing_unit, default_duration_minutes',
    )
    .eq('is_active', true)
    .in('category', RABECCA_BOOKABLE_CATEGORIES)

  if (error) throw error
  return ((data || []) as CatalogItem[]).filter(isRabeccaBookableCatalogItem)
}

function catalogBySlug(
  catalog: CatalogItem[],
  slug: string,
): CatalogItem | null {
  return catalog.find((item) => item.slug === slug) || null
}

function catalogByName(
  catalog: CatalogItem[],
  includes: string[],
  excludes: string[] = [],
): CatalogItem | null {
  return (
    catalog.find((item) => {
      const name = item.name.toLowerCase()
      return (
        includes.every((term) => name.includes(term)) &&
        excludes.every((term) => !name.includes(term))
      )
    }) || null
  )
}

function catalogBySlugOrName(
  catalog: CatalogItem[],
  input: BookingLineItemInput,
): CatalogItem | null {
  const id = input.service_id || input.catalog_item_id
  if (id) return catalog.find((item) => item.id === id) || null
  if (input.catalog_slug) return catalogBySlug(catalog, input.catalog_slug)
  if (!input.service_name) return null
  const normalized = normalizeLookup(input.service_name)
  return (
    catalog.find(
      (item) =>
        normalizeLookup(item.name) === normalized ||
        normalizeLookup(item.slug) === normalized,
    ) || null
  )
}

function quantityForCatalogLine(
  catalogItem: CatalogItem,
  requestedQuantity: number,
): number {
  const pricingUnit = String(catalogItem.pricing_unit || '').toLowerCase()
  if (pricingUnit.includes('sq')) {
    return Math.max(1, Math.round(requestedQuantity))
  }
  return Math.max(1, Math.round(requestedQuantity))
}

function addPreparedLineItem(
  items: PreparedLineItem[],
  catalogItem: CatalogItem | null,
  quantity: number,
) {
  if (!catalogItem || quantity <= 0) return
  if (!isRabeccaBookableCatalogItem(catalogItem)) return
  const unitPrice = Number(catalogItem.base_price || 0)
  const normalizedQuantity = quantityForCatalogLine(catalogItem, quantity)
  items.push({
    service_id: catalogItem.id,
    service_name: catalogItem.name,
    catalog_slug: catalogItem.slug,
    category: catalogItem.category,
    pricing_unit: catalogItem.pricing_unit || 'fixed',
    quantity: normalizedQuantity,
    unit_price: unitPrice,
    total: unitPrice * normalizedQuantity,
  })
}

function roomSlugForSquareFeet(squareFeet: number): string {
  if (squareFeet > 800) return 'oversized-room-carpet-cleaning-800-plus-sqft'
  if (squareFeet >= 600) return 'jumbo-humungous-room-600-to800-sqft'
  if (squareFeet >= 400) return 'monster-size-room-400-to-600-sqft'
  if (squareFeet >= 200) return 'sasquatch-size-room-200-to-400-sqft'
  return 'regular-size-room-100-to-200-sqft'
}

function legendarySlugForSquareFeet(squareFeet: number): string {
  if (squareFeet >= 600) return 'legendary-jumbo'
  if (squareFeet >= 400) return 'legendary-monster'
  if (squareFeet >= 200) return 'legendary-sasquatch'
  if (squareFeet >= 100) return 'legendary-regular'
  return 'legendary-hall'
}

function numberArgFromKeys(
  args: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = numberArg(args, key)
    if (value && value > 0) return value
  }
  return null
}

function addPreparedLineItemsFromRawInputs(
  items: PreparedLineItem[],
  catalog: CatalogItem[],
  rawItems: unknown,
) {
  if (!Array.isArray(rawItems)) return
  for (const rawItem of rawItems) {
    const input = asRecord(rawItem) as BookingLineItemInput
    const catalogItem = catalogBySlugOrName(catalog, input)
    const quantity =
      numberArg(input as Record<string, unknown>, 'square_feet') ||
      numberArg(input as Record<string, unknown>, 'sqft') ||
      numberArg(input as Record<string, unknown>, 'quantity') ||
      1
    addPreparedLineItem(items, catalogItem, quantity)
  }
}

async function prepareResidentialBookingQuote(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<
  | {
      ok: true
      appointmentDate: string | null
      lineItems: PreparedLineItem[]
      subtotal: number
      minimum: number
      meetsMinimum: boolean
      slots: Array<{ start_time: string; end_time: string }>
      missingFields: string[]
    }
  | { ok: false; message: string }
> {
  const catalog = await loadRabeccaBookableCatalog(context.supabase)
  const lineItems: PreparedLineItem[] = []
  const regularRoom = catalogBySlug(
    catalog,
    'regular-size-room-100-to-200-sqft',
  )
  const hall = catalogBySlug(
    catalog,
    'hall-bathroom-closet-carpet-cleaning-30-to-100-sqft',
  )
  const steps = catalogBySlug(catalog, 'step-carpet-cleaning-per-step-charge')
  const sofa = catalogByName(catalog, ['sofa'], ['leather', 'sectional'])
  const loveseat = catalogByName(catalog, ['love'], ['leather'])
  const recliner = catalogByName(catalog, ['recliner'], ['leather'])
  const sectional = catalogByName(catalog, ['sectional'], ['leather'])
  const leatherChair = catalogBySlug(catalog, 'leather-cleaning-chair')
  const leatherLoveseat = catalogBySlug(catalog, 'leather-cleaning-love-seat')
  const leatherSofa = catalogBySlug(catalog, 'leather-cleaning-sofa')
  const leatherSectional = catalogBySlug(catalog, 'sectional-leather')

  const bedrooms = positiveIntegerArg(args, [
    'bedrooms_count',
    'bedroom_count',
    'regular_room_count',
    'rooms_count',
  ])
  const halls = positiveIntegerArg(args, [
    'hall_count',
    'hallway_count',
    'bathroom_count',
    'closet_count',
  ])
  const stepCount = positiveIntegerArg(args, ['stairs_count', 'step_count'])
  const livingRoomSquareFeet = numberArg(args, 'living_room_sqft')
  const couchCount = positiveIntegerArg(args, [
    'couch_count',
    'sofa_count',
    'three_seat_sofa_count',
  ])
  const loveseatCount = positiveIntegerArg(args, ['loveseat_count'])
  const reclinerCount = positiveIntegerArg(args, ['recliner_count'])
  const sectionalSeats = positiveIntegerArg(args, [
    'sectional_seat_count',
    'sectional_seats',
  ])
  const leatherChairCount = positiveIntegerArg(args, ['leather_chair_count'])
  const leatherLoveseatCount = positiveIntegerArg(args, [
    'leather_loveseat_count',
  ])
  const leatherSofaCount = positiveIntegerArg(args, ['leather_sofa_count'])
  const leatherSectionalSeats = positiveIntegerArg(args, [
    'leather_sectional_seat_count',
    'leather_sectional_seats',
  ])
  const diningChairCount = positiveIntegerArg(args, ['dining_chair_count'])
  const ottomanCount = positiveIntegerArg(args, ['ottoman_count'])
  const mattressCount = positiveIntegerArg(args, ['mattress_count'])
  const tileGroutSquareFeet = numberArgFromKeys(args, [
    'tile_grout_sqft',
    'tile_sqft',
    'grout_sqft',
    'hard_surface_sqft',
  ])
  const customRugSquareFeet = numberArgFromKeys(args, [
    'rug_sqft',
    'area_rug_sqft',
    'custom_rug_sqft',
  ])
  const legendaryRooms = positiveIntegerArg(args, [
    'legendary_regular_room_count',
    'deep_clean_regular_room_count',
  ])
  const legendaryHallCount = positiveIntegerArg(args, [
    'legendary_hall_count',
    'deep_clean_hall_count',
  ])
  const legendaryStepCount = positiveIntegerArg(args, [
    'legendary_stairs_count',
    'legendary_step_count',
    'deep_clean_step_count',
  ])
  const legendarySquareFeet = numberArgFromKeys(args, [
    'legendary_room_sqft',
    'deep_clean_room_sqft',
  ])
  const generalDeodorizerRooms = positiveIntegerArg(args, [
    'deodorizer_room_count',
    'general_deodorizer_room_count',
  ])
  const urineTreatmentRooms = positiveIntegerArg(args, [
    'urine_treatment_room_count',
    'pet_treatment_room_count',
  ])
  const preVacuumingRooms = positiveIntegerArg(args, [
    'pre_vacuuming_room_count',
  ])

  addPreparedLineItemsFromRawInputs(lineItems, catalog, args.line_items)
  addPreparedLineItem(lineItems, regularRoom, bedrooms)
  addPreparedLineItem(lineItems, hall, halls)
  addPreparedLineItem(lineItems, steps, stepCount)
  addPreparedLineItem(lineItems, sofa, couchCount)
  addPreparedLineItem(lineItems, loveseat, loveseatCount)
  addPreparedLineItem(lineItems, recliner, reclinerCount)
  addPreparedLineItem(lineItems, sectional, sectionalSeats)
  addPreparedLineItem(lineItems, leatherChair, leatherChairCount)
  addPreparedLineItem(lineItems, leatherLoveseat, leatherLoveseatCount)
  addPreparedLineItem(lineItems, leatherSofa, leatherSofaCount)
  addPreparedLineItem(lineItems, leatherSectional, leatherSectionalSeats)
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'dining-chair'),
    diningChairCount,
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'ottoman'),
    ottomanCount,
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'mattress-cleaning'),
    mattressCount,
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(
      catalog,
      'tile-grout-cleaning-per-foot-pre-scrub-and-clean-with-hydroforce',
    ),
    tileGroutSquareFeet || 0,
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'rug-cleaning-per-foot'),
    customRugSquareFeet || 0,
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'rug-3x5'),
    positiveIntegerArg(args, ['rug_3x5_count']),
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'runner-2-5x8'),
    positiveIntegerArg(args, ['runner_2_5x8_count', 'runner_rug_count']),
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'rug-4x6-wool-or-polyester'),
    positiveIntegerArg(args, ['rug_4x6_count']),
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'rug-5x6'),
    positiveIntegerArg(args, ['rug_5x6_count']),
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'area-rug-8x5'),
    positiveIntegerArg(args, ['rug_5x8_count', 'area_rug_5x8_count']),
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'rug-8x11wool-or-polyester'),
    positiveIntegerArg(args, ['rug_8x11_count']),
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'rug-11x14'),
    positiveIntegerArg(args, ['rug_11x14_count']),
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'legendary-regular'),
    legendaryRooms,
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'legendary-hall'),
    legendaryHallCount,
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'legendary-step'),
    legendaryStepCount,
  )
  if (legendarySquareFeet && legendarySquareFeet > 0) {
    addPreparedLineItem(
      lineItems,
      catalogBySlug(catalog, legendarySlugForSquareFeet(legendarySquareFeet)),
      legendarySquareFeet > 800 ? legendarySquareFeet : 1,
    )
  }
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'general-deodorizer-per-room-not-for-urine'),
    generalDeodorizerRooms,
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'pet-urine-injection-treatment-with-bio-release'),
    urineTreatmentRooms,
  )
  addPreparedLineItem(
    lineItems,
    catalogBySlug(catalog, 'pre-vacuuming'),
    preVacuumingRooms,
  )

  if (livingRoomSquareFeet && livingRoomSquareFeet > 0) {
    addPreparedLineItem(
      lineItems,
      catalogBySlug(catalog, roomSlugForSquareFeet(livingRoomSquareFeet)),
      livingRoomSquareFeet > 800 ? livingRoomSquareFeet : 1,
    )
  }

  const requestedDate =
    stringArg(args, 'requested_date') || stringArg(args, 'appointment_date')
  let appointmentDate: string | null = null
  if (requestedDate) {
    const normalizedDate = normalizeRequestedDate(requestedDate)
    if (!normalizedDate.ok) return normalizedDate
    appointmentDate = normalizedDate.date
  }

  if (lineItems.length === 0) {
    return {
      ok: false,
      message:
        'I need at least one bookable service, like bedrooms_count, living_room_sqft, tile_grout_sqft, rug_sqft, couch_count, legendary_room_sqft, or line_items.',
    }
  }

  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0)
  const minimum = 150
  const missingFields = []
  if (!appointmentDate) missingFields.push('appointment date')

  let slots: Array<{ start_time: string; end_time: string }> = []
  if (appointmentDate && subtotal >= minimum) {
    const bundle = await loadAvailabilityBundle(
      context.supabase,
      appointmentDate,
    )
    slots = getAvailableSlots({
      date: appointmentDate,
      requiredMinutes: applyAppointmentBuffer(
        calculateAppointmentDurationFromTotal(subtotal),
      ),
      templates: bundle.templates,
      overrides: bundle.overrides,
      appointments: bundle.appointments,
      maxResults: 3,
    })
  }

  return {
    ok: true,
    appointmentDate,
    lineItems,
    subtotal,
    minimum,
    meetsMinimum: subtotal >= minimum,
    slots,
    missingFields,
  }
}

function response(
  success: boolean,
  message: string,
  data?: unknown,
): RetellFunctionResponse {
  return { success, message, ...(data === undefined ? {} : { data }) }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function contactLine(label: string, value: string): string {
  return `${label}: ${value || 'Not provided'}`
}

function nonPlaceholderContact(value: string): string {
  const normalized = value.trim()
  if (!normalized) return ''
  if (/^\[.*\]$/.test(normalized)) return ''
  if (/your\s+(phone|email|name|address)/i.test(normalized)) return ''
  if (/not\s+provided/i.test(normalized)) return ''
  return normalized
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

async function loadAvailabilityBundle(
  supabase: SupabaseClient,
  date: string,
): Promise<{
  templates: Parameters<typeof getAvailableSlots>[0]['templates']
  overrides: Parameters<typeof getAvailableSlots>[0]['overrides']
  appointments: ExistingAppointmentWindow[]
}> {
  const [templatesResult, overridesResult, appointmentsResult] =
    await Promise.all([
      supabase.from('availability_templates').select('*').eq('is_active', true),
      supabase
        .from('availability_overrides')
        .select('*')
        .eq('override_date', date),
      supabase
        .from('ops_appointments')
        .select('appointment_date, start_time, end_time, status')
        .eq('appointment_date', date),
    ])

  if (templatesResult.error) throw templatesResult.error
  if (overridesResult.error) throw overridesResult.error
  if (appointmentsResult.error) throw appointmentsResult.error

  return {
    templates:
      templatesResult.data && templatesResult.data.length > 0
        ? templatesResult.data
        : DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
    overrides: overridesResult.data || [],
    appointments: (appointmentsResult.data ||
      []) as ExistingAppointmentWindow[],
  }
}

async function quoteAndPrepareBooking(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const prepared = await prepareResidentialBookingQuote(args, context)
  if (!prepared.ok) return response(false, prepared.message)

  const dollars = prepared.subtotal.toFixed(2).replace(/\.00$/, '')
  if (!prepared.meetsMinimum) {
    const amountNeeded = prepared.minimum - prepared.subtotal
    const amountNeededDollars = amountNeeded.toFixed(2).replace(/\.00$/, '')
    return response(true, `Estimated total is $${dollars}.`, {
      quote_total: prepared.subtotal,
      minimum_booking_amount: prepared.minimum,
      amount_needed_to_minimum: amountNeeded,
      meets_minimum: false,
      can_offer_slots: false,
      line_items: prepared.lineItems,
      missing_fields: prepared.missingFields,
      caller_script: `The updated estimate is $${dollars}. That is $${amountNeededDollars} below our $${prepared.minimum} minimum, so I cannot check appointment availability or finalize a booking yet. Would you like to add another area, stairs, deodorizer, or another service to meet the minimum?`,
    })
  }

  return response(true, `Estimated total is $${dollars}.`, {
    quote_total: prepared.subtotal,
    minimum_booking_amount: prepared.minimum,
    meets_minimum: true,
    can_offer_slots: prepared.slots.length > 0,
    appointment_date: prepared.appointmentDate,
    line_items: prepared.lineItems,
    missing_fields: prepared.missingFields,
    slots: prepared.slots,
    caller_script:
      prepared.slots.length > 0
        ? `The estimate is $${dollars}. I found these available windows: ${prepared.slots
            .map((slot) => `${slot.start_time} to ${slot.end_time}`)
            .join(', ')}. Which one works best?`
        : `The estimate is $${dollars}, but I do not see any available openings for that date. Ask if they want another day.`,
  })
}

async function bookPreparedSlot(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const prepared = await prepareResidentialBookingQuote(args, context)
  if (!prepared.ok) return response(false, prepared.message)
  if (!prepared.meetsMinimum) {
    return response(
      false,
      `Booking was NOT created: this job totals $${prepared.subtotal.toFixed(
        2,
      )}, below the $${prepared.minimum} minimum. Do not say the caller is booked. Ask if they want to add another service.`,
      {
        quote_total: prepared.subtotal,
        minimum_booking_amount: prepared.minimum,
        line_items: prepared.lineItems,
      },
    )
  }

  const appointmentDate = prepared.appointmentDate
  const startTime =
    stringArg(args, 'selected_start_time') || stringArg(args, 'start_time')
  const customer = customerArgs(args)
  const address = addressArgs(args)
  const missingFields = [
    !appointmentDate ? 'appointment date' : '',
    !startTime ? 'selected start time' : '',
    !customer.first_name || !customer.last_name ? 'customer full name' : '',
    !customer.email ? 'customer email' : '',
    !customer.phone && !context.callerPhone ? 'customer phone' : '',
    !address.street_1 ? 'street address' : '',
    !address.city ? 'city' : '',
    !address.zip_code ? 'zip code' : '',
  ].filter(Boolean)

  if (missingFields.length > 0 || !appointmentDate) {
    return response(
      false,
      'Booking was NOT created: missing required fields.',
      {
        missing_fields: missingFields,
        normalized_customer: customer,
        normalized_address: address,
        caller_script: `I still need ${missingFields.join(
          ', ',
        )} before I can book that.`,
      },
    )
  }

  const result = await createAiStyleBooking({
    supabase: context.supabase,
    customer: {
      ...customer,
      phone: customer.phone || context.callerPhone || '',
    },
    address,
    appointment_date: appointmentDate,
    start_time: startTime,
    line_items: prepared.lineItems.map((item) => ({
      service_id: item.service_id,
      quantity: item.quantity,
    })),
    booking_mode: 'direct',
    booking_channel: REBECCA_RETELL_CONFIG.bookingChannel,
    source_label: REBECCA_RETELL_CONFIG.sourceLabel,
    lead_source: 'retell_rabecca',
    actor_label: REBECCA_RETELL_CONFIG.actorLabel,
    admin_heading: REBECCA_RETELL_CONFIG.adminHeading,
  })

  if (!result.ok) {
    return response(false, `Booking was NOT created: ${result.error}`, {
      quote_total: prepared.subtotal,
      line_items: prepared.lineItems,
      normalized_customer: {
        ...customer,
        phone: customer.phone || context.callerPhone || '',
      },
      normalized_address: address,
      caller_script: `I could not finalize that booking: ${result.error}`,
    })
  }

  const serviceSummary = prepared.lineItems
    .map((item) => `${item.quantity} ${item.service_name}`)
    .join(', ')

  return response(true, result.message, {
    ...result,
    quote_total: prepared.subtotal,
    line_items: prepared.lineItems,
    normalized_customer: {
      ...customer,
      phone: customer.phone || context.callerPhone || '',
    },
    normalized_address: address,
    caller_script: `You're all set for ${result.appointment_date} at ${result.start_time}. Services: ${serviceSummary}. Total: $${prepared.subtotal}. You'll receive confirmation with the details.`,
  })
}

async function getServiceCatalog(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const category = stringArg(args, 'category')
  const term = catalogSearchTerm(category)

  let query = context.supabase
    .from('service_catalog_items')
    .select(
      'id, name, slug, category, description, base_price, pricing_unit, default_duration_minutes, sort_order',
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true, nullsFirst: false })

  if (term) {
    query = query.or(
      `category.ilike.%${term}%,name.ilike.%${term}%,slug.ilike.%${term}%`,
    )
  }

  const { data, error } = await query
  if (error) throw error

  return response(true, 'Loaded active service catalog.', {
    services: ((data || []) as CatalogItem[]).filter(
      isRabeccaBookableCatalogItem,
    ),
  })
}

async function getCalendarSlots(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const requestedDate = stringArg(args, 'date')
  const normalizedDate = normalizeRequestedDate(requestedDate)
  if (!normalizedDate.ok) return response(false, normalizedDate.message)
  const date = normalizedDate.date

  const durationMinutes = numberArg(args, 'duration_minutes')
  const totalDollars = numberArg(args, 'total_dollars')
  const requiredMinutes =
    durationMinutes && durationMinutes > 0
      ? durationMinutes
      : calculateAppointmentDurationFromTotal(totalDollars || 0)

  const bundle = await loadAvailabilityBundle(context.supabase, date)
  const slots = getAvailableSlots({
    date,
    requiredMinutes: applyAppointmentBuffer(requiredMinutes),
    templates: bundle.templates,
    overrides: bundle.overrides,
    appointments: bundle.appointments,
    maxResults: 8,
  })

  return response(true, `Found ${slots.length} available slots.`, {
    date,
    ...(normalizedDate.normalizedFrom
      ? { normalized_from_date: normalizedDate.normalizedFrom }
      : {}),
    required_minutes: applyAppointmentBuffer(requiredMinutes),
    slots,
  })
}

async function findRecentCompletedAppointments(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<PriorAppointmentRow[]> {
  const orderNumber =
    stringArg(args, 'order_number') ||
    stringArg(args, 'invoice_number') ||
    stringArg(args, 'appointment_number')
  if (orderNumber) {
    const invoiceNumber = Number(orderNumber.replace(/\D/g, ''))
    if (Number.isFinite(invoiceNumber) && invoiceNumber > 0) {
      const { data: invoiceRows, error: invoiceError } = await context.supabase
        .from('ops_invoices')
        .select('appointment_id')
        .eq('invoice_number', invoiceNumber)
        .limit(1)

      if (invoiceError) throw invoiceError
      const appointmentId = invoiceRows?.[0]?.appointment_id
      if (appointmentId) {
        const appointment = await findCompletedAppointmentById(
          context.supabase,
          appointmentId,
          args,
        )
        if (appointment) return [appointment]
      }
    }
  }

  const lookupPhone =
    stringArg(args, 'lookup_phone') ||
    stringArg(asRecord(args.customer), 'phone') ||
    context.callerPhone ||
    ''
  const variants = opsPhoneLookupVariants(lookupPhone)

  if (variants.length === 0) {
    return findCompletedAppointmentsByContactDetails(args, context)
  }

  const { data: customers, error: customerError } = await context.supabase
    .from('ops_customers')
    .select('id')
    .in('phone', variants)
    .limit(10)

  if (customerError) throw customerError
  const customerIds = (customers || []).map((customer) => customer.id)
  if (customerIds.length === 0) {
    return findCompletedAppointmentsByContactDetails(args, context)
  }

  const lookbackDays = appointmentLookbackDays(args)
  const statuses = appointmentLookupStatuses(args)
  let query = context.supabase
    .from('ops_appointments')
    .select(
      `
      id,
      customer_id,
      service_address_id,
      appointment_date,
      start_time,
      end_time,
      status,
      quoted_total,
      source,
      lead_source,
      ops_customers!ops_appointments_customer_id_fkey (
        id,
        full_name,
        first_name,
        last_name,
        email,
        phone
      ),
      ops_service_addresses (
        id,
        street_1,
        street_2,
        city,
        state,
        zip_code
      ),
      ops_appointment_line_items (
        name_snapshot,
        quantity,
        duration_minutes,
        line_total
      )
    `,
    )
    .in('customer_id', customerIds)
    .in('status', statuses)
    .lte('appointment_date', todayIsoDate())
    .order('appointment_date', { ascending: false })
    .order('start_time', { ascending: false })
    .limit(5)

  const originalDate = originalServiceDateArg(args)
  query = originalDate
    ? query.eq('appointment_date', originalDate)
    : query.gte('appointment_date', daysAgoIsoDate(lookbackDays))

  const { data, error } = await query

  if (error) throw error
  const appointments = (data || []) as PriorAppointmentRow[]
  return appointments.length > 0
    ? appointments
    : findCompletedAppointmentsByContactDetails(args, context)
}

function originalServiceDateArg(args: Record<string, unknown>): string {
  const value =
    stringArg(args, 'original_service_date') ||
    stringArg(args, 'original_appointment_date') ||
    stringArg(args, 'prior_service_date')
  return isValidIsoDate(value) ? value : ''
}

function contactLookupArgs(args: Record<string, unknown>): {
  customerName: string
  customerEmail: string
  serviceAddress: string
} {
  const customer = asRecord(args.customer)
  return {
    customerName:
      stringArg(args, 'customer_name') ||
      stringArg(args, 'name') ||
      stringArg(customer, 'full_name') ||
      [stringArg(customer, 'first_name'), stringArg(customer, 'last_name')]
        .filter(Boolean)
        .join(' '),
    customerEmail:
      normalizeSpokenEmail(stringArg(args, 'customer_email')) ||
      normalizeSpokenEmail(stringArg(args, 'email')) ||
      normalizeSpokenEmail(stringArg(customer, 'email')),
    serviceAddress:
      stringArg(args, 'service_address') ||
      stringArg(args, 'address') ||
      stringArg(asRecord(args.address), 'street_1'),
  }
}

async function findCompletedAppointmentsByContactDetails(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<PriorAppointmentRow[]> {
  const { customerName, customerEmail, serviceAddress } =
    contactLookupArgs(args)
  const customerIds = new Set<string>()

  if (customerEmail) {
    const { data, error } = await context.supabase
      .from('ops_customers')
      .select('id')
      .ilike('email', customerEmail)
      .limit(10)
    if (error) throw error
    for (const customer of data || []) customerIds.add(customer.id)
  }

  if (customerName) {
    const compactName = customerName.replace(/[%,]/g, ' ').trim()
    const { data, error } = await context.supabase
      .from('ops_customers')
      .select('id')
      .ilike('full_name', `%${compactName}%`)
      .limit(10)
    if (error) throw error
    for (const customer of data || []) customerIds.add(customer.id)
  }

  const addressIds = new Set<string>()
  if (serviceAddress) {
    const parsedAddress = parseAddressString(serviceAddress)
    const street = (parsedAddress.street_1 || serviceAddress)
      .replace(/[%,]/g, ' ')
      .trim()
    const { data, error } = await context.supabase
      .from('ops_service_addresses')
      .select('id')
      .ilike('street_1', `%${street}%`)
      .limit(20)
    if (error) throw error
    for (const address of data || []) addressIds.add(address.id)
  }

  if (customerIds.size === 0 && addressIds.size === 0) return []

  const lookbackDays = appointmentLookbackDays(args)
  const statuses = appointmentLookupStatuses(args)
  let query = context.supabase
    .from('ops_appointments')
    .select(
      `
      id,
      customer_id,
      service_address_id,
      appointment_date,
      start_time,
      end_time,
      status,
      quoted_total,
      source,
      lead_source,
      ops_customers!ops_appointments_customer_id_fkey (
        id,
        full_name,
        first_name,
        last_name,
        email,
        phone
      ),
      ops_service_addresses (
        id,
        street_1,
        street_2,
        city,
        state,
        zip_code
      ),
      ops_appointment_line_items (
        name_snapshot,
        quantity,
        duration_minutes,
        line_total
      )
    `,
    )
    .in('status', statuses)
    .lte('appointment_date', todayIsoDate())
    .order('appointment_date', { ascending: false })
    .order('start_time', { ascending: false })
    .limit(10)

  if (customerIds.size > 0) {
    query = query.in('customer_id', Array.from(customerIds))
  } else {
    query = query.in('service_address_id', Array.from(addressIds))
  }

  const originalDate = originalServiceDateArg(args)
  query = originalDate
    ? query.eq('appointment_date', originalDate)
    : query.gte('appointment_date', daysAgoIsoDate(lookbackDays))

  const { data, error } = await query
  if (error) throw error

  const appointments = (data || []) as PriorAppointmentRow[]
  return addressIds.size > 0 && customerIds.size > 0
    ? appointments.filter((appointment) =>
        addressIds.has(appointment.service_address_id),
      )
    : appointments
}

async function findCompletedAppointmentById(
  supabase: SupabaseClient,
  appointmentId: string,
  args: Record<string, unknown>,
): Promise<PriorAppointmentRow | null> {
  const lookbackDays = appointmentLookbackDays(args)
  const statuses = appointmentLookupStatuses(args)
  let query = supabase
    .from('ops_appointments')
    .select(
      `
      id,
      customer_id,
      service_address_id,
      appointment_date,
      start_time,
      end_time,
      status,
      quoted_total,
      source,
      lead_source,
      ops_customers!ops_appointments_customer_id_fkey (
        id,
        full_name,
        first_name,
        last_name,
        email,
        phone
      ),
      ops_service_addresses (
        id,
        street_1,
        street_2,
        city,
        state,
        zip_code
      ),
      ops_appointment_line_items (
        name_snapshot,
        quantity,
        duration_minutes,
        line_total
      )
    `,
    )
    .eq('id', appointmentId)
    .in('status', statuses)
    .lte('appointment_date', todayIsoDate())

  const originalDate = originalServiceDateArg(args)
  query = originalDate
    ? query.eq('appointment_date', originalDate)
    : query.gte('appointment_date', daysAgoIsoDate(lookbackDays))

  const { data, error } = await query.maybeSingle()

  if (error) throw error
  return (data || null) as PriorAppointmentRow | null
}

function appointmentSummary(row: PriorAppointmentRow) {
  const customer = firstRelated(row.ops_customers)
  const address = firstRelated(row.ops_service_addresses)
  return {
    id: row.id,
    appointment_date: row.appointment_date,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    customer_name:
      customer?.full_name ||
      [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') ||
      null,
    customer_phone: customer?.phone || null,
    customer_email: customer?.email || null,
    address: address
      ? {
          id: address.id,
          street_1: address.street_1,
          street_2: address.street_2,
          city: address.city,
          state: address.state,
          zip_code: address.zip_code,
        }
      : null,
    services: (row.ops_appointment_line_items || []).map((item) => ({
      name: item.name_snapshot,
      quantity: item.quantity,
      duration_minutes: item.duration_minutes,
      line_total: item.line_total,
    })),
    quoted_total: row.quoted_total,
  }
}

async function listCallerAppointments(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const appointments = await findRecentCompletedAppointments(args, context)
  if (appointments.length === 0) {
    return response(
      false,
      'No prior appointment was found with the provided phone, email, name, address, order number, or original service date. Collect the customer name, callback phone, email, service address, order number if available, issue summary, and preferred reclean date/time before escalating.',
      { appointments: [] },
    )
  }

  const summaries = appointments.map(appointmentSummary)
  return response(
    true,
    `Found ${appointments.length} prior appointment${appointments.length === 1 ? '' : 's'}. Use the most recent one unless the caller corrects you.`,
    {
      recommended_appointment: summaries[0],
      appointments: summaries,
    },
  )
}

async function resolveBookingLineItems(
  supabase: SupabaseClient,
  rawItems: unknown,
): Promise<Array<{ service_id: string; quantity: number }> | null> {
  if (!Array.isArray(rawItems)) return null

  const inputs = rawItems.map((item) => asRecord(item) as BookingLineItemInput)
  const directIds = inputs
    .map((item) => item.service_id || item.catalog_item_id)
    .filter(Boolean) as string[]
  const slugs = inputs
    .filter((item) => !item.service_id && !item.catalog_item_id)
    .map((item) => item.catalog_slug)
    .filter(Boolean) as string[]
  const names = inputs
    .filter((item) => !item.service_id && !item.catalog_item_id)
    .map((item) => item.service_name)
    .filter(Boolean) as string[]

  let allowedDirectIds = new Set<string>()
  if (directIds.length > 0) {
    const { data, error } = await supabase
      .from('service_catalog_items')
      .select('id, slug, category')
      .in('id', directIds)
      .eq('is_active', true)
    if (error) throw error
    allowedDirectIds = new Set(
      (data || [])
        .filter(isRabeccaBookableCatalogItem)
        .map((row) => String(row.id)),
    )
  }

  let slugToId = new Map<string, string>()
  if (slugs.length > 0) {
    const { data, error } = await supabase
      .from('service_catalog_items')
      .select('id, slug, category')
      .in('slug', slugs)
      .eq('is_active', true)
    if (error) throw error
    slugToId = new Map(
      (data || [])
        .filter(isRabeccaBookableCatalogItem)
        .map((row) => [String(row.slug), row.id]),
    )
  }

  let nameToId = new Map<string, string>()
  if (names.length > 0) {
    const { data, error } = await supabase
      .from('service_catalog_items')
      .select('id, name, slug, category')
      .eq('is_active', true)
    if (error) throw error
    nameToId = new Map(
      (data || []).filter(isRabeccaBookableCatalogItem).flatMap((row) => [
        [normalizeLookup(String(row.name || '')), row.id],
        [normalizeLookup(String(row.slug || '')), row.id],
      ]),
    )
  }

  const resolved = inputs
    .map((item) => {
      const directId = item.service_id || item.catalog_item_id
      const serviceId =
        directId && allowedDirectIds.has(directId)
          ? directId
          : (item.catalog_slug ? slugToId.get(item.catalog_slug) : undefined) ||
            (item.service_name
              ? nameToId.get(normalizeLookup(item.service_name))
              : undefined)
      if (!serviceId) return null
      return {
        service_id: serviceId,
        quantity: Math.max(
          1,
          Math.round(
            Number(item.square_feet || item.sqft || item.quantity || 1),
          ),
        ),
      }
    })
    .filter(Boolean) as Array<{ service_id: string; quantity: number }>

  return resolved.length > 0 || directIds.length > 0 || names.length > 0
    ? resolved
    : null
}

async function validateRequestedSlotAvailable(
  supabase: SupabaseClient,
  params: {
    appointmentDate: string
    startTime: string
    lineItems: Array<{ service_id: string; quantity: number }>
  },
): Promise<{ ok: true } | { ok: false; message: string; slots: unknown[] }> {
  const normalizedDate = normalizeRequestedDate(params.appointmentDate)
  if (!normalizedDate.ok) {
    return { ok: false, message: normalizedDate.message, slots: [] }
  }
  const normalizedStart =
    params.startTime.length === 5 ? `${params.startTime}:00` : params.startTime
  const serviceIds = params.lineItems.map((item) => item.service_id)
  const { data, error } = await supabase
    .from('service_catalog_items')
    .select('id, slug, category, base_price')
    .in('id', serviceIds)
    .eq('is_active', true)

  if (error) throw error

  const catalogById = new Map(
    (data || [])
      .filter(isRabeccaBookableCatalogItem)
      .map((item) => [item.id, item]),
  )
  const subtotal = params.lineItems.reduce((sum, item) => {
    const catalogItem = catalogById.get(item.service_id)
    return sum + Number(catalogItem?.base_price || 0) * item.quantity
  }, 0)
  const requiredMinutes = applyAppointmentBuffer(
    calculateAppointmentDurationFromTotal(subtotal),
  )
  const bundle = await loadAvailabilityBundle(supabase, normalizedDate.date)
  const slots = getAvailableSlots({
    date: normalizedDate.date,
    requiredMinutes,
    templates: bundle.templates,
    overrides: bundle.overrides,
    appointments: bundle.appointments,
    maxResults: 8,
  })
  const requestedStartMinutes = timeToMinutes(normalizedStart)
  const requestedSlot = slots.find(
    (slot) => timeToMinutes(slot.start_time) === requestedStartMinutes,
  )

  if (requestedSlot) return { ok: true }

  return {
    ok: false,
    message:
      'That appointment time is no longer available. Offer one of the returned available slots instead and do not say the customer is booked.',
    slots,
  }
}

function customerArgs(args: Record<string, unknown>): RebeccaCustomerArgs {
  const customer = asRecord(args.customer)
  const fullName = stringArg(customer, 'name') || stringArg(args, 'name')
  const parsedName = splitCustomerName(fullName)
  const email = stringArg(customer, 'email') || stringArg(args, 'email')
  const phone = stringArg(customer, 'phone') || stringArg(args, 'phone')
  return {
    first_name:
      stringArg(customer, 'first_name') ||
      stringArg(args, 'first_name') ||
      parsedName.firstName,
    last_name:
      stringArg(customer, 'last_name') ||
      stringArg(args, 'last_name') ||
      parsedName.lastName,
    email: normalizeSpokenEmail(email),
    phone: normalizePhone(phone),
    business_name:
      stringArg(customer, 'business_name') ||
      stringArg(args, 'business_name') ||
      null,
  }
}

function addressArgs(args: Record<string, unknown>): RebeccaAddressArgs {
  if (typeof args.address === 'string') {
    return parseAddressString(args.address)
  }

  const address = asRecord(args.address)
  const zipCode = stringArg(address, 'zip_code') || stringArg(args, 'zip_code')
  const city = stringArg(address, 'city') || stringArg(args, 'city')
  return {
    street_1: stringArg(address, 'street_1') || stringArg(args, 'street_1'),
    city: normalizeServiceCity(city, zipCode),
    state: stringArg(address, 'state') || stringArg(args, 'state') || 'CO',
    zip_code: zipCode,
  }
}

async function createBooking(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const lineItems = await resolveBookingLineItems(
    context.supabase,
    args.line_items,
  )
  if (!lineItems) {
    return response(false, 'At least one valid line item is required.')
  }

  const requestedAppointmentDate = stringArg(args, 'appointment_date')
  const normalizedDate = normalizeRequestedDate(requestedAppointmentDate)
  if (!normalizedDate.ok) return response(false, normalizedDate.message)
  const appointmentDate = normalizedDate.date
  const startTime = stringArg(args, 'start_time')
  const slotCheck = await validateRequestedSlotAvailable(context.supabase, {
    appointmentDate,
    startTime,
    lineItems,
  })
  if (!slotCheck.ok) {
    return response(false, slotCheck.message, {
      appointment_date: appointmentDate,
      requested_start_time: startTime,
      available_slots: slotCheck.slots,
    })
  }

  const result = await createAiStyleBooking({
    supabase: context.supabase,
    customer: customerArgs(args),
    address: addressArgs(args),
    appointment_date: appointmentDate,
    start_time: startTime,
    line_items: lineItems,
    booking_mode: 'direct',
    booking_channel: REBECCA_RETELL_CONFIG.bookingChannel,
    source_label: REBECCA_RETELL_CONFIG.sourceLabel,
    lead_source: 'retell_rabecca',
    actor_label: REBECCA_RETELL_CONFIG.actorLabel,
    admin_heading: REBECCA_RETELL_CONFIG.adminHeading,
  })

  if (!result.ok) {
    return response(
      false,
      `Booking was NOT created: ${result.error}. Do not tell the caller they are booked. Resolve this issue or offer the returned next step.`,
    )
  }
  return response(true, result.message, result)
}

async function createEstimate(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const requestedAppointmentDate = stringArg(args, 'appointment_date')
  const normalizedDate = normalizeRequestedDate(requestedAppointmentDate)
  if (!normalizedDate.ok) return response(false, normalizedDate.message)

  const result = await createAiStyleEstimate({
    supabase: context.supabase,
    customer: customerArgs(args),
    address: addressArgs(args),
    appointment_date: normalizedDate.date,
    start_time: stringArg(args, 'start_time'),
    visit_duration_minutes: numberArg(args, 'visit_duration_minutes') || 60,
    job_description: stringArg(args, 'job_description') || null,
    booking_channel: REBECCA_RETELL_CONFIG.bookingChannel,
    source_label: REBECCA_RETELL_CONFIG.sourceLabel,
    actor_label: REBECCA_RETELL_CONFIG.actorLabel,
    admin_heading: REBECCA_RETELL_CONFIG.estimateAdminHeading,
  })

  if (!result.ok) return response(false, result.error, result)
  return response(true, result.message, result)
}

async function scheduleReclean(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const requestedAppointmentDate = stringArg(args, 'appointment_date')
  const normalizedDate = normalizeRequestedDate(requestedAppointmentDate)
  if (!normalizedDate.ok) return response(false, normalizedDate.message)
  const appointmentDate = normalizedDate.date
  const startTime = stringArg(args, 'start_time')
  const issueSummary =
    stringArg(args, 'issue_summary') ||
    stringArg(args, 'complaint_summary') ||
    'Customer requested a reclean for a prior completed job.'
  const durationMinutes = Math.max(
    120,
    Math.min(numberArg(args, 'duration_minutes') || 120, 240),
  )

  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) {
    return response(false, 'appointment_date is required in YYYY-MM-DD format.')
  }
  if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(startTime)) {
    return response(false, 'start_time is required in HH:MM format.')
  }

  const recentAppointments = await findRecentCompletedAppointments(
    args,
    context,
  )
  const requestedOriginalId = stringArg(args, 'original_appointment_id')
  const original =
    (requestedOriginalId
      ? recentAppointments.find(
          (appointment) => appointment.id === requestedOriginalId,
        )
      : recentAppointments[0]) || null

  if (!original) {
    return response(
      false,
      'No matching prior appointment was found for this caller. Do not schedule a reclean; notify admin instead.',
      { appointments: recentAppointments.map(appointmentSummary) },
    )
  }

  const bundle = await loadAvailabilityBundle(context.supabase, appointmentDate)
  const requiredMinutes = applyAppointmentBuffer(durationMinutes)
  const slots = getAvailableSlots({
    date: appointmentDate,
    requiredMinutes,
    templates: bundle.templates,
    overrides: bundle.overrides,
    appointments: bundle.appointments,
    maxResults: 8,
  })
  const normalizedStart = startTime.length === 5 ? `${startTime}:00` : startTime
  const requestedSlot = slots.find(
    (slot) => timeToMinutes(slot.start_time) === timeToMinutes(normalizedStart),
  )

  if (!requestedSlot) {
    return response(
      false,
      'That reclean time is not available. Offer one of the returned available slots instead and do not say the reclean is scheduled.',
      {
        appointment_date: appointmentDate,
        requested_start_time: startTime,
        available_slots: slots,
      },
    )
  }

  const customer = firstRelated(original.ops_customers)
  const address = firstRelated(original.ops_service_addresses)
  const customerName =
    customer?.full_name ||
    [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') ||
    'Customer'
  const internalNotes = [
    `Reclean / warranty redo scheduled by Rabecca voice AI.`,
    `Original appointment: ${original.id} on ${original.appointment_date} at ${original.start_time}.`,
    `Complaint summary: ${issueSummary}`,
    context.callId ? `Retell call ID: ${context.callId}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const { data: appointment, error: appointmentError } = await context.supabase
    .from('ops_appointments')
    .insert({
      customer_id: original.customer_id,
      service_address_id: original.service_address_id,
      booking_channel: REBECCA_RETELL_CONFIG.bookingChannel,
      source: `${REBECCA_RETELL_CONFIG.sourceLabel} - reclean`,
      lead_source: 'retell_rabecca_reclean',
      status: 'booked',
      payment_status: 'waived',
      quickbooks_sync_status: 'held',
      kind: 'service',
      appointment_date: appointmentDate,
      start_time: normalizedStart,
      end_time: addMinutesToTime(normalizedStart, requiredMinutes),
      quoted_total: 0,
      internal_notes: internalNotes,
    })
    .select('id, appointment_date, start_time, end_time')
    .single()

  if (appointmentError) throw appointmentError

  const { data: appointmentLine, error: lineError } = await context.supabase
    .from('ops_appointment_line_items')
    .insert({
      appointment_id: appointment.id,
      service_catalog_item_id: null,
      name_snapshot: 'Reclean / warranty redo',
      quantity: 1,
      unit_price: 0,
      duration_minutes: durationMinutes,
      buffer_minutes: 0,
      line_total: 0,
      notes: `Original appointment ${original.id}. ${issueSummary}`,
      pricing_unit_snapshot: 'fixed',
    })
    .select('id')
    .single()

  if (lineError) throw lineError

  const { data: invoice, error: invoiceError } = await context.supabase
    .from('ops_invoices')
    .insert({
      appointment_id: appointment.id,
      status: 'draft',
      payment_status: 'waived',
      subtotal: 0,
      discount_amount: 0,
      total: 0,
      sync_status: 'held',
    })
    .select('id')
    .single()

  if (invoiceError) throw invoiceError

  await Promise.all([
    context.supabase.from('ops_invoice_line_items').insert({
      invoice_id: invoice.id,
      appointment_line_item_id: appointmentLine.id,
      description: 'Reclean / warranty redo',
      quantity: 1,
      unit_price: 0,
      line_total: 0,
    }),
    context.supabase.from('ops_appointment_status_events').insert({
      appointment_id: appointment.id,
      from_status: null,
      to_status: 'booked',
      notes: `Reclean scheduled by ${REBECCA_RETELL_CONFIG.actorLabel}`,
    }),
    context.supabase.from('ops_invoice_status_events').insert({
      invoice_id: invoice.id,
      from_status: null,
      to_status: 'draft',
      notes: `Waived reclean invoice created by ${REBECCA_RETELL_CONFIG.actorLabel}`,
    }),
    sendAdminSMS(
      `Rabecca scheduled a reclean for ${customerName} on ${appointment.appointment_date} at ${appointment.start_time}. Original appointment: ${original.id}`,
      'retell_rabecca_reclean',
    ),
  ])

  return response(true, 'Reclean appointment scheduled.', {
    appointment_id: appointment.id,
    invoice_id: invoice.id,
    original_appointment_id: original.id,
    appointment_date: appointment.appointment_date,
    start_time: appointment.start_time,
    end_time: appointment.end_time,
    customer_name: customerName,
    address: address
      ? {
          street_1: address.street_1,
          city: address.city,
          state: address.state,
          zip_code: address.zip_code,
        }
      : null,
    total: 0,
    payment_status: 'waived',
  })
}

async function notifyAdmin(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const message = stringArg(args, 'message')
  if (!message) return response(false, 'message is required.')

  const reason = stringArg(args, 'reason')
  const customerName = nonPlaceholderContact(stringArg(args, 'customer_name'))
  const customerPhone =
    nonPlaceholderContact(stringArg(args, 'customer_phone')) ||
    context.callerPhone ||
    ''
  const customerEmail = nonPlaceholderContact(stringArg(args, 'customer_email'))
  const serviceAddress = nonPlaceholderContact(
    stringArg(args, 'service_address'),
  )
  const urgency = stringArg(args, 'urgency') || 'normal'
  const source = 'Rabecca voice AI'

  const details = [
    contactLine('Source', source),
    context.callId ? contactLine('Retell call ID', context.callId) : '',
    contactLine('Urgency', urgency),
    reason ? contactLine('Reason', reason) : '',
    contactLine('Customer', customerName),
    contactLine('Phone', customerPhone),
    contactLine('Email', customerEmail),
    contactLine('Address', serviceAddress),
    '',
    'Message:',
    message,
  ]
    .filter((line) => line !== '')
    .join('\n')

  const smsMessage = `${source}${context.callId ? ` (${context.callId})` : ''}: ${
    reason ? `${reason} - ` : ''
  }${message}${customerPhone ? `\nPhone: ${customerPhone}` : ''}`

  const emailSubject = `Rabecca Alert${urgency === 'urgent' ? ' URGENT' : ''}${
    reason ? `: ${reason.slice(0, 70)}` : ''
  }`
  const emailHtml = `
<h2>Rabecca voice AI alert</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin:12px 0;">
  <tr><td><strong>Source</strong></td><td>${escapeHtml(source)}</td></tr>
  ${
    context.callId
      ? `<tr><td><strong>Retell call ID</strong></td><td>${escapeHtml(context.callId)}</td></tr>`
      : ''
  }
  <tr><td><strong>Urgency</strong></td><td>${escapeHtml(urgency)}</td></tr>
  ${reason ? `<tr><td><strong>Reason</strong></td><td>${escapeHtml(reason)}</td></tr>` : ''}
  <tr><td><strong>Customer</strong></td><td>${escapeHtml(customerName || 'Not provided')}</td></tr>
  <tr><td><strong>Phone</strong></td><td>${escapeHtml(customerPhone || 'Not provided')}</td></tr>
  <tr><td><strong>Email</strong></td><td>${escapeHtml(customerEmail || 'Not provided')}</td></tr>
  <tr><td><strong>Address</strong></td><td>${escapeHtml(serviceAddress || 'Not provided')}</td></tr>
</table>
<h3>Message</h3>
<pre style="background:#f4f4f4;padding:12px;border-radius:4px;white-space:pre-wrap;">${escapeHtml(message)}</pre>
<p style="color:#666;font-size:12px;">Sent by Rabecca through the Retell voice intake flow.</p>`

  const resendKey = process.env.RESEND_API_KEY
  const toEmail = process.env.OWNER_ALERT_EMAIL || process.env.ADMIN_EMAIL
  const fromEmail =
    process.env.OPS_EMAIL_FROM || 'Sasquatch Alerts <onboarding@resend.dev>'

  const results = await Promise.allSettled([
    sendAdminSMS(smsMessage, 'retell_rabecca_alert'),
    (async () => {
      if (!resendKey || !toEmail) {
        console.warn(
          '[Rabecca] Email alert skipped: RESEND_API_KEY or OWNER_ALERT_EMAIL/ADMIN_EMAIL not set',
        )
        return false
      }
      const resend = new Resend(resendKey)
      const { error } = await resend.emails.send(
        {
          from: fromEmail,
          to: toEmail,
          subject: emailSubject,
          html: emailHtml,
        },
        {
          idempotencyKey: `rabecca-alert/${context.callId || 'no-call'}/${shortHash(
            details,
          )}`,
        },
      )
      if (error) {
        console.error('[Rabecca] Email alert error:', error)
        return false
      }
      return true
    })(),
    sendTelegramNotification(`RABECCA VOICE AI ALERT\n\n${details}`),
  ])

  return response(true, 'Admin notification sent.', {
    source,
    channels: {
      sms: results[0].status === 'fulfilled',
      email: results[1].status === 'fulfilled' ? results[1].value : false,
      telegram: results[2].status === 'fulfilled' ? results[2].value : false,
    },
  })
}

export async function executeRebeccaRetellTool(
  name: RetellFunctionName,
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  switch (name) {
    case 'quote_and_prepare_booking':
      return quoteAndPrepareBooking(args, context)
    case 'book_prepared_slot':
      return bookPreparedSlot(args, context)
    case 'get_service_catalog':
      return getServiceCatalog(args, context)
    case 'get_calendar_slots':
      return getCalendarSlots(args, context)
    case 'create_booking':
      return createBooking(args, context)
    case 'create_estimate':
      return createEstimate(args, context)
    case 'list_caller_appointments':
      return listCallerAppointments(args, context)
    case 'schedule_reclean':
      return scheduleReclean(args, context)
    case 'notify_admin':
      return notifyAdmin(args, context)
    default:
      return response(false, `Unsupported Rabecca tool: ${name}`)
  }
}
