import { getDiscipline } from '../data/disciplines';
import type { DisciplineId } from '../data/disciplines';
import { accentForDiscipline } from '../ui/theme';

export const DISCIPLINE_ORDER: DisciplineId[] = ['track', 'street', 'rally'];
export function disciplineLabel(id: DisciplineId): string {
  return getDiscipline(id).name;
}

export function disciplineAccent(id: DisciplineId): string {
  return accentForDiscipline(id);
}
