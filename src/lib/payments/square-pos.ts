/**
 * Square Point of Sale API — mobile-web deep links.
 *
 * Lets the tech app hand a pre-filled amount to the Square Point of Sale app
 * so the customer can tap their card (Tap to Pay on iPhone, or any tender),
 * then Square switches back to our `callback_url` with the result. No typing.
 *
 * Spec: https://developer.squareup.com/docs/pos-api/web-technical-reference
 */

export type MobilePlatform = 'ios' | 'android'

/** Best-effort platform detection from a User-Agent string. Defaults to iOS. */
export function detectMobilePlatform(userAgent: string | null): MobilePlatform {
  const ua = (userAgent || '').toLowerCase()
  if (/android/.test(ua)) return 'android'
  return 'ios' // iPhone/iPad (and the safe default for our field phones)
}

type BuildParams = {
  platform: MobilePlatform
  amountCents: number
  currency?: string
  /** https URL Square returns to after the payment (or cancel/error). */
  callbackUrl: string
  /** Square Application ID (client_id). Public, not a secret. */
  applicationId: string
  /** Square location to attribute the sale to. */
  locationId?: string
  /** Free-text note saved on the Square receipt/dashboard. */
  note?: string
  /** Opaque value round-tripped back to us — we use the appointment id. */
  state?: string
}

/** Tender types we allow — card only (covers Tap to Pay + manual card entry). */
const IOS_TENDER_TYPES = ['CREDIT_CARD']
const ANDROID_TENDER_TYPES = 'com.squareup.pos.TENDER_CARD'

/**
 * Build the deep link that opens Square Point of Sale pre-loaded with the
 * amount. Throws if amount or applicationId is missing/invalid.
 */
export function buildSquarePosUrl(params: BuildParams): string {
  const {
    platform,
    amountCents,
    currency = 'USD',
    callbackUrl,
    applicationId,
    locationId,
    note,
    state,
  } = params

  if (!applicationId) {
    throw new Error('Square Application ID is not configured.')
  }
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('Amount must be greater than zero.')
  }
  const amount = Math.round(amountCents)

  if (platform === 'android') {
    // intent: URL — string extras prefixed S., integer extras prefixed i.
    const extras = [
      `S.com.squareup.pos.WEB_CALLBACK_URI=${encodeURIComponent(callbackUrl)}`,
      `S.com.squareup.pos.CLIENT_ID=${applicationId}`,
      `S.com.squareup.pos.API_VERSION=v2.0`,
      `i.com.squareup.pos.TOTAL_AMOUNT=${amount}`,
      `S.com.squareup.pos.CURRENCY_CODE=${currency}`,
      `S.com.squareup.pos.TENDER_TYPES=${ANDROID_TENDER_TYPES}`,
      note ? `S.com.squareup.pos.NOTE=${encodeURIComponent(note)}` : '',
      locationId ? `S.com.squareup.pos.LOCATION_ID=${locationId}` : '',
      state
        ? `S.com.squareup.pos.REQUEST_METADATA=${encodeURIComponent(state)}`
        : '',
    ].filter(Boolean)
    return `intent:#Intent;action=com.squareup.pos.action.CHARGE;package=com.squareup;${extras.join(';')};end`
  }

  // iOS: square-commerce-v1://payment/create?data=<percent-encoded JSON>
  const data: Record<string, unknown> = {
    amount_money: { amount, currency_code: currency },
    callback_url: callbackUrl,
    client_id: applicationId,
    version: '1.3',
    options: {
      supported_tender_types: IOS_TENDER_TYPES,
      auto_return: true,
    },
  }
  if (locationId) data.location_id = locationId
  if (note) data.notes = note
  if (state) data.state = state

  return `square-commerce-v1://payment/create?data=${encodeURIComponent(
    JSON.stringify(data),
  )}`
}

export type SquarePosResult =
  | { status: 'ok'; transactionId: string | null; state: string | null }
  | { status: 'error'; errorCode: string | null; state: string | null }

/**
 * Parse the result Square Point of Sale sends back to our callback URL.
 * iOS returns a single percent-encoded JSON `data` param; Android returns
 * individual `com.squareup.pos.*` query params. Handles both.
 */
export function parseSquarePosReturn(
  searchParams: URLSearchParams,
): SquarePosResult | null {
  // iOS — everything inside one JSON `data` param.
  const iosData = searchParams.get('data')
  if (iosData) {
    try {
      const parsed = JSON.parse(iosData) as {
        status?: string
        transaction_id?: string
        error_code?: string
        state?: string
      }
      if (parsed.status === 'ok') {
        return {
          status: 'ok',
          transactionId: parsed.transaction_id ?? null,
          state: parsed.state ?? null,
        }
      }
      return {
        status: 'error',
        errorCode: parsed.error_code ?? 'unknown',
        state: parsed.state ?? null,
      }
    } catch {
      return null
    }
  }

  // Android — individual extras on the query string.
  const androidErr = searchParams.get('com.squareup.pos.ERROR_CODE')
  const androidTxn = searchParams.get('com.squareup.pos.SERVER_TRANSACTION_ID')
  const androidState = searchParams.get('com.squareup.pos.REQUEST_METADATA')
  if (androidErr) {
    return { status: 'error', errorCode: androidErr, state: androidState }
  }
  if (androidTxn) {
    return { status: 'ok', transactionId: androidTxn, state: androidState }
  }

  return null
}
