import { createTheme } from '../src/ui/theme';
import {
  computeTitleLayout,
  measureTitleLogoHeight,
  titleMenuStackHeight,
} from '../src/scenes/titleArt';

const sizes: [number, number, string][] = [
  [390, 844, 'phone portrait'],
  [844, 390, 'phone landscape'],
  [768, 1024, 'tablet portrait'],
  [1024, 768, 'tablet landscape'],
  [1280, 800, 'desktop'],
  [1920, 1080, 'full HD'],
  [360, 640, 'small phone'],
];

let bad = 0;
for (const [w, h, label] of sizes) {
  const t = createTheme(w, h);
  const L = computeTitleLayout(w, h, t);
  // Same stack math the scene and layout both use — cannot drift.
  const menuBottom = L.menuY + titleMenuStackHeight(t, L.btnH);
  const logoH = measureTitleLogoHeight(L.apexSize);
  const logoBottom = L.logoY + logoH;
  const fromBottom = h - menuBottom;
  const minLift = t.safe.bottom + (L.mode === 'landscape' && h < 520 ? 20 : 28);
  const fits = menuBottom <= h - t.safe.bottom + 2;
  const lifted = fromBottom >= minLift - 1;
  const clear = L.mode === 'landscape' ? L.menuY >= logoBottom - 2 : L.menuY >= logoBottom - 4;
  const ok = fits && clear && lifted;
  if (!ok) bad += 1;
  console.log(
    label.padEnd(18),
    `${w}x${h}`.padEnd(11),
    L.mode.padEnd(10),
    `apex=${Math.round(L.apexSize)}`,
    `btn=${Math.round(L.btnH)}`,
    `lift=${Math.round(fromBottom)}`,
    ok ? 'OK' : 'BAD',
  );
}
if (bad > 0) process.exit(1);
