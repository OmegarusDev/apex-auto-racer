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
    description: 'Brakes later when closing on a rival',
  },
  {
    id: 'iceCold',
    name: 'Ice Cold',
    description: 'Half mistakes near rivals or on the final lap',
  },
  {
    id: 'showboat',
    name: 'Showboat',
    description: '+30% XP on podium; riskier while leading',
  },
  {
    id: 'slipstreamer',
    name: 'Slipstreamer',
    description: 'Draft bonuses ×1.5',
  },
  {
    id: 'grinder',
    name: 'Grinder',
    description: '+25% XP always',
  },
  {
    id: 'looseCannon',
    name: 'Loose Cannon',
    description: 'Stats jitter ±0–10 each race',
  },
];

export function getTrait(id: TraitId): TraitDef {
  const t = TRAITS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown trait ${id}`);
  return t;
}
