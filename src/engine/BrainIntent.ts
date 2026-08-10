/** Driver-brain storytelling tags — legible autopilot decisions, not physics. */

export type BrainIntentTag =
  | 'HOLD_GRID'
  | 'LAUNCH_CLEAR'
  | 'BRAKE_FOR_CORNER'
  | 'FULL_SEND'
  | 'REJOIN_CRAWL'
  | 'SPIN_SCRUB'
  | 'RECOVERY_GRACE'
  | 'TRAFFIC_LIFT'
  | 'AVOID_WRECK'
  | 'DRAFT_HOLD'
  | 'PULL_OUT'
  | 'UNSTICK_SIDE'
  | 'MISTAKE_LATE_BRAKE'
  | 'MISTAKE_WOBBLE'
  | 'HOTHEAD_LATE'
  | 'ICE_COLD_CALM'
  | 'SHOWBOAT_RISK'
  | 'CONTACT_BLOCKED';

export interface BrainIntent {
  tag: BrainIntentTag;
  /** Higher wins when multiple branches compete. */
  priority: number;
  /** Seconds the HUD chip should linger. */
  ttl: number;
}

/** Priority order (high → low) for primary intents. */
export const INTENT_PRIORITY: Record<BrainIntentTag, number> = {
  SPIN_SCRUB: 110,
  REJOIN_CRAWL: 100,
  UNSTICK_SIDE: 90,
  PULL_OUT: 80,
  AVOID_WRECK: 70,
  CONTACT_BLOCKED: 60,
  DRAFT_HOLD: 50,
  MISTAKE_LATE_BRAKE: 48,
  MISTAKE_WOBBLE: 47,
  HOTHEAD_LATE: 46,
  ICE_COLD_CALM: 45,
  SHOWBOAT_RISK: 44,
  BRAKE_FOR_CORNER: 40,
  TRAFFIC_LIFT: 30,
  RECOVERY_GRACE: 25,
  LAUNCH_CLEAR: 20,
  FULL_SEND: 15,
  HOLD_GRID: 10,
};

const DEFAULT_TTL = 1.6;

export function makeIntent(tag: BrainIntentTag, ttl = DEFAULT_TTL): BrainIntent {
  return { tag, priority: INTENT_PRIORITY[tag], ttl };
}

/** Tags that edge-trigger a race ticker event (rate-limited in RaceDirector). */
export const STORY_INTENT_TAGS: ReadonlySet<BrainIntentTag> = new Set([
  'PULL_OUT',
  'DRAFT_HOLD',
  'REJOIN_CRAWL',
  'AVOID_WRECK',
  'UNSTICK_SIDE',
  'SPIN_SCRUB',
  'HOTHEAD_LATE',
  'ICE_COLD_CALM',
  'SHOWBOAT_RISK',
  'MISTAKE_LATE_BRAKE',
  'MISTAKE_WOBBLE',
]);

/** BRAKE_FOR_CORNER is story-worthy only when leaving FULL_SEND. */
export function isStoryIntentTransition(
  next: BrainIntentTag,
  prev: BrainIntentTag | null | undefined,
): boolean {
  if (next === 'BRAKE_FOR_CORNER') return prev === 'FULL_SEND';
  return STORY_INTENT_TAGS.has(next);
}

/** Short HUD label under the trait chip. */
export function intentHudLabel(tag: BrainIntentTag): string {
  switch (tag) {
    case 'HOLD_GRID':
      return 'Holding grid';
    case 'LAUNCH_CLEAR':
      return 'Launch';
    case 'BRAKE_FOR_CORNER':
      return 'Braking';
    case 'FULL_SEND':
      return 'Full send';
    case 'REJOIN_CRAWL':
      return 'Rejoining';
    case 'SPIN_SCRUB':
      return 'Scrubbing';
    case 'RECOVERY_GRACE':
      return 'Recovering';
    case 'TRAFFIC_LIFT':
      return 'Traffic';
    case 'AVOID_WRECK':
      return 'Avoiding wreck';
    case 'DRAFT_HOLD':
      return 'In the tow';
    case 'PULL_OUT':
      return 'Going for it';
    case 'UNSTICK_SIDE':
      return 'Unsticking';
    case 'MISTAKE_LATE_BRAKE':
      return 'Late on brakes';
    case 'MISTAKE_WOBBLE':
      return 'Line wobble';
    case 'HOTHEAD_LATE':
      return 'Hanging it out';
    case 'ICE_COLD_CALM':
      return 'Ice cold';
    case 'SHOWBOAT_RISK':
      return 'Showboating';
    case 'CONTACT_BLOCKED':
      return 'Blocked';
    default:
      return tag;
  }
}

/** Human ticker / story line (no jargon). */
export function intentTickerPhrase(name: string, tag: BrainIntentTag): string {
  switch (tag) {
    case 'PULL_OUT':
      return `${name} goes for the pass`;
    case 'DRAFT_HOLD':
      return `${name} sits in the tow`;
    case 'REJOIN_CRAWL':
      return `${name} hunting the peg`;
    case 'BRAKE_FOR_CORNER':
      return `${name} lifts for the bend`;
    case 'AVOID_WRECK':
      return `${name} avoids a wreck`;
    case 'UNSTICK_SIDE':
      return `${name} digs out sideways`;
    case 'SPIN_SCRUB':
      return `${name} scrubs the spin`;
    case 'HOTHEAD_LATE':
      return `${name} hangs it out (Hothead)`;
    case 'ICE_COLD_CALM':
      return `${name} stays ice cold`;
    case 'SHOWBOAT_RISK':
      return `${name} showboats up front`;
    case 'MISTAKE_LATE_BRAKE':
      return `${name} brakes too late`;
    case 'MISTAKE_WOBBLE':
      return `${name} wiggles off line`;
    case 'CONTACT_BLOCKED':
      return `${name} gets bottled up`;
    case 'TRAFFIC_LIFT':
      return `${name} lifts for traffic`;
    case 'HOLD_GRID':
      return `${name} holds the grid`;
    case 'LAUNCH_CLEAR':
      return `${name} clears the lights`;
    case 'FULL_SEND':
      return `${name} pins it`;
    case 'RECOVERY_GRACE':
      return `${name} finds the groove`;
    default:
      return `${name} makes a move`;
  }
}
