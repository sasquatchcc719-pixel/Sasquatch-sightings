import { useState } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  vi.unstubAllGlobals()
})
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
})
