import type { TraitId } from '../data/traits';
import type { Driver, VehicleSave } from '../engine/types';
import { emptyVehicleParts } from '../engine/types';
import type { PaceBand } from '../engine/race/paceTrackScale';

export type QuickRacePresetId =
  | 'garage'
  | 'rookie'
  | 'club'
  | 'weekend'
  | 'pro'
  | 'factory';

export interface QuickRacePreset {
  id: QuickRacePresetId;
  /** Short menu label. */
  label: string;
  /** One-line skill / car summary. */
  blurb: string;
  /** Opponent difficulty rank (0–5) when not using garage. */
  challengeRank: PaceBand;
  /** Track-scale pace band. */
  paceBand: PaceBand;
  /** When true, use career roster + vehicle (no synthetic drivers). */
  useGarage: boolean;
  drivers?: readonly Omit<Driver, 'id' | 'xp' | 'level' | 'unspentPoints'>[];
  partTier?: number;
}

const PRESETS: QuickRacePreset[] = [
  {
    id: 'garage',
    label: 'My Garage',
    blurb: 'Your roster + car — career pace',
    challengeRank: 2,
    paceBand: 2,
    useGarage: true,
  },
  {
    id: 'rookie',
    label: 'Rookie Scrap',
    blurb: 'Skill ~28 · Parts T1 · soft field',
    challengeRank: 0,
    paceBand: 0,
    useGarage: false,
    partTier: 1,
    drivers: [
      {
        name: 'Kit Novak',
        trait: 'grinder' as TraitId,
        skill: 28,
        bravery: 30,
        focus: 26,
        determination: 32,
      },
    ],
  },
  {
    id: 'club',
    label: 'Club Contender',
    blurb: 'Skill ~45 · Parts T2 · club rivals',
    challengeRank: 1,
    paceBand: 1,
    useGarage: false,
    partTier: 2,
    drivers: [
      {
        name: 'Mara Quinn',
        trait: 'iceCold' as TraitId,
        skill: 46,
        bravery: 42,
        focus: 48,
        determination: 44,
      },
    ],
  },
  {
    id: 'weekend',
    label: 'Weekend Warrior',
    blurb: 'Skill ~60 · Parts T3 · mid pack',
    challengeRank: 2,
    paceBand: 2,
    useGarage: false,
    partTier: 3,
    drivers: [
      {
        name: 'Jules Haro',
        trait: 'slipstreamer' as TraitId,
        skill: 62,
        bravery: 58,
        focus: 60,
        determination: 64,
      },
    ],
  },
  {
    id: 'pro',
    label: 'Pro Hotshot',
    blurb: 'Skill ~78 · Parts T4 · sharp field',
    challengeRank: 3,
    paceBand: 3,
    useGarage: false,
    partTier: 4,
    drivers: [
      {
        name: 'Rex Calder',
        trait: 'hothead' as TraitId,
        skill: 80,
        bravery: 82,
        focus: 74,
        determination: 76,
      },
    ],
  },
  {
    id: 'factory',
    label: 'Factory Ace',
    blurb: 'Skill ~92 · Parts T5 · elite field',
    challengeRank: 5,
    paceBand: 5,
    useGarage: false,
    partTier: 5,
    drivers: [
      {
        name: 'Ava Sterling',
        trait: 'showboat' as TraitId,
        skill: 94,
        bravery: 90,
        focus: 93,
        determination: 91,
      },
    ],
  },
];

export function listQuickRacePresets(): readonly QuickRacePreset[] {
  return PRESETS;
}

export function getQuickRacePreset(id: QuickRacePresetId): QuickRacePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}

/** Materialize synthetic drivers with stable race-local ids. */
export function materializePresetDrivers(preset: QuickRacePreset): Driver[] {
  if (preset.useGarage || !preset.drivers) return [];
  return preset.drivers.map((d, i) => ({
    id: `qr-${preset.id}-${i}`,
    name: d.name,
    trait: d.trait,
    skill: d.skill,
    bravery: d.bravery,
    focus: d.focus,
    determination: d.determination,
    xp: 0,
    level: 1,
    unspentPoints: 0,
  }));
}

export function materializePresetVehicle(preset: QuickRacePreset): VehicleSave | null {
  if (preset.useGarage || preset.partTier === undefined) return null;
  return {
    partTiers: emptyVehicleParts(preset.partTier),
    condition: 1,
  };
}

export function presetStatSummary(preset: QuickRacePreset): string {
  if (preset.useGarage) return 'Career drivers';
  const d = preset.drivers?.[0];
  if (!d) return '';
  return `Sk ${d.skill} · Br ${d.bravery} · Fo ${d.focus} · Det ${d.determination}`;
}
