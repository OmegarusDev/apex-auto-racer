/**
 * Shared race chrome geometry — InputController hit zones must match draw.
 * Pedal order is clutch · brake · gas (left to right), like a real box.
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
  /** Clutch pedal (left). Named `shift` for the existing input channel. */
  shift: ChromeRect;
  pause: ChromeRect;
  minimap: ChromeRect;
  /** Rev / clutch bite cluster — left of the world, above the pedals. */
  shiftMeter: ChromeRect;
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
  const gap = pad(token, 0.7);
  const shortLandscape = w > h && h < pad(token, 55);
  const deckFloor = shortLandscape
    ? ensureMinTouch(pad(token, 11), token) + safe.bottom + gap * 2
    : pad(token, 8.2) + safe.bottom;
  const deckH = Math.max(h * (shortLandscape ? 0.2 : 0.155), deckFloor);
  const deckTop = h - deckH;

  const innerLeft = safe.left + gap;
  const innerRight = w - safe.right - gap;
  const innerW = Math.max(token.touchMin * 3, innerRight - innerLeft);
  const colGap = gap;
  const usable = innerW - colGap * 2;
  const clutchW = Math.max(token.touchMin, usable * 0.28);
  const brakeW = Math.max(token.touchMin, usable * 0.32);
  const gasW = Math.max(token.touchMin, usable - clutchW - brakeW);
  const pedalTop = deckTop + gap;
  const pedalH = Math.max(token.touchMin, deckH - gap * 2 - safe.bottom);

  const shift: ChromeRect = { x: innerLeft, y: pedalTop, w: clutchW, h: pedalH };
  const brake: ChromeRect = {
    x: innerLeft + clutchW + colGap,
    y: pedalTop,
    w: brakeW,
    h: pedalH,
  };
  const gas: ChromeRect = {
    x: innerLeft + clutchW + colGap + brakeW + colGap,
    y: pedalTop,
    w: gasW,
    h: pedalH,
  };

  const pauseSize = ensureMinTouch(pad(token, 4.5), token);
  const mmSize = Math.min(pad(token, 10), w * 0.22, h * 0.16);
  const mmX = w - safe.right - pad(token) - mmSize;
  const mmY = safe.top + pad(token);
  const minimap: ChromeRect = { x: mmX, y: mmY, w: mmSize, h: mmSize * 0.72 };
  const pauseW = Math.max(pauseSize, Math.min(mmSize, pad(token, 9)));
  const pause: ChromeRect = {
    x: w - safe.right - pad(token) - pauseW,
    y: mmY + mmSize * 0.72 + pad(token, 0.5),
    w: pauseW,
    h: pauseSize,
  };

  const trPad = pad(token, 0.75);
  const trZone: ChromeRect = {
    x: Math.min(mmX, pause.x) - trPad,
    y: safe.top,
    w: w - Math.min(mmX, pause.x) + trPad,
    h: pause.y + pause.h + trPad - safe.top,
  };

  const meterW = Math.min(pad(token, 11), w * 0.2);
  const meterGap = pad(token, 1);
  const minMeterH = pad(token, 12);
  const telemReserve = shortLandscape ? pad(token, 11) : pad(token, 19);
  let meterTop = safe.top + pad(token) + telemReserve;
  let meterH = deckTop - meterGap - meterTop;
  if (meterH < minMeterH) {
    meterH = minMeterH;
    meterTop = Math.max(safe.top + pad(token), deckTop - meterGap - meterH);
  }
  const shiftMeter: ChromeRect = {
    x: innerLeft,
    y: meterTop,
    w: meterW,
    h: meterH,
  };

  return {
    brake,
    gas,
    shift,
    pause,
    minimap,
    shiftMeter,
    deadZones: [trZone, shiftMeter],
    deckTop,
  };
}
