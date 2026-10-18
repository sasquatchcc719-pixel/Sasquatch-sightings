'use client'

import Image from 'next/image'
import { Check, Sparkles } from 'lucide-react'
import { getServicePhoto } from '@/lib/ops/service-photos'

type CategoryService = {
  name: string
  slug?: string | null
  category?: string | null
}

export function ServiceCategoryPicker({
  categories,
  services,
  value,
  onChange,
}: {
  categories: string[]
  services: CategoryService[]
  value: string
  onChange: (category: string) => void
}) {
  return (
    <fieldset className="@container min-w-0">
      <legend className="mb-2 text-sm font-semibold">
        Choose a service category
      </legend>
      <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-3 @4xl:grid-cols-4">
        {categories.map((category) => {
          const categoryServices = services.filter(
            (service) =>
              service.slug !== 'discount' &&
              ((service.category || '').trim() || 'Other') === category,
          )
          const photo =
            getServicePhoto({ name: category, category }) ??
            categoryServices
              .map((service) => getServicePhoto(service))
              .find(Boolean)
          const selected = value === category
          const count = categoryServices.length

          return (
            <button
              key={category}
              type="button"
              aria-pressed={selected}
              aria-label={`${category}, ${count} service${count === 1 ? '' : 's'}`}
              onClick={() => onChange(category)}
              className={`focus-visible:ring-ring relative flex min-h-20 min-w-0 items-center gap-2 rounded-xl border-2 p-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none ${
                selected
                  ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500 dark:bg-emerald-950/40'
                  : 'border-border/70 bg-background hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20'
              }`}
            >
              {photo ? (
                <Image
                  src={photo.src}
                  alt=""
                  width={56}
                  height={56}
                  className={`h-12 w-12 shrink-0 rounded-lg sm:h-14 sm:w-14 ${photo.contain ? 'bg-white object-contain' : 'object-cover'}`}
                />
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-100 to-teal-50 text-emerald-700 sm:h-14 sm:w-14 dark:from-emerald-900 dark:to-teal-950 dark:text-emerald-300">
                  <Sparkles className="h-6 w-6" aria-hidden="true" />
                </span>
              )}
              <span className="min-w-0 flex-1 pr-2">
                <span className="block text-xs leading-snug font-semibold break-words sm:text-sm">
                  {category}
                </span>
                <span className="text-muted-foreground mt-1 block text-[11px]">
                  {count} service{count === 1 ? '' : 's'}
                </span>
              </span>
              {selected ? (
                <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <Check className="h-3 w-3" aria-hidden="true" />
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
