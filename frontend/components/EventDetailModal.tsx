"use client";

import type { TimelineEvent } from "@/lib/types";
import { EventCard } from "@/components/EventCard";

type EventDetailModalProps = {
  event: TimelineEvent;
  placedByNickname?: string | null;
  onClose: () => void;
};

export function EventDetailModal({
  event,
  placedByNickname,
  onClose,
}: EventDetailModalProps) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Event details"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-sm flex-col gap-4 overflow-auto rounded-2xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
          aria-label="Close"
        >
          ×
        </button>
        <EventCard
          event={event}
          showYear
          revealed
          titleLinksToWikipedia
          className="mx-auto w-full flex-shrink-0"
        />
        {placedByNickname != null && placedByNickname !== "" && (
          <p className="text-sm text-zinc-600">
            Placed by: <span className="font-medium">{placedByNickname}</span>
          </p>
        )}
      </div>
    </div>
  );
}
