export type ModifierOp = 'mul' | 'add';

/** Params the modifier stack may target during simulation or stat resolution. */
export type ModifierTarget =
  | 'muSurface'
  | 'gripFactor'
  | 'vMax'
  | 'aAccel'
  | 'aBrake'
  | 'condGrip'
  | 'condTop'
  | 'tempGrip'
  | 'draft'
  | 'determination'
  | 'mistakeRate'
  | 'kUnder'
  | 'lineNoise'
  | 'kBrake'
  | 'authority'
  | 'xpMult';

export interface ModifierContext {
  /** Simulation time in seconds, when applicable. */
  time?: number;
  /** Car is the player-controlled vehicle. */
  isPlayer?: boolean;
  /** Car is leading the race. */
  isLeading?: boolean;
  /** Rivals within proximity (meters). */
  rivalDistance?: number;
  /** Rain is active this race. */
  rain?: boolean;
  /** Car is in drift state. */
  drifting?: boolean;
  /** Custom predicate payload for data-driven conditions. */
  flags?: Record<string, boolean | number>;
}

export interface Modifier {
  source: string;
  targetParam: ModifierTarget;
  op: ModifierOp;
  value: number;
  condition?: (ctx: ModifierContext) => boolean;
}

export type ModifierValues = Partial<Record<ModifierTarget, number>>;

export function createModifierStack(): Modifier[] {
  return [];
}

export function addModifier(stack: Modifier[], mod: Modifier): void {
  stack.push(mod);
}

export function clearModifiersBySource(stack: Modifier[], source: string): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]!.source === source) {
      stack.splice(i, 1);
    }
  }
}

export function clearModifiers(stack: Modifier[]): void {
  stack.length = 0;
}

/**
 * Apply an ordered modifier stack to a base value map.
 * Modifiers with failing conditions are skipped.
 */
export function applyModifiers(
  base: ModifierValues,
  stack: readonly Modifier[],
  context: ModifierContext,
): ModifierValues {
  const out: ModifierValues = { ...base };

  for (const mod of stack) {
    if (mod.condition !== undefined && !mod.condition(context)) {
      continue;
    }

    const current = out[mod.targetParam] ?? 1;
    if (mod.op === 'mul') {
      out[mod.targetParam] = current * mod.value;
    } else {
      out[mod.targetParam] = current + mod.value;
    }
  }

  return out;
}

/** Read a single param after applying the stack (defaults to 1 for multipliers). */
export function applyModifierParam(
  base: number,
  targetParam: ModifierTarget,
  stack: readonly Modifier[],
  context: ModifierContext,
): number {
  const result = applyModifiers({ [targetParam]: base }, stack, context);
  return result[targetParam] ?? base;
}
