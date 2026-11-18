'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Pin,
  RotateCcw,
  Save,
  Smartphone,
  Undo2,
  Monitor,
} from 'lucide-react'
import {
  DEFAULT_NAVIGATION_PREFERENCES,
  NAVIGATION_ITEM_BY_ID,
  NAVIGATION_SECTIONS,
  cloneNavigationPreferences,
  type NavigationItem,
  type NavigationPreferences,
  type NavigationSectionId,
  type NavigationSurfaceLayout,
} from '@/lib/admin-navigation'
import { NavigationIcon } from '@/components/admin/navigation-icons'

type Surface = 'desktop' | 'mobile'
type EditableSurfaceLayout = NavigationSurfaceLayout & {
  shortcuts?: string[]
  bottom?: string[]
  shortcutAfter?: NavigationSectionId | 'start' | 'end'
}

function moveInArray(values: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || to >= values.length) return values
  const next = [...values]
  const [value] = next.splice(from, 1)
  next.splice(to, 0, value)
  return next
}

function DragGrip({
  item,
  onMove,
}: {
  item: NavigationItem
  onMove: (section: NavigationSectionId, index: number) => void
}) {
  return (
    <button
      type="button"
      aria-label={`Drag ${item.name}`}
      title="Drag to another position or section"
      className="flex h-11 w-11 flex-shrink-0 cursor-grab touch-none items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white active:cursor-grabbing"
      style={{ touchAction: 'none' }}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.isPrimary === false) return
        event.preventDefault()
        const button = event.currentTarget
        const card = button.closest<HTMLElement>('[data-nav-card]')
        if (!card) return
        const pointerId = event.pointerId
        const startX = event.clientX
        const startY = event.clientY
        let ghost: HTMLElement | null = null
        let target: { section: NavigationSectionId; index: number } | null =
          null

        const removeGhost = () => {
          ghost?.remove()
          ghost = null
        }
        const updateTarget = (clientX: number, clientY: number) => {
          const element = document.elementFromPoint(clientX, clientY)
          const list = element?.closest<HTMLElement>('[data-nav-list-section]')
          const section = list?.dataset.navListSection as
            | NavigationSectionId
            | undefined
          if (!list || !section) {
            target = null
            return
          }
          const cards = Array.from(
            list.querySelectorAll<HTMLElement>(':scope > [data-nav-card]'),
          ).filter((candidate) => candidate.dataset.navItemId !== item.id)
          const hovered = element?.closest<HTMLElement>('[data-nav-card]')
          let index = cards.length
          if (hovered && hovered.dataset.navItemId !== item.id) {
            const hoveredIndex = cards.indexOf(hovered)
            if (hoveredIndex >= 0) {
              const bounds = hovered.getBoundingClientRect()
              index =
                hoveredIndex +
                (clientY > bounds.top + bounds.height / 2 ? 1 : 0)
            }
          }
          target = { section, index }
        }
        const moveGhost = (clientX: number, clientY: number) => {
          if (!ghost) return
          ghost.style.left = `${clientX + 12}px`
          ghost.style.top = `${clientY + 12}px`
        }
        const onPointerMove = (pointer: PointerEvent) => {
          if (pointer.pointerId !== pointerId) return
          if (
            !ghost &&
            Math.hypot(pointer.clientX - startX, pointer.clientY - startY) < 5
          )
            return
          if (pointer.cancelable) pointer.preventDefault()
          if (!ghost) {
            ghost = card.cloneNode(true) as HTMLElement
            Object.assign(ghost.style, {
              position: 'fixed',
              zIndex: '1000',
              width: `${card.getBoundingClientRect().width}px`,
              pointerEvents: 'none',
              opacity: '0.96',
              boxShadow: '0 18px 45px rgba(0,0,0,0.45)',
              outline: '2px solid #22d3ee',
            })
            document.body.appendChild(ghost)
          }
          moveGhost(pointer.clientX, pointer.clientY)
          updateTarget(pointer.clientX, pointer.clientY)
        }
        const finish = (pointer?: PointerEvent) => {
          if (pointer && pointer.pointerId !== pointerId) return
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', cancel)
          window.removeEventListener('blur', cancel)
          removeGhost()
          if (target) onMove(target.section, target.index)
        }
        const cancel = () => {
          target = null
          finish()
        }
        window.addEventListener('pointermove', onPointerMove, {
          passive: false,
        })
        window.addEventListener('pointerup', finish)
        window.addEventListener('pointercancel', cancel)
        window.addEventListener('blur', cancel)
      }}
    >
      <GripVertical className="h-5 w-5" />
    </button>
  )
}

