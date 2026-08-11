import { DISCIPLINES, getDiscipline } from '../data/disciplines';
import type { DisciplineId } from '../data/disciplines';
import { accentForDiscipline } from '../ui/theme';
import { ensureMinTouch, hitRect, type UiContext } from '../ui/components';

export const DISCIPLINE_ORDER: DisciplineId[] = ['track', 'street', 'rally'];
export function disciplineLabel(id: DisciplineId): string {
  return getDiscipline(id).name;
}

export function disciplineAccent(id: DisciplineId): string {
  return accentForDiscipline(id);
}

export function allDisciplines() {
  return DISCIPLINES;
}

export function carouselNav(
  ui: UiContext,
  leftX: number,
  rightX: number,
  y: number,
  size: number,
  onLeft: () => void,
  onRight: () => void,
): void {
  const { token } = ui;
  const btnH = ensureMinTouch(size, token);
  if (ui.pointerClicked) {
    if (hitRect(ui.pointerX, ui.pointerY, leftX, y, btnH, btnH)) onLeft();
    if (hitRect(ui.pointerX, ui.pointerY, rightX, y, btnH, btnH)) onRight();
  }
}
