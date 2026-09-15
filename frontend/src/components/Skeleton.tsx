type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className = "" }: SkeletonProps) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

export function HomeBannerSkeleton() {
  return <Skeleton className="w-full aspect-[3/1] rounded-3xl" />;
}

export function EntitlementCardSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`bg-white dark:bg-dark-800 ${compact ? "p-5" : "p-6"} rounded-3xl shadow-card border border-silver/60 dark:border-dark-600`} aria-hidden="true">
      <div className="flex items-center gap-4 mb-4">
        <Skeleton className={`${compact ? "w-12 h-12" : "w-14 h-14"} rounded-2xl shrink-0`} />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3 rounded" />
          <Skeleton className="h-3 w-full rounded" />
        </div>
      </div>
      <Skeleton className={`${compact ? "h-12" : "h-14"} w-full rounded-2xl`} />
    </div>
  );
}

export function TrackerSkeleton() {
  return (
    <div className="space-y-2 mb-4" aria-hidden="true">
      <div className="relative p-4 rounded-xl border border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800">
        <div className="flex items-center gap-3 mb-3">
          <Skeleton className="w-9 h-9 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5 rounded" />
            <Skeleton className="h-3 w-3/5 rounded" />
          </div>
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-3 w-4/5 rounded mt-2" />
      </div>
    </div>
  );
}

export function QuickActionsSkeleton() {
  return (
    <div className="flex gap-3" aria-hidden="true">
      <Skeleton className="flex-1 h-14 rounded-2xl" />
      <Skeleton className="flex-1 h-14 rounded-2xl" />
      <Skeleton className="w-14 h-14 rounded-2xl" />
    </div>
  );
}

export function RateCardSkeleton() {
  return (
    <div className="relative overflow-hidden bg-maroon-700 dark:bg-maroon-900 p-5 rounded-3xl shadow-card-dark" aria-hidden="true">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5"><Skeleton className="w-9 h-9 rounded-xl" /><Skeleton className="h-4 w-24 rounded" /></div>
        <Skeleton className="h-3 w-16 rounded" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-[76px] rounded-2xl" />
        <Skeleton className="h-[76px] rounded-2xl" />
      </div>
    </div>
  );
}

export function ConverterSkeleton() {
  return (
    <div className="bg-white dark:bg-dark-800 p-5 rounded-3xl shadow-card border border-silver/60 dark:border-dark-600 space-y-4" aria-hidden="true">
      <div className="flex items-center justify-between"><Skeleton className="h-4 w-24 rounded" /><Skeleton className="h-8 w-24 rounded-xl" /></div>
      <div className="space-y-3"><Skeleton className="h-[74px] w-full rounded-xl" /><Skeleton className="h-[74px] w-full rounded-xl" /></div>
    </div>
  );
}

export function TransactionFrameSkeleton() {
  return (
    <div className="bg-white dark:bg-dark-800 p-5 rounded-3xl shadow-card border border-silver/60 dark:border-dark-600 space-y-4" aria-hidden="true">
      <div className="flex items-center justify-between"><Skeleton className="w-8 h-8 rounded-full" /><Skeleton className="h-4 w-32 rounded" /><Skeleton className="h-3 w-12 rounded" /></div>
      <Skeleton className="h-1.5 w-full rounded-full" />
      <Skeleton className="h-11 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3"><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /></div>
      <Skeleton className="h-12 w-full rounded-2xl" />
    </div>
  );
}

export function ServicesGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[132px] p-5 rounded-3xl" />)}
    </div>
  );
}

export function StatsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-3 gap-2">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-[70px] p-3 rounded-xl" />)}</div>
      <Skeleton className="h-[220px] w-full rounded-xl" />
      <div className="space-y-2">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-[68px] w-full p-4 rounded-2xl" />)}</div>
    </div>
  );
}

export function OyunsPlusSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="h-[146px] w-full p-5 rounded-3xl" />
      <Skeleton className="h-[78px] w-full p-4 rounded-2xl" />
      <Skeleton className="h-[180px] w-full p-4 rounded-2xl" />
    </div>
  );
}
