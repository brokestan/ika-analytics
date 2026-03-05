export default function Loading() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="shimmer h-8 w-64 rounded-lg" />
          <div className="shimmer h-4 w-40 rounded" />
        </div>
        <div className="shimmer h-9 w-24 rounded-xl" />
      </div>
      <div className="grid-dashboard">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card p-5 space-y-3">
            <div className="flex justify-between">
              <div className="shimmer h-3 w-24 rounded" />
              <div className="shimmer h-7 w-7 rounded-lg" />
            </div>
            <div className="shimmer h-8 w-28 rounded" />
            <div className="shimmer h-3 w-16 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5 space-y-3">
          <div className="shimmer h-5 w-40 rounded" />
          <div className="shimmer h-64 rounded-xl" />
        </div>
        <div className="card p-5 space-y-3">
          <div className="shimmer h-5 w-40 rounded" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="shimmer h-16 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
