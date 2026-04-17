export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="bg-muted h-8 w-52 animate-pulse rounded-md" />
      <div className="bg-card space-y-4 rounded-xl border p-6">
        <div className="bg-muted h-5 w-40 animate-pulse rounded" />
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-muted h-10 animate-pulse rounded" />
          <div className="bg-muted h-10 animate-pulse rounded" />
        </div>
        <div className="bg-muted h-10 animate-pulse rounded" />
      </div>
      <div className="bg-card space-y-3 rounded-xl border p-6">
        <div className="bg-muted h-5 w-28 animate-pulse rounded" />
        {[...Array(2)].map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="bg-muted h-10 flex-1 animate-pulse rounded" />
            <div className="bg-muted h-10 w-20 animate-pulse rounded" />
            <div className="bg-muted h-10 w-24 animate-pulse rounded" />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-3">
        <div className="bg-muted h-9 w-28 animate-pulse rounded" />
        <div className="bg-muted h-9 w-28 animate-pulse rounded" />
      </div>
    </div>
  )
}
