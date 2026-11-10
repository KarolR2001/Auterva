/** The trial lasts exactly 336 h; the DB constraint `service_trial_336h` rejects any other span. */
export const TRIAL_MS = 336 * 60 * 60_000;

/**
 * ServiceAccess trial fields for a trial that ended `endedHoursAgo` hours ago. Both timestamps derive
 * from one clock reading, so the 336 h span holds even when the millisecond changes between calls.
 */
export function expiredTrial(options: { endedHoursAgo: number; now?: number }) {
  const trialEndsAt = new Date((options.now ?? Date.now()) - options.endedHoursAgo * 3_600_000);
  return { trialGranted: true, trialStartedAt: new Date(trialEndsAt.getTime() - TRIAL_MS), trialEndsAt };
}
