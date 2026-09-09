import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VehicleHelp } from './vehicle-help'

let onPosition: PositionCallback
let onError: PositionErrorCallback
const getCurrentPosition = vi.fn()
const writeText = vi.fn()
const share = vi.fn()

function gps(accuracy = 12, timestamp = Date.now()) {
  act(() =>
    onPosition({
      coords: {
        latitude: 38.91,
        longitude: -104.82,
        accuracy,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp,
    } as GeolocationPosition),
  )
}

function enterManualLocation() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Enter location manually' }),
  )
  fireEvent.change(
    screen.getByLabelText('Map pin, GPS coordinates, or pickup address'),
    { target: { value: 'I-25 northbound, exit 153, right shoulder' } },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getCurrentPosition.mockImplementation((success, error) => {
    onPosition = success
    onError = error
  })
  writeText.mockResolvedValue(undefined)
  share.mockResolvedValue(undefined)
  const browserNavigator = Object.create(navigator)
  Object.defineProperties(browserNavigator, {
    geolocation: { value: { getCurrentPosition }, configurable: true },
    clipboard: { value: { writeText }, configurable: true },
    share: { value: share, configurable: true },
  })
  vi.stubGlobal('navigator', browserNavigator)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('vehicle help workflow', () => {
  it('opens without requesting GPS or sending anything, with Jeff as the roadside contact', () => {
    render(<VehicleHelp driverName="David Gonzalez" />)
    expect(getCurrentPosition).not.toHaveBeenCalled()
    expect(share).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: /Call.*Jeff/ })).toHaveAttribute(
      'href',
      'tel:+17194121068',
    )
    expect(screen.getByText(/Jeff is a friend of Charles/)).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Share location message' }),
    ).toBeDisabled()
  })

  it('routes the box truck tow to Randy’s and makes the friend’s shop the destination', () => {
    render(<VehicleHelp driverName="David Gonzalez" />)
    fireEvent.click(screen.getByRole('button', { name: 'Need a tow' }))
    expect(screen.getByRole('link', { name: /Call.*Randy/ })).toHaveAttribute(
      'href',
      'tel:+17195966067',
    )
    expect(screen.getByRole('link', { name: /Call.*Matt/ })).toHaveAttribute(
      'href',
      'tel:+17193007119',
    )
    expect(screen.getByText(/Matt is a friend of Charles/)).toBeVisible()
    expect(screen.getByText(/Height and weight are not saved/)).toBeVisible()
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Message to share or read by phone',
        }) as HTMLTextAreaElement
      ).value,
    ).toContain('2007 Ford E-350 box truck (former Penske moving truck)')
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Message to share or read by phone',
        }) as HTMLTextAreaElement
      ).value,
    ).toContain(
      'Requested repair destination: Mountain Motorsport, 2522 E Platte Ave',
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Vehicle' }), {
      target: { value: 'other' },
    })
    fireEvent.change(screen.getByLabelText('Vehicle description'), {
      target: { value: 'White service van' },
    })
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Message to share or read by phone',
        }) as HTMLTextAreaElement
      ).value,
    ).not.toContain('Penske')
  })

  it('requests fresh GPS and includes the actual pickup separately from the mechanic address', async () => {
    render(<VehicleHelp driverName="David Gonzalez" />)
    fireEvent.click(screen.getByRole('button', { name: 'Need a tow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Get my GPS location' }))
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    )
    gps()
    expect(
      screen.getByRole('link', { name: /Check pickup pin/ }),
    ).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=38.910000,-104.820000',
    )
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Copy message' })),
    )
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('Pickup GPS: 38.910000, -104.820000'),
    )
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('estimated accuracy ±12 m'),
    )
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('Please repeat the exact pickup location'),
    )
  })

  it('keeps a manual fallback after permission denial', async () => {
    render(<VehicleHelp driverName="David Gonzalez" />)
    fireEvent.click(screen.getByRole('button', { name: 'Get my GPS location' }))
    act(() => onError({ code: 1 } as GeolocationPositionError))
    expect(screen.getByRole('alert')).toHaveTextContent('permission was denied')
    enterManualLocation()
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: 'Share location message' }),
      ),
    )
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          'Pickup location: I-25 northbound, exit 153, right shoulder',
        ),
      }),
    )
  })

  it('discards the previous fix when a refresh times out', () => {
    render(<VehicleHelp driverName="David Gonzalez" />)
    fireEvent.click(screen.getByRole('button', { name: 'Get my GPS location' }))
    gps()
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh GPS location' }),
    )
    act(() => onError({ code: 3 } as GeolocationPositionError))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not get a GPS fix',
    )
    expect(screen.getByRole('button', { name: 'Copy message' })).toBeDisabled()
    expect(
      screen.queryByRole('link', { name: /Check pickup pin/ }),
    ).not.toBeInTheDocument()
  })

  it('does not overwrite a manual location with a late GPS response', () => {
    render(<VehicleHelp driverName="David Gonzalez" />)
    fireEvent.click(screen.getByRole('button', { name: 'Get my GPS location' }))
    enterManualLocation()
    gps()
    expect(
      screen.queryByRole('link', { name: /Check pickup pin/ }),
    ).not.toBeInTheDocument()
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Message to share or read by phone',
        }) as HTMLTextAreaElement
      ).value,
    ).toContain('Pickup location: I-25 northbound')
  })

  it('rechecks GPS age at sharing time even if phone timers were suspended', async () => {
    vi.useFakeTimers()
    render(<VehicleHelp driverName="David Gonzalez" />)
    fireEvent.click(screen.getByRole('button', { name: 'Get my GPS location' }))
    gps()
    vi.setSystemTime(Date.now() + 6 * 60_000)
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: 'Share location message' }),
      ),
    )
    expect(share).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('over 5 minutes old')
  })

  it('flags low accuracy and allows a corrected manual pin', () => {
    render(<VehicleHelp driverName="David Gonzalez" />)
    fireEvent.click(screen.getByRole('button', { name: 'Get my GPS location' }))
    gps(800)
    expect(screen.getByText(/GPS accuracy is low/)).toBeVisible()
    enterManualLocation()
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Message to share or read by phone',
        }) as HTMLTextAreaElement
      ).value,
    ).not.toContain('Pickup GPS')
  })

  it('uses clipboard when native sharing is unavailable and keeps text selectable if copying fails', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined })
    render(<VehicleHelp driverName="David Gonzalez" />)
    enterManualLocation()
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: 'Share location message' }),
      ),
    )
    expect(writeText).toHaveBeenCalledOnce()
    writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Copy message' })),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Select and copy')
    expect(
      screen.getByRole('textbox', {
        name: 'Message to share or read by phone',
      }),
    ).toHaveFocus()
  })

  it('does not claim delivery when sharing is canceled', async () => {
    share.mockRejectedValueOnce(new DOMException('Canceled', 'AbortError'))
    render(<VehicleHelp driverName="David Gonzalez" />)
    enterManualLocation()
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: 'Share location message' }),
      ),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Sharing canceled')
    expect(writeText).not.toHaveBeenCalled()
  })
})
