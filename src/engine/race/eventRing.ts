import type { BrainIntentTag } from '../BrainIntent';
import { intentTickerPhrase } from '../BrainIntent';
import type { CarSimState } from '../Vehicle';
import type { RaceEvent, RaceEventKind } from '../types';

export const EVENT_BUFFER_SIZE = 128;

export function formatEvent(event: RaceEvent): string {
  const name = event.driverName ?? event.carId;
  switch (event.kind) {
    case 'overtake':
      return `${event.time.toFixed(1)}s — ${name} overtakes${event.detail ? ` ${event.detail}` : ''}`;
    case 'mistake':
      return `${event.time.toFixed(1)}s — ${name} makes a mistake`;
    case 'spin':
      return `${event.time.toFixed(1)}s — ${name} spins!`;
    case 'deslot':
      return `${event.time.toFixed(1)}s — ${name} deslots!`;
    case 'crash':
      return `${event.time.toFixed(1)}s — ${name} crashes into the wall`;
    case 'driftEntry':
      return `${event.time.toFixed(1)}s — ${name} initiates a drift`;
    case 'draftPass':
      return `${event.time.toFixed(1)}s — ${name} slingshots past`;
    case 'wallHit':
      return `${event.time.toFixed(1)}s — ${name} clips the wall`;
    case 'finish':
      return `${event.time.toFixed(1)}s — ${name} crosses the line`;
    case 'lap':
      return `${event.time.toFixed(1)}s — ${name} completes lap ${event.detail ?? ''}`;
    case 'intent':
      return `${event.time.toFixed(1)}s — ${intentTickerPhrase(name, event.detail as BrainIntentTag)}`;
    case 'rejoin':
      return `${event.time.toFixed(1)}s — ${name} finds the peg`;
    case 'shift':
      return `${event.time.toFixed(1)}s — ${name} ${
        event.detail === 'down' ? 'downshifts' : 'upshifts'
      }`;
    default:
      return `${event.time.toFixed(1)}s — ${name}: ${event.kind}`;
  }
}

export function buildEventsStory(events: readonly RaceEvent[]): string {
  if (events.length === 0) return 'A clean race with no major incidents.';
  return events.map(formatEvent).join('\n');
}

export interface EventRingState {
  events: RaceEvent[];
  eventHead: number;
  eventSeq: number;
}

export function pushEventOntoRing(
  ring: EventRingState,
  kind: RaceEventKind,
  time: number,
  car: CarSimState,
  driverName: string,
  detail?: string,
): void {
  ring.eventSeq += 1;
  const event: RaceEvent = {
    kind,
    time,
    carId: car.id,
    driverName,
    detail,
    seq: ring.eventSeq,
  };

  if (ring.events.length < EVENT_BUFFER_SIZE) {
    ring.events.push(event);
  } else {
    ring.events[ring.eventHead] = event;
    ring.eventHead = (ring.eventHead + 1) % EVENT_BUFFER_SIZE;
  }
}
