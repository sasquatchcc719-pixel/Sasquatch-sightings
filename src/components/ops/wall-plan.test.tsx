// @vitest-environment jsdom
/**
 * A door has to answer to both a tap and a drag, and the difference is not
 * academic: tapping is how a door gets selected, and selecting is how it gets
 * deleted. This is a regression test for a door that could be dragged but never
 * selected — every tap in the middle of it read as a two-foot move.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WallPlan } from './wall-plan'

const NODES = [
  { id: 'a', x: 0, y: 0 },
  { id: 'b', x: 20, y: 0 },
]
const WALLS = [{ id: 'w1', startNodeId: 'a', endNodeId: 'b', isPartialHeight: false, label: null }]
const OPENINGS = [
  { id: 'door1', wallId: 'w1', kind: 'doorway' as const, offsetFt: 8, widthFt: 3 },
]

beforeAll(() => {
  // jsdom lays nothing out, so the plan would compute a zero scale and draw
  // nothing at all.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    value: 600,
  })
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0 }),
  })
  // Not implemented in jsdom, and the door must not care.
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => {
      throw new Error('no pointer capture here')
    },
  })
  Object.defineProperty(Element.prototype, 'releasePointerCapture', {
    configurable: true,
    value: () => {},
  })
})

/**
 * jsdom has no PointerEvent, and the fallback it substitutes drops clientX --
 * which would make every drag in this file look like a tap and quietly pass.
 * A MouseEvent carries the coordinates and React dispatches it just the same.
 */
function pointer(
  node: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
  clientY: number,
) {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  fireEvent(node, event)
}

function renderPlan(handlers: Record<string, unknown> = {}) {
  return render(
    <WallPlan
      nodes={NODES}
      walls={WALLS}
      openings={OPENINGS}
      pins={[]}
      tool="door"
      {...handlers}
    />,
  )
}

describe('tapping a door', () => {
  it('selects it rather than moving it, even where pointer capture fails', () => {
    const onSelectOpening = vi.fn()
    const onMoveOpening = vi.fn()
    renderPlan({ onSelectOpening, onMoveOpening })

    const door = screen.getByLabelText('doorway on wall')
    pointer(door, 'pointerdown', 300, 86)
    pointer(door, 'pointerup', 300, 86)

    expect(onSelectOpening).toHaveBeenCalledWith('door1')
    expect(onMoveOpening).not.toHaveBeenCalled()
  })

  it('survives the pixel or two a finger wobbles', () => {
    const onSelectOpening = vi.fn()
    const onMoveOpening = vi.fn()
    renderPlan({ onSelectOpening, onMoveOpening })

    const door = screen.getByLabelText('doorway on wall')
    pointer(door, 'pointerdown', 300, 86)
    pointer(door, 'pointermove', 302, 87)
    pointer(door, 'pointerup', 302, 87)

    expect(onSelectOpening).toHaveBeenCalledWith('door1')
    expect(onMoveOpening).not.toHaveBeenCalled()
  })
})

describe('dragging a door', () => {
  it('moves it, and does not select it', () => {
    const onSelectOpening = vi.fn()
    const onMoveOpening = vi.fn()
    renderPlan({ onSelectOpening, onMoveOpening })

    const door = screen.getByLabelText('doorway on wall')
    pointer(door, 'pointerdown', 300, 86)
    pointer(door, 'pointermove', 200, 86)
    pointer(door, 'pointerup', 200, 86)

    expect(onMoveOpening).toHaveBeenCalled()
    expect(onSelectOpening).not.toHaveBeenCalled()
  })
})

describe('deleting a selected door', () => {
  it('offers delete on the door itself', () => {
    const onDeleteOpening = vi.fn()
    renderPlan({ selectedOpeningId: 'door1', onDeleteOpening })

    fireEvent.click(screen.getByLabelText('Delete this doorway'))
    expect(onDeleteOpening).toHaveBeenCalledWith('door1')
  })

  it('offers nothing to delete when nothing is selected', () => {
    renderPlan({ onDeleteOpening: vi.fn() })
    expect(screen.queryByLabelText('Delete this doorway')).toBeNull()
  })
})

describe('tapping where a door already is', () => {
  it('does not drop a second door on top of the first', () => {
    const onPlaceDoor = vi.fn()
    const onSelectOpening = vi.fn()
    renderPlan({ onPlaceDoor, onSelectOpening })

    const door = screen.getByLabelText('doorway on wall')
    pointer(door, 'pointerdown', 300, 86)
    pointer(door, 'pointerup', 300, 86)
    fireEvent.click(door, { clientX: 300, clientY: 86 })

    expect(onPlaceDoor).not.toHaveBeenCalled()
    expect(onSelectOpening).toHaveBeenCalledWith('door1')
  })

  it('selects the door already there when the tap lands on the wall', () => {
    const onPlaceDoor = vi.fn()
    const onSelectOpening = vi.fn()
    const { container } = renderPlan({ onPlaceDoor, onSelectOpening })

    // The wall runs along y = 0, and the door covers 8ft to 11ft of it.
    const plan = container.firstElementChild as Element
    fireEvent.click(plan, { clientX: 300, clientY: 86 })

    expect(onPlaceDoor).not.toHaveBeenCalled()
    expect(onSelectOpening).toHaveBeenCalledWith('door1')
  })

  it('still places a door on clear wall', () => {
    const onPlaceDoor = vi.fn()
    const { container } = renderPlan({ onPlaceDoor })

    const plan = container.firstElementChild as Element
    fireEvent.click(plan, { clientX: 120, clientY: 86 })

    expect(onPlaceDoor).toHaveBeenCalled()
  })
})
