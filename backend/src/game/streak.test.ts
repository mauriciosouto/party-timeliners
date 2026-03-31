import { describe, it, expect } from "vitest";
import { getStreakBadgeLabel, getStreakMilestoneCallout } from "shared/streak";

describe("streak milestone copy (shared)", () => {
  it("badge: no label below 2", () => {
    expect(getStreakBadgeLabel(0)).toBeNull();
    expect(getStreakBadgeLabel(1)).toBeNull();
  });

  it("badge: milestones 2–4+", () => {
    expect(getStreakBadgeLabel(2)).toBe("Nice!");
    expect(getStreakBadgeLabel(3)).toBe("On Fire");
    expect(getStreakBadgeLabel(4)).toBe("Unstoppable");
    expect(getStreakBadgeLabel(99)).toBe("Unstoppable");
  });

  it("callout: null below 2; exclamation on 3 and 4+", () => {
    expect(getStreakMilestoneCallout(1)).toBeNull();
    expect(getStreakMilestoneCallout(2)).toBe("Nice!");
    expect(getStreakMilestoneCallout(3)).toBe("On Fire!");
    expect(getStreakMilestoneCallout(4)).toBe("Unstoppable!");
  });
});
