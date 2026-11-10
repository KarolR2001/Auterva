import { expect, test, vi } from "vitest";
import { expiredTrial, TRIAL_MS } from "../fixtures/expired-trial";

test("expiredTrial keeps the 336 h span even when the clock ticks between calls", () => {
  let tick = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => tick++);
  for (const endedHoursAgo of [1, 64, 164]) {
    const trial = expiredTrial({ endedHoursAgo });
    expect(trial.trialEndsAt.getTime() - trial.trialStartedAt.getTime()).toBe(TRIAL_MS);
    expect(trial.trialGranted).toBe(true);
    expect(trial.trialEndsAt.getTime()).toBeLessThan(tick - endedHoursAgo * 3_600_000 + 10);
  }
});
