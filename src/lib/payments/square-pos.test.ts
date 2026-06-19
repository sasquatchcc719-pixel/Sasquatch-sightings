import { describe, it, expect } from 'vitest'
import {
  buildSquarePosUrl,
  detectMobilePlatform,
  parseSquarePosReturn,
} from './square-pos'

describe('detectMobilePlatform', () => {
  it('detects android, defaults everything else to ios', () => {
    expect(detectMobilePlatform('... Android 14; Pixel ...')).toBe('android')
    expect(detectMobilePlatform('... iPhone OS 17_4 like Mac ...')).toBe('ios')
    expect(detectMobilePlatform(null)).toBe('ios')
  })
})

describe('buildSquarePosUrl (iOS)', () => {
  it('builds a square-commerce-v1 URL with the amount + state', () => {
    const url = buildSquarePosUrl({
      platform: 'ios',
      amountCents: 38500,
      callbackUrl: 'https://sightings.sasquatchcarpet.com/api/tech/x/return',
      applicationId: 'sq0idp-TEST',
      locationId: 'LOC123',
      note: 'Invoice #42',
      state: 'appt-7',
    })
    expect(url.startsWith('square-commerce-v1://payment/create?data=')).toBe(
      true,
    )
    const data = JSON.parse(
      decodeURIComponent(url.split('data=')[1]),
    ) as Record<string, unknown>
    expect(data.amount_money).toEqual({ amount: 38500, currency_code: 'USD' })
    expect(data.client_id).toBe('sq0idp-TEST')
    expect(data.version).toBe('1.3')
    expect(data.location_id).toBe('LOC123')
    expect(data.state).toBe('appt-7')
    expect(
      (data.options as { supported_tender_types: string[] })
        .supported_tender_types,
    ).toEqual(['CREDIT_CARD'])
  })

  it('rejects a zero/invalid amount and a missing application id', () => {
    expect(() =>
      buildSquarePosUrl({
        platform: 'ios',
        amountCents: 0,
        callbackUrl: 'https://x',
        applicationId: 'sq0idp-TEST',
      }),
    ).toThrow(/greater than zero/)
    expect(() =>
      buildSquarePosUrl({
        platform: 'ios',
        amountCents: 100,
        callbackUrl: 'https://x',
        applicationId: '',
      }),
    ).toThrow(/Application ID/)
  })
})

describe('buildSquarePosUrl (Android)', () => {
  it('builds an intent URL with the charge action + extras', () => {
    const url = buildSquarePosUrl({
      platform: 'android',
      amountCents: 100,
      callbackUrl: 'https://sightings.sasquatchcarpet.com/return',
      applicationId: 'sq0idp-TEST',
      state: 'appt-9',
    })
    expect(url).toContain('action=com.squareup.pos.action.CHARGE')
    expect(url).toContain('package=com.squareup')
    expect(url).toContain('i.com.squareup.pos.TOTAL_AMOUNT=100')
    expect(url).toContain('S.com.squareup.pos.CLIENT_ID=sq0idp-TEST')
    expect(url).toContain('TENDER_CARD')
  })
})

describe('parseSquarePosReturn', () => {
  it('parses an iOS success data param', () => {
    const sp = new URLSearchParams()
    sp.set(
      'data',
      JSON.stringify({ status: 'ok', transaction_id: 'TXN1', state: 'appt-7' }),
    )
    expect(parseSquarePosReturn(sp)).toEqual({
      status: 'ok',
      transactionId: 'TXN1',
      state: 'appt-7',
    })
  })

  it('parses an iOS error/cancel data param', () => {
    const sp = new URLSearchParams()
    sp.set(
      'data',
      JSON.stringify({ status: 'error', error_code: 'payment_canceled' }),
    )
    expect(parseSquarePosReturn(sp)).toEqual({
      status: 'error',
      errorCode: 'payment_canceled',
      state: null,
    })
  })

  it('parses Android success + error params', () => {
    const ok = new URLSearchParams()
    ok.set('com.squareup.pos.SERVER_TRANSACTION_ID', 'TXN2')
    ok.set('com.squareup.pos.REQUEST_METADATA', 'appt-9')
    expect(parseSquarePosReturn(ok)).toEqual({
      status: 'ok',
      transactionId: 'TXN2',
      state: 'appt-9',
    })

    const err = new URLSearchParams()
    err.set('com.squareup.pos.ERROR_CODE', 'TRANSACTION_CANCELED')
    expect(parseSquarePosReturn(err)?.status).toBe('error')
  })

  it('returns null when there is nothing to parse', () => {
    expect(parseSquarePosReturn(new URLSearchParams())).toBeNull()
  })
})
