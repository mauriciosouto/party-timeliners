"use client";

type StreakMilestoneBannerProps = {
  message: string | null;
  className?: string;
};

/** Fixed celebratory line; message lifecycle handled by useStreakMilestoneCallout. */
export function StreakMilestoneBanner({ message, className = "" }: StreakMilestoneBannerProps) {
  if (!message) return null;
  return (
    <div
      className={`pointer-events-none fixed left-1/2 top-20 z-[25] flex w-full max-w-md -translate-x-1/2 justify-center px-4 sm:top-24 ${className}`}
      role="status"
      aria-live="polite"
    >
      <span className="streak-milestone-callout rounded-full border border-amber-200/90 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-2 text-center text-sm font-bold tracking-tight text-amber-950 shadow-lg ring-2 ring-amber-100/80">
        {message}
      </span>
    </div>
  );
}
