import { useState } from 'react'
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLineItemReorder } from './line-item-reorder'

function Example() {
  const [rows, setRows] = useState([
    { id: 'a', value: 'Bedroom' },
    { id: 'b', value: 'Hallway' },
    { id: 'c', value: 'Steps' },
  ])
  const reorder = useLineItemReorder(rows, setRows, (row) => row.id)
  return (
    <>
      {reorder.status}
      {rows.map((row, index) => (
        <section
          key={row.id}
          {...reorder.cardProps(row.id)}
          aria-label={row.id}
        >
          {reorder.handle(row.id, index, row.value)}
          <input aria-label={`Name ${row.id}`} defaultValue={row.value} />
        </section>
      ))}
    </>
  )
}
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document.documentElement, 'scrollHeight')
})
beforeEach(() => {
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => null),
  })
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
function pointer(
  type: string,
  values: {
    pointerId?: number
    pointerType?: string
    clientY?: number
    clientX?: number
  } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...values,
  })
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId ?? 7 },
    pointerType: { value: values.pointerType ?? 'touch' },
    isPrimary: { value: true },
  })
  return event
}
const order = () =>
  screen.getAllByRole('region').map((el) => el.getAttribute('aria-label'))

describe('line item corner grip', () => {
  it('moves a focused card with arrow keys and retains unsaved input values', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    render(<Example />)
    fireEvent.change(screen.getByLabelText('Name a'), {
      target: { value: 'Main bedroom' },
    })
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Reorder line 1: Bedroom' }),
      { key: 'ArrowDown' },
    )
    expect(order()).toEqual(['b', 'a', 'c'])
    expect((screen.getByLabelText('Name a') as HTMLInputElement).value).toBe(
      'Main bedroom',
    )
    expect(screen.getByRole('status').textContent).toContain('position 2 of 3')
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Reorder line 2: Bedroom' }),
      { key: 'ArrowUp' },
    )
    expect(order()).toEqual(['a', 'b', 'c'])
  })
  it('drags only from the grip and moves after crossing the destination midpoint', () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    render(<Example />)
    const destination = screen.getByRole('region', { name: 'c' })
    vi.spyOn(destination, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      height: 100,
    } as DOMRect)
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => destination),
    })
    fireEvent.pointerDown(screen.getByLabelText('Name a'), { button: 0 })
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 290 }))
    expect(order()).toEqual(['a', 'b', 'c'])
    fireEvent(
      screen.getByRole('button', { name: 'Reorder line 1: Bedroom' }),
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 10 }),
    )
    fireEvent(window, new MouseEvent('pointermove', { clientY: 220 }))
    expect(order()).toEqual(['a', 'b', 'c'])
    fireEvent(window, new MouseEvent('pointermove', { clientY: 290 }))
    expect(order()).toEqual(['b', 'c', 'a'])
    expect(within(destination).getByLabelText('Name c')).toBeTruthy()
    fireEvent(window, new MouseEvent('pointerup'))
    fireEvent(window, new MouseEvent('pointermove', { clientY: 290 }))
    expect(order()).toEqual(['b', 'c', 'a'])
  })

  it('moves the real card with a finger before reordering and keeps the grabbed corner anchored after reordering', () => {
    render(<Example />)
    const card = screen.getByRole('region', { name: 'a' })
    const grip = screen.getByRole('button', { name: 'Reorder line 1: Bedroom' })
    const input = screen.getByLabelText('Name a')
    const capture = vi.fn()
    card.parentElement!.setPointerCapture = capture
    for (const region of screen.getAllByRole('region')) {
      vi.spyOn(region, 'getBoundingClientRect').mockImplementation(
        () =>
          ({
            left: 0,
            top: order().indexOf(region.getAttribute('aria-label')) * 100,
            width: 300,
            height: 100,
          }) as DOMRect,
      )
    }
    fireEvent.change(input, { target: { value: 'Unsaved bedroom name' } })
    expect(grip.style.touchAction).toBe('none')
    fireEvent(grip, pointer('pointerdown', { clientX: 280, clientY: 20 }))
    expect(capture).toHaveBeenCalledWith(7)
    fireEvent(window, pointer('pointermove', { clientX: 280, clientY: 23 }))
    expect(card.style.transform).toBe('')
    fireEvent(window, pointer('pointermove', { clientX: 275, clientY: 90 }))
    expect(card.style.transform).toBe('translate3d(-5px, 70px, 0)')
    expect(card.style.pointerEvents).toBe('none')
    expect(card.dataset.reorderDragging).toBe('true')
    expect(order()).toEqual(['a', 'b', 'c'])

    vi.mocked(document.elementFromPoint).mockReturnValue(
      screen.getByRole('region', { name: 'c' }),
    )
    fireEvent(window, pointer('pointermove', { clientX: 275, clientY: 290 }))
    expect(order()).toEqual(['b', 'c', 'a'])
    expect(card.style.transform).toBe('translate3d(-5px, 70px, 0)')
    expect(screen.getByLabelText('Name a')).toBe(input)
    expect((input as HTMLInputElement).value).toBe('Unsaved bedroom name')
    fireEvent(window, pointer('pointerup'))
    expect(card.getAttribute('style')).toBeNull()
    expect(card.dataset.reorderDragging).toBeUndefined()
    expect(order()).toEqual(['b', 'c', 'a'])
  })

  it('ignores other fingers and restores the original order when the active touch is cancelled', () => {
    render(<Example />)
    const card = screen.getByRole('region', { name: 'a' })
    const destination = screen.getByRole('region', { name: 'c' })
    vi.spyOn(destination, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      height: 100,
    } as DOMRect)
    vi.mocked(document.elementFromPoint).mockReturnValue(destination)
    fireEvent(
      screen.getByRole('button', { name: 'Reorder line 1: Bedroom' }),
      pointer('pointerdown', { clientY: 10 }),
    )
    fireEvent(window, pointer('pointermove', { pointerId: 99, clientY: 290 }))
    expect(card.style.transform).toBe('')
    expect(order()).toEqual(['a', 'b', 'c'])
    fireEvent(window, pointer('pointermove', { clientY: 290 }))
    expect(order()).toEqual(['b', 'c', 'a'])
    fireEvent(window, pointer('pointerup', { pointerId: 99 }))
    expect(card.dataset.reorderDragging).toBe('true')
    fireEvent(window, pointer('pointercancel'))
    expect(order()).toEqual(['a', 'b', 'c'])
    expect(card.getAttribute('style')).toBeNull()
    fireEvent(window, pointer('pointermove', { clientY: 290 }))
    expect(order()).toEqual(['a', 'b', 'c'])
    expect(screen.getByRole('status').textContent).toContain('cancelled')
  })

  it('cleans up a lifted card on Escape and unmount', () => {
    const { unmount } = render(<Example />)
    const card = screen.getByRole('region', { name: 'a' })
    const grip = screen.getByRole('button', { name: 'Reorder line 1: Bedroom' })
    fireEvent(grip, pointer('pointerdown', { clientY: 20 }))
    fireEvent(window, pointer('pointermove', { clientY: 80 }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(card.getAttribute('style')).toBeNull()
    fireEvent(grip, pointer('pointerdown', { clientY: 20 }))
    fireEvent(window, pointer('pointermove', { clientY: 80 }))
    unmount()
    expect(card.getAttribute('style')).toBeNull()
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })

  it('bounds edge scrolling to the content range before the card was lifted', () => {
    let frame: FrameRequestCallback = () => {}
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback
        return 1
      }),
    )
    vi.stubGlobal('innerHeight', 600)
    vi.stubGlobal('scrollY', 388)
    let contentHeight = 1000
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      get: () => contentHeight,
    })
    const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    render(<Example />)
    fireEvent(
      screen.getByRole('button', { name: 'Reorder line 3: Steps' }),
      pointer('pointerdown', { clientY: 510 }),
    )
    fireEvent(window, pointer('pointermove', { clientY: 590 }))
    // Transformed overflow must not become new room for auto-scrolling.
    contentHeight = 5000
    frame(1)
    expect(scroll).toHaveBeenLastCalledWith({ top: 12, behavior: 'instant' })
    vi.stubGlobal('scrollY', 400)
    scroll.mockClear()
    frame(2)
    expect(scroll).not.toHaveBeenCalled()
    fireEvent(window, pointer('pointerup'))
  })

  it('continues when touch capture transfers from the grip, but cancels if the stable list loses capture', () => {
    render(<Example />)
    const card = screen.getByRole('region', { name: 'a' })
    const grip = screen.getByRole('button', { name: 'Reorder line 1: Bedroom' })
    fireEvent(grip, pointer('pointerdown', { clientY: 20 }))
    fireEvent(window, pointer('pointermove', { clientY: 80 }))
    fireEvent(grip, pointer('lostpointercapture'))
    expect(card.dataset.reorderDragging).toBe('true')
    fireEvent(card.parentElement!, pointer('lostpointercapture'))
    expect(card.getAttribute('style')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('cancelled')
  })

  it('does not swap a card back when pointer moves are batched before rendering', () => {
    render(<Example />)
    const destination = screen.getByRole('region', { name: 'c' })
    vi.spyOn(destination, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      height: 100,
    } as DOMRect)
    vi.mocked(document.elementFromPoint).mockReturnValue(destination)
    fireEvent(
      screen.getByRole('button', { name: 'Reorder line 1: Bedroom' }),
      pointer('pointerdown', { clientY: 10 }),
    )
    act(() => {
      fireEvent(window, pointer('pointermove', { clientY: 290 }))
      fireEvent(window, pointer('pointermove', { clientY: 295 }))
    })
    expect(order()).toEqual(['b', 'c', 'a'])
    fireEvent(window, pointer('pointerup'))
  })
})
