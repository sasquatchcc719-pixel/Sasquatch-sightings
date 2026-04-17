export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="bg-muted h-8 w-48 animate-pulse rounded-md" />
      <div className="bg-card space-y-4 rounded-xl border p-6">
        <div className="bg-muted h-5 w-32 animate-pulse rounded" />
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-muted h-10 animate-pulse rounded" />
          <div className="bg-muted h-10 animate-pulse rounded" />
        </div>
        <div className="bg-muted h-10 animate-pulse rounded" />
        <div className="bg-muted h-10 animate-pulse rounded" />
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted h-9 animate-pulse rounded" />
          <div className="bg-muted h-9 animate-pulse rounded" />
          <div className="bg-muted h-9 animate-pulse rounded" />
        </div>
      </div>
      <div className="bg-card space-y-3 rounded-xl border p-6">
        <div className="bg-muted h-5 w-24 animate-pulse rounded" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-muted h-14 animate-pulse rounded" />
        ))}
      </div>
    </div>
  )
}
