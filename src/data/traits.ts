export type TraitId =
  | 'hothead'
  | 'iceCold'
  | 'showboat'
  | 'slipstreamer'
  | 'grinder'
  | 'looseCannon';

export interface TraitDef {
  id: TraitId;
  name: string;
  description: string;
}

export const TRAITS: TraitDef[] = [
  {
    id: 'hothead',
    name: 'Hothead',
    description: 'Brakes later when a rival is on your bumper',
  },
  {
    id: 'iceCold',
    name: 'Ice Cold',
    description: 'Halves mistake rate on the final lap or when packed tight',
  },
  {
    id: 'showboat',
    name: 'Showboat',
    description: '+30% XP on podium; more mistakes while leading by a clear gap',
  },
  {
    id: 'slipstreamer',
    name: 'Slipstreamer',
    description: 'Draft force ×1.65 — stronger tow and easier draft passes',
  },
  {
    id: 'grinder',
    name: 'Grinder',
    description: '+25% XP from every race finish',
  },
  {
    id: 'looseCannon',
    name: 'Loose Cannon',
    description: 'Each race, stats jitter ±0–10 before the lights',
  },
];

export function getTrait(id: TraitId): TraitDef {
  const t = TRAITS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown trait ${id}`);
  return t;
}
