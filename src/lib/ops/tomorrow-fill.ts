import { createAdminClient } from '@/supabase/server'
import { isBlacklisted } from '@/lib/blacklist'
import { loadCustomerValueIndex } from '@/lib/ops/business-health'
import { getAllStaffSlots } from '@/lib/ops/staff-availability'
import {
  answerTelegramCallback,
  clearTelegramActionButtons,
  sendTelegramActionMessage,
  sendTelegramNotification,
} from '@/lib/telegram'
import { sendCustomerSMSWithResult } from '@/lib/twilio'
import {
  addCalendarMonths,
  contactEligibility,
  normalizeFillPhone,
  normalizeFillZip,
  normalizeHouseholdKey,
  renderFillMessage,
  selectNonOverlappingOpenings,
  tomorrowFillWaveLimit,
  type FillContact,
  type FillOpening,
} from '@/lib/ops/tomorrow-fill-rules'

const ADMIN_BASE_URL = 'https://sightings.sasquatchcarpet.com'
const CUSTOMER_BASE_URL = `${ADMIN_BASE_URL}/fill`
const ACTIVE_APPOINTMENT_STATUSES = [
  'booked',
  'confirmed',
  'on_my_way',
  'in_progress',
]

type SupabaseAdmin = ReturnType<typeof createAdminClient>

export type TomorrowFillSettings = {
  engine_enabled: boolean
  send_enabled: boolean
  dormancy_months: number
  customer_cooldown_days: number
  unanswered_limit: number
  rest_days: number
  minimum_audience_size: number
  default_wave_size: number
  max_discounted_bookings: number
  offer_code: string
  offer_amount: number
  minimum_subtotal: number
  offer_valid_days: number
  message_template: string
}

type CustomerRow = {
  id: string
  full_name: string
  first_name: string | null
  phone: string
  is_internal: boolean | null
  is_commercial: boolean | null
  ops_service_addresses: AddressRow | AddressRow[] | null
}

type AddressRow = {
  id: string
  street_1: string
  city: string
  state: string
  zip_code: string
}

type AppointmentHistoryRow = {
  customer_id: string
  appointment_date: string
  service_address_id: string | null
  kind: string | null
  restoration_project_id: string | null
}

type RecipientHistoryRow = {
  customer_id: string
  sent_at: string | null
  replied_at: string | null
  booked_at: string | null
}

type Candidate = {
  customerId: string
  addressId: string
  phone: string
  zip: string
  street: string
  firstName: string
  fullName: string
  lastCleanDate: string
  lifetimeValue: number
  lastContactedAt: string | null
}

export type TomorrowFillScanResult = {
  skipped: boolean
  reason?: string
  campaignId?: string
  targetDate: string
  openMinutes: number
  selectedZips: string[]
  eligibleCount: number
  telegramSent: boolean
}