function NavCard({
  item,
  section,
  index,
  count,
  hidden,
  pinned,
  pinLabel,
  pinDisabled,
  onMove,
  onStep,
  onSectionChange,
  onToggleHidden,
  onTogglePinned,
}: {
  item: NavigationItem
  section: NavigationSectionId
  index: number
  count: number
  hidden: boolean
  pinned: boolean
  pinLabel: string
  pinDisabled: boolean
  onMove: (section: NavigationSectionId, index: number) => void
  onStep: (direction: -1 | 1) => void
  onSectionChange: (section: NavigationSectionId) => void
  onToggleHidden: () => void
  onTogglePinned: () => void
}) {
  return (
    <div
      data-nav-card
      data-nav-item-id={item.id}
      className={`rounded-xl border p-2.5 transition-colors ${
        hidden
          ? 'border-white/5 bg-slate-950/25 opacity-60'
          : 'border-white/10 bg-white/[0.06]'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <DragGrip item={item} onMove={onMove} />
        <NavigationIcon
          name={item.icon}
          className="h-5 w-5 flex-shrink-0 text-emerald-400"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">
            {item.name}
          </p>
          <p className="truncate text-xs text-slate-400">{item.description}</p>
        </div>
        <button
          type="button"
          onClick={onToggleHidden}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:bg-white/10"
          aria-label={`${hidden ? 'Show' : 'Hide'} ${item.name}`}
          title={hidden ? 'Show in this menu' : 'Hide from this menu'}
        >
          {hidden ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-[54px]">
        <select
          aria-label={`Section for ${item.name}`}
          value={section}
          onChange={(event) =>
            onSectionChange(event.target.value as NavigationSectionId)
          }
          className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-2 text-xs text-slate-200"
        >
          {Object.entries(NAVIGATION_SECTIONS).map(([id, details]) => (
            <option key={id} value={id}>
              {details.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={index === 0}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-300 disabled:opacity-25"
          aria-label={`Move ${item.name} up`}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onStep(1)}
          disabled={index === count - 1}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-300 disabled:opacity-25"
          aria-label={`Move ${item.name} down`}
        >
          <ArrowDown className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onTogglePinned}
          disabled={pinDisabled}
          className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-35 ${
            pinned
              ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-100'
              : 'border-white/10 bg-white/5 text-slate-300'
          }`}
          title={
            pinDisabled ? 'All available positions are already used' : pinLabel
          }
        >
          {pinned ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Pin className="h-3.5 w-3.5" />
          )}
          {pinLabel}
        </button>
      </div>
    </div>
  )
}

