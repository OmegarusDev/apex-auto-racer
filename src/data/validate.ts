import { BALANCE } from './balance';
import { FORMATS } from './formats';
import { ARCHETYPES } from './archetypes';
import { PARTS } from './parts';
import { DISCIPLINES } from './disciplines';
import { OBJECTIVES } from './objectives';
import { TOURNAMENTS } from './tournaments';

/** Dev boot check — returns human-readable error strings (empty = ok). */
export function validateRegistry(): string[] {
  const errors: string[] = [];

  for (const f of FORMATS) {
    if (f.teamSize > 6) {
      errors.push(`Format "${f.id}" teamSize ${f.teamSize} exceeds max 6`);
    }
    if (f.teamSize < 1) {
      errors.push(`Format "${f.id}" teamSize must be >= 1`);
    }
    if (f.teamCount < 2) {
      errors.push(`Format "${f.id}" teamCount must be >= 2`);
    }
    if (f.weight <= 0) {
      errors.push(`Format "${f.id}" weight must be positive`);
    }
  }

  if (BALANCE.rankBasePayout.length !== 6) {
    errors.push(`rankBasePayout length ${BALANCE.rankBasePayout.length}, expected 6`);
  }
  if (BALANCE.opponentStatRanges.length !== 6) {
    errors.push(`opponentStatRanges length ${BALANCE.opponentStatRanges.length}, expected 6`);
  }
  if (BALANCE.opponentPartTiers.length !== 6) {
    errors.push(`opponentPartTiers length ${BALANCE.opponentPartTiers.length}, expected 6`);
  }
  if (BALANCE.pointsPerPosition.length < 4) {
    errors.push('pointsPerPosition too short');
  }

  for (const a of ARCHETYPES) {
    if (a.waypointCount[0] > a.waypointCount[1]) {
      errors.push(`Archetype "${a.id}" waypointCount min > max`);
    }
    if (a.width <= 0) {
      errors.push(`Archetype "${a.id}" width must be positive`);
    }
  }

  const partIds = new Set<string>();
  for (const p of PARTS) {
    if (partIds.has(p.id)) {
      errors.push(`Duplicate part id "${p.id}"`);
    }
    partIds.add(p.id);
    if (p.baseCost <= 0) {
      errors.push(`Part "${p.id}" baseCost must be positive`);
    }
  }

  const disciplineIds = new Set(DISCIPLINES.map((d) => d.id));
  if (disciplineIds.size !== 3) {
    errors.push('Expected exactly 3 disciplines');
  }

  const objectiveIds = new Set<string>();
  for (const o of OBJECTIVES) {
    if (objectiveIds.has(o.id)) {
      errors.push(`Duplicate objective id "${o.id}"`);
    }
    objectiveIds.add(o.id);
    if (o.reward <= 0) {
      errors.push(`Objective "${o.id}" reward must be positive`);
    }
  }

  for (const t of TOURNAMENTS) {
    if (t.teamSize > 6) {
      errors.push(`Tournament "${t.id}" teamSize ${t.teamSize} exceeds max 6`);
    }
    if (t.races.length === 0) {
      errors.push(`Tournament "${t.id}" has no races`);
    }
    for (const r of t.races) {
      const fmt = FORMATS.find((f) => f.id === r.formatId);
      if (fmt === undefined) {
        errors.push(`Tournament "${t.id}" references unknown format "${r.formatId}"`);
      }
    }
  }

  return errors;
}
