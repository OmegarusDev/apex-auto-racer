/**
 * Shared race chrome geometry — InputController hit zones must match draw.
 */

import { ensureMinTouch } from '../../ui/components';
import { pad, type ThemeTokens } from '../../ui/theme';

export interface ChromeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RaceChromeLayout {
  brake: ChromeRect;
  gas: ChromeRect;
  shift: ChromeRect;
  pause: ChromeRect;
  minimap: ChromeRect;
  /** Race tabletop zoom slider (draw + hit). */
  zoomSlider: ChromeRect;
  /** Regions that must not register as pedals. */
  deadZones: ChromeRect[];
  deckTop: number;
}

export function pointInRect(x: number, y: number, r: ChromeRect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Bottom control deck + TR chrome for a given viewport. */
export function raceChromeLayout(w: number, h: number, token: ThemeTokens): RaceChromeLayout {
  const safe = token.safe;
  const deckH = Math.max(h * 0.26, pad(token, 11) + safe.bottom);
  const deckTop = h - deckH;
  const gap = pad(token, 0.75);
  const shiftW = Math.min(w * 0.28, pad(token, 14));
  const shiftX = (w - shiftW) * 0.5;
  const sideW = (w - shiftW) * 0.5 - gap * 1.5;

  const brake: ChromeRect = {
    x: safe.left + gap,
    y: deckTop + gap,
    w: sideW - safe.left,
    h: deckH - gap * 2 - safe.bottom,
  };
  const gas: ChromeRect = {
    x: shiftX + shiftW + gap,
    y: deckTop + gap,
    w: Math.max(pad(token, 8), w - safe.right - gap - (shiftX + shiftW + gap)),
    h: deckH - gap * 2 - safe.bottom,
  };
  const shift: ChromeRect = {
    x: shiftX,
    y: deckTop + deckH * 0.28,
    w: shiftW,
    h: deckH * 0.55,
  };

  const pauseSize = ensureMinTouch(pad(token, 4.5), token);
  const mmSize = Math.min(pad(token, 10), w * 0.22, h * 0.16);
  const mmX = w - safe.right - pad(token) - mmSize;
  const mmY = safe.top + pad(token);
  const minimap: ChromeRect = { x: mmX, y: mmY, w: mmSize, h: mmSize * 0.72 };
  const pause: ChromeRect = {
    x: w - safe.right - pad(token) - pauseSize,
    y: mmY + mmSize * 0.72 + pad(token, 0.5),
    w: pauseSize,
    h: pauseSize,
  };

  // Zoom under pause/minimap — same chrome column, fat enough for a thumb.
  const zoomH = ensureMinTouch(pad(token, 4.25), token);
  const zoomSlider: ChromeRect = {
    x: mmX,
    y: pause.y + pause.h + pad(token, 0.65),
    w: mmSize,
    h: zoomH,
  };

  // Rain + night chips stack under zoom — keep them out of the gas pad.
  const chipH = pad(token, 2.6);
  const chipStack =
    pad(token, 0.5) + chipH + pad(token, 0.4) + chipH;

  // Expand TR dead zone so fat fingers don't gas through chrome.
  const trPad = pad(token, 0.75);
  const trZone: ChromeRect = {
    x: Math.min(mmX, pause.x, zoomSlider.x) - trPad,
    y: safe.top,
    w: w - Math.min(mmX, pause.x, zoomSlider.x) + trPad,
    h: zoomSlider.y + zoomSlider.h + chipStack + trPad - safe.top,
  };

  return {
    brake,
    gas,
    shift,
    pause,
    minimap,
    zoomSlider,
    deadZones: [trZone],
    deckTop,
  };
}
