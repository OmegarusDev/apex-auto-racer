export type PartCategory =
  | 'engine'
  | 'intake'
  | 'exhaust'
  | 'tyres'
  | 'brakes'
  | 'suspension'
  | 'spoiler';

export interface PartDef {
  id: PartCategory;
  name: string;
  baseCost: number;
  perTier: {
    topSpeed?: number;
    acceleration?: number;
    braking?: number;
    grip?: number;
    downforce?: number;
  };
}

export const PARTS: PartDef[] = [
  {
    id: 'engine',
    name: 'Engine',
    baseCost: 600,
    perTier: { topSpeed: 5, acceleration: 1 },
  },
  {
    id: 'intake',
    name: 'Intake',
    baseCost: 300,
    perTier: { topSpeed: 2, acceleration: 2 },
  },
  {
    id: 'exhaust',
    name: 'Exhaust',
    baseCost: 350,
    perTier: { acceleration: 4 },
  },
  {
    id: 'tyres',
    name: 'Tyres',
    baseCost: 400,
    perTier: { grip: 5 },
  },
  {
    id: 'brakes',
    name: 'Brakes',
    baseCost: 350,
    perTier: { braking: 4 },
  },
  {
    id: 'suspension',
    name: 'Suspension',
    baseCost: 450,
    perTier: { grip: 2 },
  },
  {
    id: 'spoiler',
    name: 'Spoiler',
    baseCost: 500,
    perTier: { downforce: 5, topSpeed: -1 },
  },
];

export function partCost(baseCost: number, nextTier: number): number {
  if (nextTier <= 0) return 0;
  return Math.round(baseCost * Math.pow(1.85, nextTier - 1));
}
