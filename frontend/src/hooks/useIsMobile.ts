"use client";

import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT_PX = 768;

/**
 * Returns true when viewport width is at or below the mobile breakpoint (768px).
 * Used to switch to the dedicated mobile game layout.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return isMobile;
}
