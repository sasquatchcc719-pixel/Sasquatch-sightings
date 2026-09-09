import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResidentialEstimatePanel } from './residential-estimate-panel'

const input = {
  customer_id: null,
  customer: {
    first_name: '',
    last_name: '',
    email: 'neighbor@example.com',
    phone: '',
  },
  address: { street_1: '', street_2: '', city: '', state: '', zip_code: '' },
  line_items: [
    {
      service_catalog_item_id: 'carpet',
      name_snapshot: 'Carpet cleaning',
      quantity: 3,
      unit_price: 50,
    },
  ],
  promo_code: null,
  discount_amount: 20,
}
const preview = {
  to_email: input.customer.email,
  subject: 'Your estimate from Sasquatch Carpet Cleaning',
  body_text: 'Hi there,\n\nEstimated total: $130.00',
  html: '<p>Hi there,</p><p>Estimated total: $130.00</p>',
  total: 130,
  preview_fingerprint: 'reviewed-content',
}
const fetchMock = vi.fn()
const response = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
})
const props = {
  input,
  estimateMode: true,
  onModeChange: vi.fn(),
  onEmailChange: vi.fn(),
  onNameChange: vi.fn(),
  disabled: false,
  onBusyChange: vi.fn(),
}

describe('ResidentialEstimatePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('opening and switching mode never sends anything', () => {
    render(<ResidentialEstimatePanel {...props} estimateMode={false} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Email estimate instead' }),
    )
    expect(props.onModeChange).toHaveBeenCalledWith(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('previews with only services and an email, then sends the reviewed quote explicitly', async () => {
    fetchMock
      .mockResolvedValueOnce(response(preview))
      .mockResolvedValueOnce(
        response({ success: true, to_email: input.customer.email }),
      )
    render(<ResidentialEstimatePanel {...props} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview estimate email' }),
    )
    await screen.findByTitle('Estimate email preview')
    const request = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(request).toMatchObject({
      action: 'preview',
      recipient_email: input.customer.email,
      discount_amount: 20,
      line_items: input.line_items,
    })
    expect(request).not.toHaveProperty('appointment')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTitle('Estimate email preview')).toHaveAttribute(
      'srcdoc',
      preview.html,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send estimate email' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'No appointment was created',
    )
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      action: 'send',
      expected_fingerprint: preview.preview_fingerprint,
      request_id: expect.any(String),
    })
    expect(
      fetchMock.mock.calls.every(
        ([url]) => url === '/api/admin/ops/residential-estimate',
      ),
    ).toBe(true)
    expect(
      screen.queryByRole('button', { name: 'Send estimate email' }),
    ).not.toBeInTheDocument()
  })

  it('requires a fresh preview when services, discount, or recipient change', async () => {
    fetchMock.mockResolvedValue(response(preview))
    const view = render(<ResidentialEstimatePanel {...props} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview estimate email' }),
    )
    await screen.findByTitle('Estimate email preview')
    view.rerender(
      <ResidentialEstimatePanel
        {...props}
        input={{ ...input, discount_amount: 30 }}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Send estimate email' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Preview estimate email' }),
    ).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the same request id after an ambiguous failure, including closing and reopening preview', async () => {
    fetchMock
      .mockResolvedValueOnce(response(preview))
      .mockRejectedValueOnce(new Error('Network interrupted'))
      .mockResolvedValueOnce(response(preview))
      .mockResolvedValueOnce(
        response({ success: true, to_email: input.customer.email }),
      )
    render(<ResidentialEstimatePanel {...props} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview estimate email' }),
    )
    await screen.findByTitle('Estimate email preview')
    fireEvent.click(screen.getByRole('button', { name: 'Send estimate email' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview estimate email' }),
    )
    await screen.findByTitle('Estimate email preview')
    fireEvent.click(screen.getByRole('button', { name: 'Send estimate email' }))
    await screen.findByRole('status')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).request_id).toBe(
      JSON.parse(fetchMock.mock.calls[3][1].body).request_id,
    )
  })

  it('blocks repeated clicks while sending and shows delivery warnings', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockResolvedValueOnce(response(preview)).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    render(<ResidentialEstimatePanel {...props} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview estimate email' }),
    )
    await screen.findByTitle('Estimate email preview')
    fireEvent.click(screen.getByRole('button', { name: 'Send estimate email' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sending…' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () =>
      finish(
        response({
          success: true,
          to_email: input.customer.email,
          warning: 'Email sent; history is unavailable.',
        }),
      ),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'history is unavailable',
    )
    await waitFor(() =>
      expect(props.onBusyChange).toHaveBeenLastCalledWith(false),
    )
  })
})
