export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      {/* Header card */}
      <div className="bg-card space-y-4 rounded-xl border p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="bg-muted h-3 w-32 animate-pulse rounded" />
            <div className="bg-muted h-8 w-64 animate-pulse rounded" />
            <div className="bg-muted h-4 w-44 animate-pulse rounded" />
          </div>
          <div className="space-y-2 text-right">
            <div className="bg-muted h-6 w-20 animate-pulse rounded" />
            <div className="bg-muted h-8 w-28 animate-pulse rounded" />
          </div>
        </div>
        <div className="bg-muted h-10 w-full animate-pulse rounded" />
      </div>

      {/* Schedule card */}
      <div className="bg-card space-y-3 rounded-xl border p-6">
        <div className="bg-muted h-5 w-36 animate-pulse rounded" />
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted h-10 animate-pulse rounded" />
          <div className="bg-muted h-10 animate-pulse rounded" />
          <div className="bg-muted h-10 animate-pulse rounded" />
        </div>
      </div>

      {/* Line items card */}
      <div className="bg-card space-y-4 rounded-xl border p-6">
        <div className="bg-muted h-5 w-28 animate-pulse rounded" />
        {[...Array(2)].map((_, i) => (
          <div key={i} className="space-y-2 rounded-md border p-3">
            <div className="bg-muted h-4 w-16 animate-pulse rounded" />
            <div className="grid grid-cols-6 gap-2">
              <div className="bg-muted col-span-3 h-9 animate-pulse rounded" />
              <div className="bg-muted col-span-3 h-9 animate-pulse rounded" />
            </div>
            <div className="bg-muted h-16 animate-pulse rounded" />
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="bg-muted h-9 w-32 animate-pulse rounded" />
        <div className="bg-muted h-9 w-28 animate-pulse rounded" />
      </div>
    </div>
  )
}