function mountainDate(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function endOfMountainDay(date: string, plusDays = 0) {
  const endDate = addDays(date, plusDays + 1)
  // Denver is never more than seven hours behind UTC. The exact instant is
  // deliberately generous; customer eligibility still uses the date itself.
  return `${endDate}T07:00:00.000Z`
}

function firstName(customer: CustomerRow) {
  return (
    customer.first_name ||
    customer.full_name.split(' ').filter(Boolean)[0] ||
    'there'
  )
}

function relationArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export async function loadTomorrowFillSettings(
  supabase: SupabaseAdmin = createAdminClient(),
): Promise<TomorrowFillSettings> {
  const { data, error } = await supabase
    .from('tomorrow_fill_settings')
    .select('*')
    .eq('id', true)
    .maybeSingle()
  if (error) throw error

  return {
    engine_enabled: data?.engine_enabled ?? true,
    send_enabled: data?.send_enabled ?? false,
    dormancy_months: Number(data?.dormancy_months ?? 8),
    customer_cooldown_days: Number(data?.customer_cooldown_days ?? 14),
    unanswered_limit: Number(data?.unanswered_limit ?? 4),
    rest_days: Number(data?.rest_days ?? 60),
    minimum_audience_size: Number(data?.minimum_audience_size ?? 5),
    default_wave_size: Number(data?.default_wave_size ?? 5),
    max_discounted_bookings: Number(data?.max_discounted_bookings ?? 2),
    offer_code: String(data?.offer_code || 'TF35'),
    offer_amount: Number(data?.offer_amount ?? 35),
    minimum_subtotal: Number(data?.minimum_subtotal ?? 250),
    offer_valid_days: Number(data?.offer_valid_days ?? 14),
    message_template: String(
      data?.message_template ||
        'Hi {{first_name}}, Sasquatch Carpet Cleaning has an opening in your area tomorrow. Save ${{offer_amount}} on a cleaning of ${{minimum_subtotal}} or more. See available times: {{booking_url}} Reply STOP to opt out.',
    ),
  }
}

async function loadTomorrowOpenings(
  supabase: SupabaseAdmin,
  targetDate: string,
) {
  const staffSlots = await getAllStaffSlots({
    supabase,
    date: targetDate,
    requiredMinutes: 120,
    maxResults: 12,
  })
  const all: FillOpening[] = staffSlots.flatMap((staff) =>
    staff.slots.map((slot) => ({
      staffUserId: staff.staffUserId,
      staffName: staff.staffName,
      startTime: slot.start_time,
      endTime: slot.end_time,
    })),
  )
  return selectNonOverlappingOpenings(all)
}

async function loadRouteZips(supabase: SupabaseAdmin, targetDate: string) {
  const { data, error } = await supabase
    .from('ops_appointments')
    .select(
      'id, status, kind, restoration_project_id, ops_service_addresses(zip_code)',
    )
    .eq('appointment_date', targetDate)
    .in('status', ACTIVE_APPOINTMENT_STATUSES)
  if (error) throw error

  return [
    ...new Set(
      (data || [])
        .filter(
          (row) => row.kind !== 'restoration' && !row.restoration_project_id,
        )
        .flatMap((row) => relationArray(row.ops_service_addresses))
        .map((address) => normalizeFillZip(address.zip_code))
        .filter((zip): zip is string => Boolean(zip)),
    ),
  ].sort()
}

async function loadCandidates(params: {
  supabase: SupabaseAdmin
  settings: TomorrowFillSettings
  targetDate: string
  selectedZips: string[]
}) {
  const { supabase, settings, targetDate, selectedZips } = params
  const today = mountainDate()
  const [
    customersResult,
    appointmentHistoryResult,
    pastUnresolvedAppointmentsResult,
    futureAppointmentsResult,
    recipientHistoryResult,
    consentResult,
    blacklistResult,
    valueIndex,
  ] = await Promise.all([
    supabase
      .from('ops_customers')
      .select(
        'id, full_name, first_name, phone, is_internal, is_commercial, ops_service_addresses(id, street_1, city, state, zip_code)',
      )
      .limit(5000),
    supabase
      .from('ops_appointments')
      .select(
        'customer_id, appointment_date, service_address_id, kind, restoration_project_id',
      )
      .eq('status', 'completed')
      .order('appointment_date', { ascending: false })
      .limit(15000),
    supabase
      .from('ops_appointments')
      .select('customer_id')
      .lt('appointment_date', today)
      .eq('kind', 'service')
      .in('status', ACTIVE_APPOINTMENT_STATUSES)
      .limit(10000),
    supabase
      .from('ops_appointments')
      .select('customer_id')
      .gte('appointment_date', today)
      .in('status', ACTIVE_APPOINTMENT_STATUSES)
      .limit(10000),
    supabase
      .from('tomorrow_fill_recipients')
      .select('customer_id, sent_at, replied_at, booked_at')
      .not('sent_at', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(20000),
    supabase.from('sms_marketing_consents').select('customer_id, status'),
    supabase.from('blacklist').select('phone'),
    loadCustomerValueIndex(supabase),
  ])

  for (const result of [
    customersResult,
    appointmentHistoryResult,
    pastUnresolvedAppointmentsResult,
    futureAppointmentsResult,
    recipientHistoryResult,
    consentResult,
    blacklistResult,
  ]) {
    if (result.error) throw result.error
  }

  const customers = (customersResult.data || []) as CustomerRow[]
  const historyRows = (appointmentHistoryResult.data ||
    []) as AppointmentHistoryRow[]
  const latestCleanByCustomer = new Map<string, AppointmentHistoryRow>()
  const restorationDates = new Map<string, Set<string>>()
  for (const row of historyRows) {
    if (row.kind === 'restoration' || row.restoration_project_id) {
      const dates = restorationDates.get(row.customer_id) || new Set<string>()
      dates.add(row.appointment_date)
      restorationDates.set(row.customer_id, dates)
      continue
    }
    if (row.kind !== 'service') continue
    if (!latestCleanByCustomer.has(row.customer_id)) {
      latestCleanByCustomer.set(row.customer_id, row)
    }
  }

  const futureCustomerIds = new Set(
    (futureAppointmentsResult.data || []).map((row) => row.customer_id),
  )
  const unresolvedPastCustomerIds = new Set(
    (pastUnresolvedAppointmentsResult.data || []).map((row) => row.customer_id),
  )
  const consentByCustomer = new Map(
    (consentResult.data || []).map((row) => [row.customer_id, row.status]),
  )
  const blacklistedPhones = new Set(
    (blacklistResult.data || [])
      .map((row) => normalizeFillPhone(row.phone))
      .filter((phone): phone is string => Boolean(phone)),
  )
  const contactHistory = new Map<string, FillContact[]>()
  for (const row of (recipientHistoryResult.data ||
    []) as RecipientHistoryRow[]) {
    const rows = contactHistory.get(row.customer_id) || []
    rows.push({
      sentAt: row.sent_at,
      repliedAt: row.replied_at,
      bookedAt: row.booked_at,
    })
    contactHistory.set(row.customer_id, rows)
  }

  const selectedZipSet = new Set(selectedZips)
  const exclusions: Record<string, number> = {}
  const exclude = (reason: string) => {
    exclusions[reason] = (exclusions[reason] || 0) + 1
  }
  const candidates: Candidate[] = []

  for (const customer of customers) {
    if (customer.is_internal || customer.is_commercial) {
      exclude('not_residential')
      continue
    }
    const phone = normalizeFillPhone(customer.phone)
    if (!phone) {
      exclude('invalid_phone')
      continue
    }
    if (blacklistedPhones.has(phone)) {
      exclude('blacklisted')
      continue
    }
    if (consentByCustomer.get(customer.id) === 'opted_out') {
      exclude('opted_out')
      continue
    }
    if (futureCustomerIds.has(customer.id)) {
      exclude('future_booking')
      continue
    }
    if (unresolvedPastCustomerIds.has(customer.id)) {
      exclude('unresolved_past_booking')
      continue
    }

    const history = valueIndex.get(customer.id)
    if (history?.doNotContact) {
      exclude('do_not_contact')
      continue
    }
    const latestOpsClean = latestCleanByCustomer.get(customer.id)
    let lastCleanDate = history?.lastKnownService || null
    if (
      lastCleanDate &&
      restorationDates.get(customer.id)?.has(lastCleanDate)
    ) {
      lastCleanDate = latestOpsClean?.appointment_date || null
    }
    if (
      latestOpsClean?.appointment_date &&
      (!lastCleanDate || latestOpsClean.appointment_date > lastCleanDate)
    ) {
      lastCleanDate = latestOpsClean.appointment_date
    }
    if (!lastCleanDate) {
      exclude('no_clean_history')
      continue
    }
    if (
      addCalendarMonths(lastCleanDate, settings.dormancy_months) > targetDate
    ) {
      exclude('not_due')
      continue
    }

    const addresses = relationArray(customer.ops_service_addresses)
    const latestAddress = latestOpsClean?.service_address_id
      ? addresses.find((row) => row.id === latestOpsClean.service_address_id)
      : null
    const address =
      latestAddress ||
      addresses.find((row) =>
        selectedZipSet.has(normalizeFillZip(row.zip_code) || ''),
      ) ||
      addresses[0]
    const zip = normalizeFillZip(address?.zip_code)
    if (!address || !zip) {
      exclude('missing_address')
      continue
    }
    if (!selectedZipSet.has(zip)) {
      exclude('zip_mismatch')
      continue
    }

    const contact = contactEligibility({
      history: contactHistory.get(customer.id) || [],
      asOfDate: targetDate,
      cooldownDays: settings.customer_cooldown_days,
      unansweredLimit: settings.unanswered_limit,
      restDays: settings.rest_days,
    })
    if (!contact.eligible) {
      exclude(contact.reason || 'contact_suppressed')
      continue
    }

    candidates.push({
      customerId: customer.id,
      addressId: address.id,
      phone,
      zip,
      street: address.street_1,
      firstName: firstName(customer),
      fullName: customer.full_name,
      lastCleanDate,
      lifetimeValue: Number(history?.lifetimeValue || 0),
      lastContactedAt: contact.lastContactedAt,
    })
  }

  candidates.sort(
    (a, b) =>
      a.lastCleanDate.localeCompare(b.lastCleanDate) ||
      b.lifetimeValue - a.lifetimeValue ||
      a.fullName.localeCompare(b.fullName),
  )

  const unique: Candidate[] = []
  const seenPhones = new Set<string>()
  const seenHouseholds = new Set<string>()
  for (const candidate of candidates) {
    const household = normalizeHouseholdKey({
      street: candidate.street,
      zip: candidate.zip,
    })
    if (seenPhones.has(candidate.phone)) {
      exclude('duplicate_phone')
      continue
    }
    if (household && seenHouseholds.has(household)) {
      exclude('duplicate_household')
      continue
    }
    seenPhones.add(candidate.phone)
    if (household) seenHouseholds.add(household)
    unique.push(candidate)
  }

  return { candidates: unique, exclusions }
}

function scanTelegramMessage(params: {
  targetDate: string
  openings: FillOpening[]
  selectedZips: string[]
  candidates: Candidate[]
  settings: TomorrowFillSettings
  exclusions: Record<string, number>
}) {
  const dateLabel = new Date(
    `${params.targetDate}T12:00:00`,
  ).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
  const hours = (params.openings.length * 2).toFixed(1).replace('.0', '')
  const top = params.candidates
    .slice(0, 5)
    .map(
      (candidate, index) =>
        `${index + 1}. ${candidate.fullName} · ${candidate.zip} · latest recorded clean ${candidate.lastCleanDate}`,
    )
    .join('\n')
  const suppressed = Object.values(params.exclusions).reduce(
    (sum, count) => sum + count,
    0,
  )
  return [
    `TOMORROW FILL · ${dateLabel}`,
    '',
    `${hours} hours open across ${params.openings.length} bookable windows`,
    `Route ZIPs: ${params.selectedZips.join(', ')}`,
    `${params.candidates.length} customers are safe to contact · ${suppressed} excluded`,
    '',
    `Top ${Math.min(5, params.candidates.length)} of ${params.candidates.length} eligible customers:`,
    top || 'No customers qualified.',
    '',
    `Offer: $${params.settings.offer_amount} off $${params.settings.minimum_subtotal}+ · ${params.settings.offer_code}`,
    `Stops after ${params.settings.max_discounted_bookings} bookings or capacity fills.`,
    params.settings.send_enabled
      ? 'Choose the exact first-wave size.'
      : 'PREVIEW ONLY — sending is disabled in the dashboard.',
  ].join('\n')
}

export async function scanTomorrowFill(params?: {
  targetDate?: string
  notifyTelegram?: boolean
  actor?: string
}): Promise<TomorrowFillScanResult> {
  const supabase = createAdminClient()
  const settings = await loadTomorrowFillSettings(supabase)
  const targetDate = params?.targetDate || addDays(mountainDate(), 1)
  if (!settings.engine_enabled) {
    return {
      skipped: true,
      reason: 'engine_disabled',
      targetDate,
      openMinutes: 0,
      selectedZips: [],
      eligibleCount: 0,
      telegramSent: false,
    }
  }

  const { data: existing } = await supabase
    .from('tomorrow_fill_campaigns')
    .select('id, status, open_minutes, selected_zips, eligible_count')
    .eq('target_date', targetDate)
    .maybeSingle()
  if (
    existing &&
    ['pending_approval', 'sending', 'active', 'filled'].includes(
      existing.status,
    )
  ) {
    return {
      skipped: true,
      reason: `campaign_${existing.status}`,
      campaignId: existing.id,
      targetDate,
      openMinutes: Number(existing.open_minutes || 0),
      selectedZips: existing.selected_zips || [],
      eligibleCount: Number(existing.eligible_count || 0),
      telegramSent: false,
    }
  }

  const [openings, selectedZips] = await Promise.all([
    loadTomorrowOpenings(supabase, targetDate),
    loadRouteZips(supabase, targetDate),
  ])
  const openMinutes = openings.length * 120
  if (openings.length === 0 || selectedZips.length === 0) {
    const reason = openings.length === 0 ? 'no_open_capacity' : 'no_route_zip'
    const telegramSent =
      params?.notifyTelegram === false
        ? false
        : await sendTelegramNotification(
            [
              `TOMORROW FILL · ${targetDate}`,
              '',
              reason === 'no_open_capacity'
                ? 'No route-fill campaign: tomorrow has no two-hour openings.'
                : 'No route-fill campaign: tomorrow has no qualifying residential route ZIP.',
            ].join('\n'),
          )
    return {
      skipped: true,
      reason,
      targetDate,
      openMinutes,
      selectedZips,
      eligibleCount: 0,
      telegramSent,
    }
  }

  const { candidates, exclusions } = await loadCandidates({
    supabase,
    settings,
    targetDate,
    selectedZips,
  })
  const audienceBelowMinimum =
    candidates.length < settings.minimum_audience_size

  const campaignPayload = {
    target_date: targetDate,
    status: audienceBelowMinimum ? 'skipped' : 'pending_approval',
    selected_zips: selectedZips,
    openings,
    exclusion_counts: exclusions,
    open_minutes: openMinutes,
    booked_minutes: 0,
    eligible_count: candidates.length,
    selected_count: 0,
    sent_count: 0,
    failed_count: 0,
    booked_count: 0,
    attributed_revenue: 0,
    max_discounted_bookings: settings.max_discounted_bookings,
    offer_code: settings.offer_code,
    offer_amount: settings.offer_amount,
    minimum_subtotal: settings.minimum_subtotal,
    message_template: settings.message_template,
    expires_at: endOfMountainDay(targetDate, settings.offer_valid_days),
    updated_at: new Date().toISOString(),
  }
  const { data: campaign, error: campaignError } = await supabase
    .from('tomorrow_fill_campaigns')
    .upsert(campaignPayload, { onConflict: 'target_date' })
    .select('id')
    .single()
  if (campaignError) throw campaignError

  await supabase
    .from('tomorrow_fill_recipients')
    .delete()
    .eq('campaign_id', campaign.id)
    .is('sent_at', null)

  const recipientRows = candidates.map((candidate, index) => ({
    campaign_id: campaign.id,
    customer_id: candidate.customerId,
    service_address_id: candidate.addressId,
    phone_normalized: candidate.phone,
    zip_code: candidate.zip,
    last_clean_date: candidate.lastCleanDate,
    lifetime_value: Number(candidate.lifetimeValue.toFixed(2)),
    last_contacted_at: candidate.lastContactedAt,
    rank: index + 1,
    status: 'eligible',
  }))
  const { error: recipientsError } = await supabase
    .from('tomorrow_fill_recipients')
    .upsert(recipientRows, { onConflict: 'campaign_id,customer_id' })
  if (recipientsError) throw recipientsError

  const consentRows = candidates.map((candidate) => ({
    customer_id: candidate.customerId,
    phone_normalized: candidate.phone,
    status: 'opted_in',
    source: 'existing_customer_terms',
    disclosure:
      'Existing customer promotional messaging disclosure confirmed by owner.',
    updated_at: new Date().toISOString(),
  }))
  await supabase
    .from('sms_marketing_consents')
    .upsert(consentRows, { onConflict: 'customer_id', ignoreDuplicates: true })

  await supabase.from('tomorrow_fill_events').insert({
    campaign_id: campaign.id,
    event_type: audienceBelowMinimum ? 'scan_skipped' : 'scanned',
    actor: params?.actor || 'cron',
    detail: {
      target_date: targetDate,
      open_minutes: openMinutes,
      zips: selectedZips,
      eligible_count: candidates.length,
      exclusions,
      reason: audienceBelowMinimum ? 'audience_below_minimum' : null,
    },
  })

  let telegramSent = false
  if (audienceBelowMinimum && params?.notifyTelegram !== false) {
    telegramSent = await sendTelegramNotification(
      [
        `TOMORROW FILL · ${targetDate}`,
        '',
        'No text wave created.',
        `${candidates.length} eligible customers is below the minimum audience of ${settings.minimum_audience_size}.`,
        `Route ZIPs: ${selectedZips.join(', ')}`,
        `${ADMIN_BASE_URL}/admin/operations/tomorrow-fill?campaign=${campaign.id}`,
      ].join('\n'),
      { disablePreview: true },
    )
  }
  if (!audienceBelowMinimum && params?.notifyTelegram !== false) {
    const message = scanTelegramMessage({
      targetDate,
      openings,
      selectedZips,
      candidates,
      settings,
      exclusions,
    })
    const reviewButton = {
      text: 'Review customers & settings',
      url: `${ADMIN_BASE_URL}/admin/operations/tomorrow-fill?campaign=${campaign.id}`,
    }
    const safeWaveLimit = tomorrowFillWaveLimit(openings.length)
    const sendButtons = [5, 10, 15]
      .filter((amount) => amount <= safeWaveLimit)
      .map((amount) => ({
        text: `Send ${amount}`,
        callback_data: `tf:${amount}:${campaign.id}`,
      }))
    const action = await sendTelegramActionMessage(
      message,
      settings.send_enabled
        ? [
            sendButtons,
            [{ text: 'Skip today', callback_data: `tf:skip:${campaign.id}` }],
            [reviewButton],
          ]
        : [
            [reviewButton],
            [
              {
                text: 'Skip today',
                callback_data: `tf:skip:${campaign.id}`,
              },
            ],
          ],
    )
    if (action) {
      telegramSent = true
      await supabase
        .from('tomorrow_fill_campaigns')
        .update({
          telegram_chat_id: String(action.chatId),
          telegram_message_id: String(action.messageId),
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaign.id)
    }
  }

  return {
    skipped: audienceBelowMinimum,
    reason: audienceBelowMinimum ? 'audience_below_minimum' : undefined,
    campaignId: campaign.id,
    targetDate,
    openMinutes,
    selectedZips,
    eligibleCount: candidates.length,
    telegramSent,
  }
}

async function revalidateRecipient(
  supabase: SupabaseAdmin,
  recipient: {
    id: string
    customer_id: string
    phone_normalized: string
  },
) {
  const [{ data: consent }, { data: future }] = await Promise.all([
    supabase
      .from('sms_marketing_consents')
      .select('status')
      .eq('customer_id', recipient.customer_id)
      .maybeSingle(),
    supabase
      .from('ops_appointments')
      .select('id')
      .eq('customer_id', recipient.customer_id)
      .gte('appointment_date', mountainDate())
      .in('status', ACTIVE_APPOINTMENT_STATUSES)
      .limit(1),
  ])
  if (consent?.status === 'opted_out') return 'opted_out'
  if ((future || []).length > 0) return 'future_booking'
  if (await isBlacklisted(recipient.phone_normalized)) return 'blacklisted'
  return null
}

export async function sendTomorrowFillWave(params: {
  campaignId: string
  amount: number
  actor: string
}) {
  const supabase = createAdminClient()
  const settings = await loadTomorrowFillSettings(supabase)
  if (!settings.send_enabled) {
    throw new Error(
      'Tomorrow Fill is in Preview Only mode. Enable sending in the dashboard first.',
    )
  }

  const { data: campaign, error: campaignError } = await supabase
    .from('tomorrow_fill_campaigns')
    .select('*')
    .eq('id', params.campaignId)
    .maybeSingle()
  if (campaignError) throw campaignError
  if (!campaign) throw new Error('Campaign not found.')
  if (!['pending_approval', 'active'].includes(campaign.status)) {
    throw new Error(`This campaign is already ${campaign.status}.`)
  }
  if (new Date(campaign.expires_at).getTime() <= Date.now()) {
    throw new Error('This campaign has expired.')
  }

  const openingCount = Array.isArray(campaign.openings)
    ? campaign.openings.length
    : 0
  const waveLimit = tomorrowFillWaveLimit(openingCount)
  if (![5, 10, 15].includes(params.amount) || params.amount > waveLimit) {
    throw new Error(
      `This route is limited to ${waveLimit} customers per staged wave.`,
    )
  }

  const remainingBookings = Math.max(
    0,
    Number(campaign.max_discounted_bookings) - Number(campaign.booked_count),
  )
  if (remainingBookings === 0) throw new Error('The offer is already filled.')

  let query = supabase
    .from('tomorrow_fill_recipients')
    .select(
      'id, customer_id, phone_normalized, zip_code, booking_token, status, ops_customers(full_name, first_name)',
    )
    .eq('campaign_id', campaign.id)
    .eq('status', 'eligible')
    .order('rank', { ascending: true })
  query = query.limit(params.amount)
  const { data: recipients, error: recipientsError } = await query
  if (recipientsError) throw recipientsError
  if (!recipients?.length)
    throw new Error('No fresh eligible customers remain.')

  await supabase
    .from('tomorrow_fill_campaigns')
    .update({
      status: 'sending',
      selected_count: recipients.length,
      approved_at: new Date().toISOString(),
      approved_by: params.actor,
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaign.id)
  await supabase
    .from('tomorrow_fill_recipients')
    .update({ status: 'selected', updated_at: new Date().toISOString() })
    .in(
      'id',
      recipients.map((row) => row.id),
    )

  let sent = 0
  let failed = 0
  const errors: string[] = []
  for (const recipient of recipients) {
    const suppression = await revalidateRecipient(supabase, recipient)
    if (suppression) {
      await supabase
        .from('tomorrow_fill_recipients')
        .update({
          status: 'suppressed',
          exclusion_reason: suppression,
          updated_at: new Date().toISOString(),
        })
        .eq('id', recipient.id)
      continue
    }

    const customer = relationArray(recipient.ops_customers)[0] as
      | { full_name?: string; first_name?: string | null }
      | undefined
    const customerFirstName =
      customer?.first_name || customer?.full_name?.split(' ')[0] || 'there'
    const bookingUrl = `${CUSTOMER_BASE_URL}/${recipient.booking_token}`
    const message = renderFillMessage(campaign.message_template, {
      first_name: customerFirstName,
      zip_code: recipient.zip_code,
      booking_url: bookingUrl,
      offer_code: campaign.offer_code,
      offer_amount: String(Number(campaign.offer_amount)),
      minimum_subtotal: String(Number(campaign.minimum_subtotal)),
    })

    try {
      const result = await sendCustomerSMSWithResult(
        recipient.phone_normalized,
        message,
        undefined,
        'tomorrow_fill_offer',
        undefined,
        {
          customerId: recipient.customer_id,
          tomorrowFillRecipientId: recipient.id,
          sentBy: params.actor,
        },
      )
      sent++
      await supabase
        .from('tomorrow_fill_recipients')
        .update({
          status: 'sent',
          twilio_sid: result.sid,
          message_body: message,
          sent_at: new Date().toISOString(),
          last_contacted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', recipient.id)
      await supabase.from('tomorrow_fill_events').insert({
        campaign_id: campaign.id,
        recipient_id: recipient.id,
        event_type: 'sent',
        actor: params.actor,
        detail: { twilio_sid: result.sid, to: result.to },
      })
    } catch (error) {
      failed++
      const detail = error instanceof Error ? error.message : 'Send failed'
      errors.push(`${customer?.full_name || recipient.id}: ${detail}`)
      await supabase
        .from('tomorrow_fill_recipients')
        .update({
          status: 'failed',
          exclusion_reason: detail.slice(0, 300),
          updated_at: new Date().toISOString(),
        })
        .eq('id', recipient.id)
    }
  }

  await supabase
    .from('tomorrow_fill_campaigns')
    .update({
      status: sent > 0 ? 'active' : 'failed',
      sent_count: Number(campaign.sent_count || 0) + sent,
      failed_count: Number(campaign.failed_count || 0) + failed,
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaign.id)
  await supabase.from('tomorrow_fill_events').insert({
    campaign_id: campaign.id,
    event_type: 'wave_completed',
    actor: params.actor,
    detail: { requested: recipients.length, sent, failed, errors },
  })

  return { sent, failed, errors, requested: recipients.length }
}

export async function skipTomorrowFillCampaign(params: {
  campaignId: string
  actor: string
}) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tomorrow_fill_campaigns')
    .update({ status: 'skipped', updated_at: new Date().toISOString() })
    .eq('id', params.campaignId)
    .in('status', ['preview', 'pending_approval', 'active'])
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('This campaign was already handled.')
  await supabase.from('tomorrow_fill_events').insert({
    campaign_id: params.campaignId,
    event_type: 'skipped',
    actor: params.actor,
  })
}

function allowedTelegramUser(userId: number) {
  const configured = [
    process.env.CHARLES_TELEGRAM_USER_ID,
    process.env.CHARLES_TELEGRAM_CHAT_ID,
    process.env.TELEGRAM_CHAT_ID,
  ]
    .filter(Boolean)
    .map(String)
  return configured.length === 0 || configured.includes(String(userId))
}

export async function handleTomorrowFillTelegramCallback(params: {
  callbackQueryId: string
  callbackData: string
  userId: number
  chatId: number
  messageId: number
}) {
  const match = params.callbackData.match(
    /^tf:(5|10|15|skip):([0-9a-f-]{36})$/i,
  )
  if (!match) return false
  if (!allowedTelegramUser(params.userId)) {
    await answerTelegramCallback(
      params.callbackQueryId,
      'This approval is limited to the owner.',
      true,
    )
    return true
  }

  const action = match[1].toLowerCase()
  const campaignId = match[2]
  try {
    if (action === 'skip') {
      await skipTomorrowFillCampaign({
        campaignId,
        actor: `telegram:${params.userId}`,
      })
      await answerTelegramCallback(params.callbackQueryId, 'Campaign skipped.')
      await clearTelegramActionButtons(params)
      await sendTelegramNotification('Tomorrow Fill skipped for this route.')
      return true
    }

    const result = await sendTomorrowFillWave({
      campaignId,
      amount: Number(action),
      actor: `telegram:${params.userId}`,
    })
    await answerTelegramCallback(
      params.callbackQueryId,
      `${result.sent} customer text${result.sent === 1 ? '' : 's'} sent.`,
    )
    await clearTelegramActionButtons(params)
    await sendTelegramNotification(
      [
        'Tomorrow Fill wave sent.',
        `${result.sent} sent · ${result.failed} failed`,
        `Review: ${ADMIN_BASE_URL}/admin/operations/tomorrow-fill?campaign=${campaignId}`,
      ].join('\n'),
      { disablePreview: true },
    )
  } catch (error) {
    await answerTelegramCallback(
      params.callbackQueryId,
      error instanceof Error ? error.message : 'The action failed.',
      true,
    )
  }
  return true
}

export async function recordTomorrowFillReply(params: {
  customerId: string | null
  phone: string
  message: string
  twilioSid: string
}) {
  const supabase = createAdminClient()
  const phone = normalizeFillPhone(params.phone)
  if (!phone) return
  const normalizedMessage = params.message.trim().toLowerCase()
  const isOptOut = /^(stop|stopall|unsubscribe|cancel|end|quit)$/i.test(
    normalizedMessage,
  )

  if (params.customerId && isOptOut) {
    await supabase.from('sms_marketing_consents').upsert(
      {
        customer_id: params.customerId,
        phone_normalized: phone,
        status: 'opted_out',
        source: 'customer_reply',
        opted_out_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_id' },
    )
  }

  let query = supabase
    .from('tomorrow_fill_recipients')
    .select('id, campaign_id, status')
    .eq('phone_normalized', phone)
    .not('sent_at', 'is', null)
    .gte('sent_at', addDays(mountainDate(), -30))
    .order('sent_at', { ascending: false })
    .limit(1)
  if (params.customerId) query = query.eq('customer_id', params.customerId)
  const { data } = await query.maybeSingle()
  if (!data) return

  await supabase
    .from('tomorrow_fill_recipients')
    .update({
      status: data.status === 'booked' ? 'booked' : 'replied',
      replied_at: new Date().toISOString(),
      exclusion_reason: isOptOut ? 'customer_opt_out' : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', data.id)
  await supabase.from('tomorrow_fill_events').insert({
    campaign_id: data.campaign_id,
    recipient_id: data.id,
    event_type: isOptOut ? 'opted_out' : 'replied',
    actor: 'customer_sms',
    detail: { twilio_sid: params.twilioSid },
  })
}

export async function loadPublicTomorrowFillOffer(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tomorrow_fill_recipients')
    .select(
      `
      id,
      status,
      clicked_at,
      booking_token,
      customer_id,
      service_address_id,
      phone_normalized,
      zip_code,
      campaign_id,
      tomorrow_fill_campaigns (
        id, target_date, status, offer_code, offer_amount,
        minimum_subtotal, booked_count, max_discounted_bookings, expires_at
      ),
      ops_customers ( first_name, last_name, full_name, email, phone ),
      ops_service_addresses ( street_1, city, state, zip_code )
    `,
    )
    .eq('booking_token', token)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const campaign = relationArray(data.tomorrow_fill_campaigns)[0]
  if (
    !campaign ||
    !['active', 'sending'].includes(campaign.status) ||
    new Date(campaign.expires_at).getTime() <= Date.now() ||
    Number(campaign.booked_count) >= Number(campaign.max_discounted_bookings) ||
    !['sent', 'clicked', 'replied', 'claiming'].includes(data.status)
  ) {
    return { available: false as const }
  }

  const customer = relationArray(data.ops_customers)[0]
  const address = relationArray(data.ops_service_addresses)[0]
  if (!customer || !address) return { available: false as const }

  if (!data.clicked_at) {
    await supabase
      .from('tomorrow_fill_recipients')
      .update({
        status: data.status === 'sent' ? 'clicked' : data.status,
        clicked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id)
    await supabase.from('tomorrow_fill_events').insert({
      campaign_id: data.campaign_id,
      recipient_id: data.id,
      event_type: 'clicked',
      actor: 'customer_link',
    })
  }

  return {
    available: true as const,
    token,
    targetDate: campaign.target_date,
    offerCode: campaign.offer_code,
    offerAmount: Number(campaign.offer_amount),
    minimumSubtotal: Number(campaign.minimum_subtotal),
    customer: {
      first_name:
        customer.first_name || customer.full_name?.split(' ')[0] || '',
      last_name: customer.last_name || '',
      email: customer.email || '',
      phone: customer.phone || data.phone_normalized,
      street_1: address.street_1,
      city: address.city,
      state: address.state,
      zip_code: address.zip_code,
    },
  }
}

export async function validateTomorrowFillPromoToken(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tomorrow_fill_recipients')
    .select(
      `
      id, phone_normalized, status,
      tomorrow_fill_campaigns (
        id, status, offer_code, offer_amount, minimum_subtotal,
        booked_count, max_discounted_bookings, expires_at
      )
    `,
    )
    .eq('booking_token', token)
    .maybeSingle()
  if (error) throw error
  if (
    !data ||
    !['sent', 'clicked', 'replied', 'claiming'].includes(data.status)
  ) {
    return null
  }

  const campaign = relationArray(data.tomorrow_fill_campaigns)[0]
  if (
    !campaign ||
    !['active', 'sending'].includes(campaign.status) ||
    new Date(campaign.expires_at).getTime() <= Date.now() ||
    Number(campaign.booked_count) >= Number(campaign.max_discounted_bookings)
  ) {
    return null
  }

  return {
    recipientId: data.id,
    phone: data.phone_normalized,
    campaignId: campaign.id,
    offerCode: campaign.offer_code,
    offerAmount: Number(campaign.offer_amount),
    minimumSubtotal: Number(campaign.minimum_subtotal),
  }
}

export async function reserveTomorrowFillOffer(params: {
  token: string
  phone: string
}) {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('reserve_tomorrow_fill_offer', {
    p_token: params.token,
    p_phone: params.phone,
  })
  if (error) throw error
  return Array.isArray(data) ? data[0] || null : data
}

export async function releaseTomorrowFillOffer(recipientId: string) {
  const supabase = createAdminClient()
  await supabase.rpc('release_tomorrow_fill_offer', {
    p_recipient_id: recipientId,
  })
}

export async function finalizeTomorrowFillBooking(params: {
  recipientId: string
  appointmentId: string
  bookingTotal: number
  appointmentMinutes: number
  appointmentDate: string
}) {
  const supabase = createAdminClient()
  const { error } = await supabase.rpc('finalize_tomorrow_fill_booking', {
    p_recipient_id: params.recipientId,
    p_appointment_id: params.appointmentId,
    p_booking_total: params.bookingTotal,
    p_appointment_minutes: params.appointmentMinutes,
    p_appointment_date: params.appointmentDate,
  })
  if (error) throw error
  await sendTelegramNotification(
    [
      'TOMORROW FILL BOOKED',
      `$${params.bookingTotal.toFixed(2)} appointment booked for ${params.appointmentDate}.`,
      `${ADMIN_BASE_URL}/admin/operations/appointments/${params.appointmentId}`,
    ].join('\n'),
    { disablePreview: true },
  )
}
