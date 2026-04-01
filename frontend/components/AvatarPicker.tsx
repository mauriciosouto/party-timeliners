"use client";

import Image from "next/image";
import { AVAILABLE_AVATARS } from "@/lib/avatars";

type AvatarPickerProps = {
  selectedAvatar: string | null;
  onSelect: (avatar: string) => void;
  "aria-label"?: string;
  /** When true, grid uses full width and more columns (e.g. create room). When false, compact centered 5-column layout (e.g. join room). */
  fullWidth?: boolean;
};

export function AvatarPicker({
  selectedAvatar,
  onSelect,
  "aria-label": ariaLabel = "Choose an avatar",
  fullWidth = false,
}: AvatarPickerProps) {
  return (
    <div
      className={
        fullWidth
          ? "avatar-grid grid w-full grid-cols-6 gap-2 sm:grid-cols-8 md:grid-cols-9 lg:grid-cols-10"
          : "avatar-grid mx-auto grid max-w-[420px] grid-cols-5 gap-3"
      }
      role="group"
      aria-label={ariaLabel}
    >
      {AVAILABLE_AVATARS.map((src) => (
        <button
          key={src}
          type="button"
          onClick={() => onSelect(src)}
          className={`avatar-option overflow-hidden rounded-[10px] transition-all duration-150 ease focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 ${
            selectedAvatar === src
              ? "avatar-selected outline outline-3 outline-amber-400 shadow-[0_0_10px_rgba(255,215,0,0.6)]"
              : "hover:scale-105 hover:shadow-md"
          }`}
          aria-pressed={selectedAvatar === src}
          aria-label={selectedAvatar === src ? "Selected avatar" : "Select avatar"}
        >
          <Image
            src={src}
            alt=""
            width={64}
            height={64}
            className="block h-auto w-full"
            sizes="(max-width: 768px) 12vw, 64px"
          />
        </button>
      ))}
    </div>
  );
}
