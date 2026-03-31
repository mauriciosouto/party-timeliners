import { performance } from "node:perf_hooks";
import { config } from "./config.js";

/** Round to 2 decimal places for logs */
function ms(n: number): number {
  return Math.round(n * 100) / 100;
}

export type PerfMeta = Record<string, string | number | boolean | undefined>;

/**
 * Wall-clock phases for comparing optimizations (e.g. place_event).
 * Enable with PERF_TIMING=1. Each `mark` records ms since the previous mark (or span start).
 */
export function createPerfSpan(label: string, meta: PerfMeta = {}): {
  mark: (phase: string) => void;
  end: (extra?: PerfMeta) => void;
} {
  if (!config.perfTiming) {
    return {
      mark: () => {},
      end: () => {},
    };
  }

  const t0 = performance.now();
  const phases: Record<string, number> = {};
  let last = t0;

  return {
    mark(phase: string) {
      const now = performance.now();
      phases[phase] = ms(now - last);
      last = now;
    },
    end(extra: PerfMeta = {}) {
      const total = performance.now() - t0;
      console.log(
        JSON.stringify({
          perf: label,
          totalMs: ms(total),
          phases,
          ...meta,
          ...extra,
        }),
      );
    },
  };
}