function PinnedOrder({
  title,
  description,
  ids,
  onChange,
}: {
  title: string
  description: string
  ids: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <section className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.06] p-4">
      <h2 className="text-base font-semibold text-cyan-100">{title}</h2>
      <p className="mt-1 text-xs text-slate-400">{description}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {ids.length === 0 && (
          <p className="text-sm text-slate-500">Nothing pinned yet.</p>
        )}
        {ids.map((id, index) => {
          const item = NAVIGATION_ITEM_BY_ID[id]
          if (!item) return null
          return (
            <div
              key={id}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2"
            >
              <NavigationIcon
                name={item.icon}
                className="h-4 w-4 text-cyan-300"
              />
              <span className="text-sm text-slate-100">
                {item.shortName ?? item.name}
              </span>
              <button
                type="button"
                onClick={() => onChange(moveInArray(ids, index, index - 1))}
                disabled={index === 0}
                className="text-slate-400 disabled:opacity-20"
                aria-label={`Move ${item.name} left`}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onChange(moveInArray(ids, index, index + 1))}
                disabled={index === ids.length - 1}
                className="text-slate-400 disabled:opacity-20"
                aria-label={`Move ${item.name} right`}
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function NavigationLayoutEditor({
  initialPreferences,
}: {
  initialPreferences: NavigationPreferences
}) {
  const router = useRouter()
  const [surface, setSurface] = useState<Surface>('desktop')
  const [saved, setSaved] = useState(() =>
    cloneNavigationPreferences(initialPreferences),
  )
  const [draft, setDraft] = useState(() =>
    cloneNavigationPreferences(initialPreferences),
  )
  const [status, setStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error' | 'resetting'
  >('idle')
  const isDirty = useMemo(
    () => JSON.stringify(saved) !== JSON.stringify(draft),
    [saved, draft],
  )
  const layout = draft[surface]
  const pinned =
    surface === 'desktop' ? draft.desktop.shortcuts : draft.mobile.bottom
  const pinLimit = surface === 'desktop' ? 5 : 4

  function updateSurface(update: (current: EditableSurfaceLayout) => void) {
    setDraft((current) => {
      const next = cloneNavigationPreferences(current)
      update(next[surface])
      return next
    })
    setStatus('idle')
  }

  function moveItem(
    id: string,
    targetSection: NavigationSectionId,
    targetIndex: number,
  ) {
    updateSurface((current) => {
      for (const section of current.sectionOrder) {
        current.sections[section] = current.sections[section].filter(
          (itemId) => itemId !== id,
        )
      }
      current.sections[targetSection].splice(targetIndex, 0, id)
    })
  }

  function toggleHidden(id: string) {
    updateSurface((current) => {
      current.hidden = current.hidden.includes(id)
        ? current.hidden.filter((itemId) => itemId !== id)
        : [...current.hidden, id]
    })
  }

  function togglePinned(id: string) {
    updateSurface((current) => {
      const values =
        surface === 'desktop'
          ? (current.shortcuts ?? [])
          : (current.bottom ?? [])
      const nextValues = values.includes(id)
        ? values.filter((itemId) => itemId !== id)
        : values.length < pinLimit
          ? [...values, id]
          : values
      if (surface === 'desktop') current.shortcuts = nextValues
      else current.bottom = nextValues
    })
  }

  async function save() {
    setStatus('saving')
    const response = await fetch('/api/admin/navigation-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: draft }),
    })
    if (!response.ok) {
      setStatus('error')
      return
    }
    const body = (await response.json()) as {
      preferences: NavigationPreferences
    }
    setSaved(cloneNavigationPreferences(body.preferences))
    setDraft(cloneNavigationPreferences(body.preferences))
    setStatus('saved')
    router.refresh()
  }

  async function resetDefaults() {
    if (!window.confirm('Restore the original desktop and mobile navigation?'))
      return
    setStatus('resetting')
    const response = await fetch('/api/admin/navigation-preferences', {
      method: 'DELETE',
    })
    if (!response.ok) {
      setStatus('error')
      return
    }
    const defaults = cloneNavigationPreferences(DEFAULT_NAVIGATION_PREFERENCES)
    setSaved(defaults)
    setDraft(cloneNavigationPreferences(defaults))
    setStatus('saved')
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-7xl text-slate-100">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-cyan-300 uppercase">
            Personal layout
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
            Navigation editor
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">
            These changes affect only your account. Drag from a grip, use the
            section picker, or use the arrow buttons. Hiding a screen removes
            only its menu link—not the screen itself.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDraft(cloneNavigationPreferences(saved))}
            disabled={!isDirty || status === 'saving'}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 disabled:opacity-35"
          >
            <Undo2 className="h-4 w-4" />
            Cancel changes
          </button>
          <button
            type="button"
            onClick={() => void resetDefaults()}
            disabled={status === 'saving' || status === 'resetting'}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 disabled:opacity-35"
          >
            <RotateCcw className="h-4 w-4" />
            Restore defaults
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!isDirty || status === 'saving' || status === 'resetting'}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-5 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-950/30 disabled:opacity-40"
          >
            {status === 'saving' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save layout
          </button>
        </div>
      </div>

      <div className="mt-4 min-h-6 text-sm" role="status" aria-live="polite">
        {status === 'saved' && (
          <span className="text-emerald-300">Saved to your account.</span>
        )}
        {status === 'error' && (
          <span className="text-red-300">Could not save. Try again.</span>
        )}
      </div>

      <div className="mt-2 inline-flex rounded-xl border border-white/10 bg-slate-950/50 p-1">
        {(['desktop', 'mobile'] as const).map((value) => {
          const Icon = value === 'desktop' ? Monitor : Smartphone
          return (
            <button
              key={value}
              type="button"
              onClick={() => setSurface(value)}
              className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold capitalize transition-colors ${
                surface === value
                  ? 'bg-cyan-400/20 text-cyan-100'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              {value}
            </button>
          )
        })}
      </div>

      <div className="mt-5">
        <PinnedOrder
          title={surface === 'desktop' ? 'Top buttons' : 'Mobile bottom bar'}
          description={
            surface === 'desktop'
              ? 'Up to five one-tap shortcuts beside the dropdowns.'
              : 'Up to four shortcuts. The GPS clock stays in the center when enabled.'
          }
          ids={pinned}
          onChange={(ids) =>
            updateSurface((current) => {
              if (surface === 'desktop') current.shortcuts = ids
              else current.bottom = ids
            })
          }
        />
        {surface === 'desktop' && (
          <label className="mt-3 flex max-w-sm items-center gap-3 text-sm text-slate-300">
            Place top buttons
            <select
              value={draft.desktop.shortcutAfter}
              onChange={(event) =>
                updateSurface((current) => {
                  current.shortcutAfter = event.target.value as
                    | NavigationSectionId
                    | 'start'
                    | 'end'
                })
              }
              className="h-9 flex-1 rounded-lg border border-white/10 bg-slate-900 px-2 text-sm text-slate-100"
            >
              <option value="start">Before all groups</option>
              {layout.sectionOrder.map((sectionId) => (
                <option key={sectionId} value={sectionId}>
                  After {NAVIGATION_SECTIONS[sectionId].label}
                </option>
              ))}
              <option value="end">After all groups</option>
            </select>
          </label>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {layout.sectionOrder.map((sectionId, index) => {
          const section = NAVIGATION_SECTIONS[sectionId]
          return (
            <div
              key={sectionId}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
            >
              <NavigationIcon
                name={section.icon}
                className="h-4 w-4 text-emerald-400"
              />
              <span className="text-sm font-semibold">{section.label}</span>
              <button
                type="button"
                onClick={() =>
                  updateSurface((current) => {
                    current.sectionOrder = moveInArray(
                      current.sectionOrder,
                      index,
                      index - 1,
                    ) as NavigationSectionId[]
                  })
                }
                disabled={index === 0}
                className="text-slate-400 disabled:opacity-20"
                aria-label={`Move ${section.label} left`}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  updateSurface((current) => {
                    current.sectionOrder = moveInArray(
                      current.sectionOrder,
                      index,
                      index + 1,
                    ) as NavigationSectionId[]
                  })
                }
                disabled={index === layout.sectionOrder.length - 1}
                className="text-slate-400 disabled:opacity-20"
                aria-label={`Move ${section.label} right`}
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {layout.sectionOrder.map((sectionId) => {
          const section = NAVIGATION_SECTIONS[sectionId]
          const ids = layout.sections[sectionId]
          return (
            <section
              key={sectionId}
              className="rounded-2xl border border-white/10 bg-slate-950/35 p-3 sm:p-4"
            >
              <div className="mb-3 flex items-center gap-2 px-1">
                <NavigationIcon
                  name={section.icon}
                  className="h-5 w-5 text-emerald-400"
                />
                <h2 className="font-semibold">{section.label}</h2>
                <span className="ml-auto text-xs text-slate-500">
                  {ids.length} screens
                </span>
              </div>
              <div
                data-nav-list-section={sectionId}
                className="min-h-14 space-y-2"
              >
                {ids.map((id, index) => {
                  const item = NAVIGATION_ITEM_BY_ID[id]
                  if (!item) return null
                  return (
                    <NavCard
                      key={id}
                      item={item}
                      section={sectionId}
                      index={index}
                      count={ids.length}
                      hidden={layout.hidden.includes(id)}
                      pinned={pinned.includes(id)}
                      pinLabel={
                        surface === 'desktop' ? 'Top button' : 'Bottom bar'
                      }
                      pinDisabled={
                        !pinned.includes(id) && pinned.length >= pinLimit
                      }
                      onMove={(targetSection, targetIndex) =>
                        moveItem(id, targetSection, targetIndex)
                      }
                      onStep={(direction) =>
                        moveItem(id, sectionId, index + direction)
                      }
                      onSectionChange={(targetSection) =>
                        moveItem(
                          id,
                          targetSection,
                          layout.sections[targetSection].length,
                        )
                      }
                      onToggleHidden={() => toggleHidden(id)}
                      onTogglePinned={() => togglePinned(id)}
                    />
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
