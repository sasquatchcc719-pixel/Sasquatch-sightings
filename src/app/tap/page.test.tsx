import { createElement } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TapLandingPage from './page'

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  router: { replace: vi.fn() },
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => navigation.params,
  useRouter: () => navigation.router,
}))
vi.mock('./tap-forest', () => ({
  TapForest: () => <div data-testid="forest" />,
}))
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    createElement('img', { src, alt }),
}))
vi.mock('@/components/nfc/NfcBookingWidget', () => ({
  NfcBookingWidget: ({
    couponCode,
    cardId,
  }: {
    couponCode: string
    cardId: string | null
  }) => (
    <div data-testid="estimator" data-coupon={couponCode} data-card={cardId} />
  ),
}))
vi.mock('@/components/nfc/recent-jobs-carousel', () => ({
  RecentJobsCarousel: ({ compact }: { compact: boolean }) => (
    <div data-testid="recent-work" data-compact={compact} />
  ),
}))
vi.mock('@/components/push-opt-in-banner', () => ({
  PushOptInBanner: ({ placement }: { placement: string }) => (
    <div data-testid="notifications" data-placement={placement} />
  ),
}))

const response = (data: Record<string, unknown>) =>
  new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  )
  Element.prototype.scrollIntoView = vi.fn()
  navigation.params = new URLSearchParams()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    response({ tapId: 'tap-test', couponCode: 'SCC20' }),
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  navigation.router.replace.mockClear()
})

describe('mobile NFC card', () => {
  it('offers a direct emergency dial link before analytics has responded', () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}))
    render(<TapLandingPage />)
    expect(
      screen.getByRole('link', { name: /Water damage emergency/ }),
    ).toHaveAttribute('href', 'tel:+17197498807')
    expect(
      screen.getByRole('link', { name: /Call the office/ }),
    ).toHaveAttribute('href', 'tel:719-249-8791')
    expect(
      screen.queryByText(/Charles|24\/7|text “water”/i),
    ).not.toBeInTheDocument()
  })

  it('does not prevent dialing when click tracking fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<TapLandingPage />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    // Wait for page-view state to settle before making the click request fail.
    await screen.findByText('SCC20 auto-applied')
    vi.mocked(fetch).mockRejectedValueOnce(new Error('analytics unavailable'))
    let preventedByApp: boolean | undefined
    const intercept = (event: MouseEvent) => {
      preventedByApp = event.defaultPrevented
      event.preventDefault() // Only the test suppresses the external tel: navigation.
    }
    document.addEventListener('click', intercept, { once: true })
    fireEvent.click(
      screen.getByRole('link', { name: /Water damage emergency/ }),
    )
    expect(preventedByApp).toBe(false)
    await waitFor(() =>
      expect(errors).toHaveBeenCalledWith(
        'Failed to track button click:',
        expect.any(Error),
      ),
    )
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/tap/track',
      expect.objectContaining({
        keepalive: true,
        body: JSON.stringify({
          tapId: 'tap-test',
          action: 'button_click',
          buttonType: 'call',
        }),
      }),
    )
  })

  it('retains existing card attribution, partner coupon, and estimator behavior', async () => {
    navigation.params = new URLSearchParams('card=existing-card')
    vi.mocked(fetch).mockImplementation(async () =>
      response({
        tapId: 'tap-test',
        couponCode: 'LOCAL20',
        partnerName: 'Local shop',
      }),
    )
    render(<TapLandingPage />)
    await screen.findByText('LOCAL20 auto-applied')
    expect(fetch).toHaveBeenCalledWith(
      '/api/tap/track',
      expect.objectContaining({
        body: JSON.stringify({
          cardId: 'existing-card',
          partnerId: null,
          action: 'page_view',
        }),
      }),
    )
    const estimate = screen.getByRole('button', { name: /Get a free estimate/ })
    fireEvent.click(estimate)
    expect(estimate).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('estimator')).toHaveAttribute(
      'data-coupon',
      'LOCAL20',
    )
    expect(screen.getByTestId('estimator')).toHaveAttribute(
      'data-card',
      'existing-card',
    )
    expect(
      screen.getByRole('link', { name: /Water damage emergency/ }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: /Save contact/ })).toHaveAttribute(
      'href',
      '/api/sasquatch-contact?code=LOCAL20',
    )
    expect(
      decodeURIComponent(
        screen.getByRole('link', { name: /Text us/ }).getAttribute('href')!,
      ),
    ).toContain('I scanned the card at Local shop')
    fireEvent.click(estimate)
    expect(estimate).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('estimator')).not.toBeInTheDocument()
  })

  it.each([
    ['contest', '/location/vendor-card/contest'],
    ['booking', '/location/vendor-card'],
  ])(
    'preserves %s partner-card redirects',
    async (placardType, destination) => {
      navigation.params = new URLSearchParams('partner=vendor-card')
      vi.mocked(fetch).mockResolvedValue(response({ placardType }))
      render(<TapLandingPage />)
      await waitFor(() =>
        expect(navigation.router.replace).toHaveBeenCalledWith(destination),
      )
    },
  )

  it('shares the existing card URL and its coupon through native phone sharing', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share })
    vi.mocked(fetch).mockImplementation(async () =>
      response({ tapId: 'tap-test', couponCode: 'LOCAL20' }),
    )
    render(<TapLandingPage />)
    await screen.findByText('LOCAL20 auto-applied')
    fireEvent.click(screen.getByRole('button', { name: /Share this card/ }))
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith(
        expect.objectContaining({
          url: window.location.href,
          text: expect.stringContaining('LOCAL20'),
        }),
      ),
    )
  })

  it('copies the same URL when native sharing is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<TapLandingPage />)
    fireEvent.click(screen.getByRole('button', { name: /Share this card/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Link copied')
    expect(writeText).toHaveBeenCalledWith(window.location.href)
  })

  it('keeps supporting links and notifications below the main actions', () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}))
    render(<TapLandingPage />)
    expect(
      screen.getByRole('link', { name: /Leave us a review/ }),
    ).toHaveAttribute('href', 'https://g.page/r/CVAp5EYpgMFLEBM/review')
    expect(
      screen.getByRole('link', { name: /Local pros we trust/ }),
    ).toHaveAttribute('href', '/recommended-contractors')
    expect(screen.getByTestId('recent-work')).toHaveAttribute(
      'data-compact',
      'true',
    )
    expect(screen.getByTestId('notifications')).toHaveAttribute(
      'data-placement',
      'inline',
    )
    expect(screen.getByTestId('forest')).toBeInTheDocument()
  })
})
