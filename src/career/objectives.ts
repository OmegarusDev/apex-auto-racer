import { OBJECTIVES } from '../data/objectives';
import type { ObjectiveKind } from '../data/objectives';

export function getObjectiveDef(id: ObjectiveKind) {
  return OBJECTIVES.find((o) => o.id === id);
}
