export default function Loading() {
  return (
    <div className="flex flex-col h-screen">
      {/* Header Skeleton */}
      <header className="bg-white border-b z-20 shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="h-8 w-64 bg-gray-200 animate-pulse rounded" />
            <div className="h-10 w-32 bg-gray-200 animate-pulse rounded" />
          </div>
        </div>
      </header>

      {/* Map Loading State */}
      <main className="flex-1 relative bg-gray-100">
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-green-600 border-r-transparent mb-4" />
            <p className="text-gray-600 font-medium">Loading map...</p>
          </div>
        </div>
      </main>

      {/* Info Bar Skeleton */}
      <div className="bg-green-600 py-3 px-4 z-10">
        <div className="container mx-auto">
          <div className="h-5 bg-green-500 animate-pulse rounded" />
        </div>
      </div>
    </div>
  );
}
