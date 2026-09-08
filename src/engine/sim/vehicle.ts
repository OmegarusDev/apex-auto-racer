/**
 * Two-axle vehicle on the Frenet ribbon — hybrid line + tyre physics.
 *
 * Groove = the personal racing line. The driver steers toward it (that is how
 * the AI knows where to go). Tyres are the grip limit: peak, falloff, load
 * transfer, aero. If the turn asks for more than the tyres can give, the car
 * runs wide / slides / spins — that is the emergent behaviour. There is no
 * magnet force on the chassis; two lateral writers would fight.
 */
import { BALANCE } from '../../data/balance';
import { PHYSICS } from '../../data/physics';
import type { DisciplineId } from '../../data/disciplines';
import { interpolateAtSInto, type InterpolatedNode } from '../RacingLine';
import type { TrackData } from '../TrackGenerator';
import type { CarSimState } from '../vehicle/types';
import { computeZoneModifiers, wallLimitFor } from '../vehicle/zones';
import type { CarSetup } from '../vehicle/CarSetup';
import { lateralMu, longitudinalMu, tyreTempGrip, updateTyreTemp } from './tyre';
import { aeroForces, computeAxleLoads } from './loads';
import { driveForce, brakeForce, dragDecel } from './drive';
import { SURFACES } from '../../data/surfaces';
import { personalLineAt } from '../vehicle/create';

const nodeScratch: InterpolatedNode = {
  pos: { x: 0, y: 0 },
  tangent: { x: 1, y: 0 },
  normal: { x: 0, y: 1 },
  width: 0,
  runoffWidth: 0,
  kappa: 0,
  kappaLine: 0,
  o: 0,
  s: 0,
};

/**
 * Spin-out = body slip past ~49° — the car is rotated off the racing line and
 * the driver has lost control (a full 180° is a rare extreme this two-axle
 * model self-arrests before reaching; 49°+ is already a lost car).
 */
const SPIN_BETA = 0.92;
/** Slide/lost = body slip past this (off the "slot"). */
const SLIDE_BETA = 0.4;
const LOAD_SENS_N = 0.88;

/** Compute the live tyre curve for this car + surface at this moment. */
function buildCurve(
  surface: (typeof SURFACES)[DisciplineId],
  setup: CarSetup,
  zoneGrip: number,
  muBase: number,
): {
  muPeak: number;
  alphaPeak: number;
  stiffness: number;
  muXPeak: number;
  kappaPeak: number;
  driftable: number;
  postPeakDecay: number;
  breakawayMult: number;
} {
  const compound = setup.compoundMu ?? 1;
  return {
    muPeak: muBase * compound * zoneGrip,
    alphaPeak: (surface.alphaPeakDeg * Math.PI) / 180,
    stiffness: surface.stiffness,
    muXPeak: muBase * 0.95 * compound * zoneGrip,
    kappaPeak: 0.1,
    driftable: surface.stiffness < 1.5 ? 1 : 0.3,
    postPeakDecay: surface.postPeakDecay,
    breakawayMult: surface.breakawayMult,
  };
}

/** Deterministic surface noise (Rally bumps). */
function surfaceNoise(seed: number, s: number, t: number): number {
  const h = Math.sin(seed * 0.618 + Math.floor(s * 1.7) * 12.9898 + Math.floor(t * 4) * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

function applyBarrier(
  car: CarSimState,
  l: number,
  dl: number,
  width: number,
  runoffWidth: number,
  discipline: DisciplineId,
  focus: number,
  bravery: number,
  dt: number,
): void {
  const wallLimit = wallLimitFor(width, runoffWidth);
  if (Math.abs(l) <= wallLimit) return;
  const into = Math.sign(l) || 1;
  car.l = into * wallLimit;
  const impactLat = Math.max(0, dl * into);
  if (impactLat > 0) car.dl = -impactLat * PHYSICS.wallRestitution;

  const hard = car.v > PHYSICS.crashSpeed || impactLat > 5;
  if (hard) {
    const severity = Math.max(
      0.22,
      Math.min(1, (car.v - PHYSICS.crashSpeed) / 16 + (impactLat * impactLat) / 120 + car.v / 90),
    );
    car.v = Math.max(0, car.v * (1 - (1 - PHYSICS.crashSpeedMult) * severity));
    const street = discipline === 'street' ? PHYSICS.streetWallStunMult : 1;
    const stunScale = (1.05 - 0.3 * (focus / 100) + 0.08 * (bravery / 100)) * street;
    car.stunRemaining = Math.max(car.stunRemaining, PHYSICS.crashStun * severity * stunScale);
    car.wallHits += 1;
    if (car.isPlayerControlled) {
      car.condition = Math.max(
        BALANCE.conditionMin,
        car.condition - BALANCE.wallCrashConditionLoss * severity,
      );
    }
    // A genuine crash STOPS the car (momentum gone — that's the penalty) and
    // the marshal re-slots it within about a second. Without this a crashed car
    // ground along the wall for 10+ seconds before getting going again.
    if (severity > 0.45) {
      car.v = Math.min(car.v, 2.0);
      car.stuckTime = Math.max(car.stuckTime, 0.9);
    }
    // Hard barrier while sliding hard → resolve the spin (car is stopped).
    if (Math.abs(car.slipAngle) > SLIDE_BETA) {
      car.spinRemaining = 0;
      car.slipAngle = 0;
      car.yawRate = 0;
      car.v = Math.min(car.v, 1.2);
    }
  } else {
    car.v *= 1 - PHYSICS.scrapeSpeedMultPerSec * dt;
    // Rail deflection: a scraping car is steered back onto the track instead of
    // grinding along the wall forever. We rotate the velocity heading (theta),
    // NOT dl — dl is recomputed from the heading each tick, so a dl push gets
    // erased. Rotating theta makes the car's path arc off the wall.
    const peel = Math.max(0, Math.abs(l) - wallLimit) + 1;
    car.slipAngle = clampBeta(car.slipAngle - into * PHYSICS.scrapePeelAccel * 0.28 * peel * dt);
  }
}

/**
 * Marshal recovery — only for physically-unrecoverable states (stopped &
 * backward, or wedged on the barrier). Re-slots the car on its racing line.
 */
function maybeMarshal(car: CarSimState, track: TrackData, dt: number): void {
  // A car is "stuck" only if it is genuinely unable to continue: facing
  // backward, wedged on the barrier, in a sustained slide, or stalled off-line.
  const backward = Math.abs(car.slipAngle) > SPIN_BETA;
  const mnode = interpolateAtSInto(track.nodes, track.length, car.s, nodeScratch);
  const wallLimit = wallLimitFor(mnode.width ?? 30, mnode.runoffWidth ?? 4);
  // The wall grind is now handled by the scrape peel (heading rotation), so the
  // wedged check only needs the genuinely-stopped case — a car pinned and not
  // moving laterally.
  const wedged = Math.abs(car.l) >= wallLimit - 0.3 && Math.abs(car.dl) < 0.8 && car.v < 2.5;
  const sustainedSlide = Math.abs(car.slipAngle) > 0.8 && car.v < 6;
  const stalledOffLine = car.v < 2 && Math.abs(car.l) > mnode.width * 0.4;
  // A car is long-stopped only if it is NOT progressing along the track — a
  // slow crawl through a tight corner (v<0.5 but s advancing) is not stuck.
  const longStopped = car.v < 0.5 && Math.abs(car.s - car.stuckS) < 1.5;
  const stuck = backward || wedged || sustainedSlide || stalledOffLine;
  if (!stuck) {
    // Nearly-stopped for 3 s without progressing → genuinely stuck, recover it.
    // The timer decays rather than resets: a car that keeps re-pinning on the
    // wall in brief bursts must still be caught (the street grind).
    if (longStopped) {
      if (car.stuckTime === 0) car.stuckS = car.s;
      car.stuckTime += dt;
    } else {
      car.stuckTime = Math.max(0, car.stuckTime - dt * 0.5);
    }
    if (car.stuckTime < 3) return;
  } else {
    car.stuckTime += dt;
    if (car.stuckTime < 1.2) return;
  }

  const node = interpolateAtSInto(track.nodes, track.length, car.s, nodeScratch);
  car.l = Math.max(
    -node.width / 2 + PHYSICS.racingLineMargin,
    Math.min(node.width / 2 - PHYSICS.racingLineMargin, car.lineO.length ? personalLineAt(car, track, car.s) : 0),
  );
  car.slipAngle = 0;
  car.yawRate = 0;
  car.dl = 0;
  car.headingErr = 0;
  car.v = 2.0;
  // Reset the transmission too — a re-slotted car in 2nd at idle revs (band 0)
  // has zero torque and can never drive away (the recover→crawl→recover loop).
  car.gear = 1;
  car.gearBand = 0.35;
  car.stunRemaining = Math.max(car.stunRemaining, 0.3);
  car.penaltySec += 3.5;
  car.stuckTime = 0;
  car.deslotCount += 1;
}

/**
 * The main vehicle step — one tick of the coupled tyre/vehicle/load model.
 * `throttle`/`brake` are the APPLIED demands (player ceiling + driver plan).
 * `steer` is the driver's steering angle (rad).
 * `focus` / `bravery` (0–100) scale wall-stun only.
 */
export function stepVehicle(
  car: CarSimState,
  track: TrackData,
  dt: number,
  throttle: number,
  brake: number,
  steer: number,
  discipline: DisciplineId,
  muSurface: number,
  rain: boolean,
  vMaxEff?: number,
  aAccelEff?: number,
  aBrakeEff?: number,
  condGrip?: number,
  focus = 50,
  bravery = 50,
): void {
  void rain; // rain is already folded into muSurface by RaceDirector.
  const setup = car.setup as CarSetup;
  const mass = setup.massKg;
  const g = PHYSICS.g;

  // Contact-deslot immunity decays — without this the first hard contact
  // permanently disabled contact-deslot for the rest of the race.
  if (car.deslotImmunity > 0) car.deslotImmunity = Math.max(0, car.deslotImmunity - dt);

  const node = interpolateAtSInto(track.nodes, track.length, car.s, nodeScratch);
  const kappa = node.kappaLine;
  const width = node.width;
  const runoff = node.runoffWidth;

  const surface = SURFACES[discipline] ?? SURFACES.track!;
  // Surface µ from the authoritative discipline value (muSurface already carries
  // the rain multiplier from RaceDirector), scaled by surface noise (Rally
  // bumps), braking µ loss (Rally loose-under-brake) and live condition.
  const noise = (surfaceNoise(car.noiseSeed ?? 1, car.s, 0) - 0.5) * surface.noise;
  const brakingLoss = brake > 0.1 ? surface.brakingMuLoss * brake : 0;
  const muFactor = muSurface * (1 + noise) * (1 - brakingLoss) * (condGrip ?? 1);

  // Steering clamp (a real rack: ±~40°).
  const maxSteer = 0.7;
  const delta = Math.max(-maxSteer, Math.min(maxSteer, steer));

  // Zone (asphalt / kerb / runoff / grass).
  const zone = computeZoneModifiers(Math.abs(car.l), width, runoff, node.kappa, discipline);
  car.onKerb = zone.onKerb;

  const v = Math.max(0, car.v);
  const r = car.yawRate;
  // slipAngle is the VELOCITY relative to the path (drives position).
  const theta = car.slipAngle;
  // Body slip (velocity − heading) = theta − headingErr; this is what the
  // tyres see. Separating the two stops the yaw from spinning "in place"
  // (r runaway with no body-slip response).
  const headingErr = car.headingErr;
  const bodySlip = theta - headingErr;

  // Wheelbase split from static weight distribution.
  const wb = setup.wheelbase ?? 2.7;
  const a = wb * (setup.staticFront ?? 0.48);
  const b = wb * (1 - (setup.staticFront ?? 0.48));

  // Aero.
  const aero = aeroForces(v, setup);

  // Quasi-steady: one fixed-point iteration for roll-dependent loads.
  let aLat = car.lastLateralG ?? 0;
  let loads = computeAxleLoads({
    massKg: mass,
    cgHeight: setup.cgHeight,
    staticFront: setup.staticFront,
    wheelbase: wb,
    trackWidth: 1.55,
    suspStiffness: setup.suspStiffness,
    aLong: car.aLong ?? 0,
    aLat,
    aeroDownforceN: aero.downforceN,
    loadSens: LOAD_SENS_N,
  });

  // Longitudinal demand.
  const drive = driveForce(car, throttle, mass, aAccelEff ?? car.stats.aAccel, discipline, vMaxEff);
  const brakeReq = brakeForce(car, brake, mass, aBrakeEff ?? car.stats.aBrake);
  const drag = dragDecel(car, v, mass, aero.dragN);

  const tyreWearGrip = 1 - car.tyreWear;
  const tempGrip = tyreTempGrip(car.tyreTemp);

  // Slip angles from the body slip (not the velocity-path angle).
  const alphaF = Math.atan2(v * Math.sin(bodySlip) + r * a, v * Math.cos(bodySlip)) - delta;
  const alphaR = Math.atan2(v * Math.sin(bodySlip) - r * b, v * Math.cos(bodySlip));

  // Per-axle force split.
  const driveFrontFrac = drive.driveFront;
  const fxDemandFront = drive.fxDemand * driveFrontFrac - brakeReq.fxFront;
  const fxDemandRear = drive.fxDemand * (1 - driveFrontFrac) - brakeReq.fxRear;
  const fzRef = (mass * g) / 2;
  const curve = buildCurve(surface, setup, zone.gripMult, muFactor);
  // Drive axle breakaway: a driven axle's slip is used up by traction, so it
  // gives up past its peak — but the DRIVEN axle's post-peak is softened
  // (gentler decay) so the slide it starts is holdable: that's the drift. The
  // front axle only gets this under FWD; a RWD/AWD car drifts off the REAR.
  // A locked diff (Street) crisps the breakaway so it starts at a defined,
  // predictable point — the drift car's signature.
  const diffLock = (setup as CarSetup).diffLock ?? 0;
  const drivenDecay = curve.postPeakDecay * (0.48 + 0.27 * diffLock);
  const frontCurve = driveFrontFrac > 0.5 ? { ...curve, postPeakDecay: drivenDecay } : curve;
  const rearCurve = driveFrontFrac <= 0.5 ? { ...curve, postPeakDecay: drivenDecay } : curve;

  // Front axle.
  const kappaF = clampKappa(fxDemandFront, loads.fzFront, curve.muXPeak);
  const muLatF = lateralMu(frontCurve, alphaF) * tempGrip * tyreWearGrip;
  const muLongF = longitudinalMu(curve, kappaF) * tempGrip * tyreWearGrip;
  const fxF = clampFx(fxDemandFront, muLongF, loads.fzFront);
  const fyF = -lateralMax(muLatF, loads.fzFront, fzRef, fxF, muLongF, loads.fzFront);

  // Rear axle.
  const kappaR = clampKappa(fxDemandRear, loads.fzRear, curve.muXPeak);
  const muLatR = lateralMu(rearCurve, alphaR) * tempGrip * tyreWearGrip;
  const muLongR = longitudinalMu(curve, kappaR) * tempGrip * tyreWearGrip;
  const fxR = clampFx(fxDemandRear, muLongR, loads.fzRear);
  const fyR = -lateralMax(muLatR, loads.fzRear, fzRef, fxR, muLongR, loads.fzRear);

  // Accelerations (body frame).
  // Pacejka 1/v is numerically angry when parked — scale tyre aY in only
  // until walking pace. Real tyres still steer a rolling car at 1 m/s;
  // the old v/2 scale made post-brake hairpins undriveable.
  const latScale = Math.min(1, v / 0.7);
  const aX = (fxF + fxR) / mass - drag;

  const aY = ((fyF + fyR) / mass) * latScale;
  car.alphaFront = alphaF;
  car.alphaRear = alphaR;

  // Quasi-steady loads from this tick's accel (HUD / next-tick seed).
  loads = computeAxleLoads({
    massKg: mass,
    cgHeight: setup.cgHeight,
    staticFront: setup.staticFront,
    wheelbase: wb,
    trackWidth: 1.55,
    suspStiffness: setup.suspStiffness,
    aLong: aX,
    aLat: aY / g,
    aeroDownforceN: aero.downforceN,
    loadSens: LOAD_SENS_N,
  });
  car.fzFront = loads.fzFront;
  car.fzRear = loads.fzRear;

  // Yaw moment, damped by the tyres' self-aligning moments (without this the
  // bicycle model's yaw oscillates and runs away — a car that spins in place).
  const iz = setup.iz ?? mass * wb * wb * 1.1;
  const rDot = (fyF * a - fyR * b) / Math.max(iz, 1) - PHYSICS.yawDamping * r;

  // Integrate.
  const dsDt = (v * Math.cos(theta)) / Math.max(0.2, 1 - kappa * car.l);
  car.v = Math.max(0, car.v + aX * dt);
  const yawKin = (v * Math.tan(delta)) / Math.max(wb, 0.5);
  const yawDyn = r + rDot * dt;
  // Crawl: bicycle no-slip — the car goes where the wheels point. The old
  // branch rotated the body via steer but left velocity-path angle as
  // "ribbon spinning under a world-straight vel", so a hairpin after a
  // brake or from a stop drove straight off. Keep Pacejka once there is
  // enough speed (and whenever already sliding — don't glue a spin).
  const alreadySliding = Math.abs(bodySlip) > 0.35 || Math.abs(theta) > 0.7;
  const dynW = alreadySliding ? 1 : smooth01(1.15, 3.05, v);
  const kinW = 1 - dynW;
  car.yawRate = kinW * yawKin + dynW * yawDyn;
  // Heading-path angle: yaw rate (rotates the heading) minus path rotation.
  // Wrapped so a car that rotates a full turn (a spin) doesn't carry an
  // unbounded heading error — the tyres read body slip = theta − headingErr.
  car.headingErr = clampBeta(headingErr + (car.yawRate - kappa * dsDt) * dt);
  const thetaKin = car.headingErr;
  const thetaDyn = theta + (aY / Math.max(v, 1.2) - kappa * dsDt) * dt;
  car.slipAngle = clampBeta(kinW * thetaKin + dynW * thetaDyn);
  car.dl = v * Math.sin(theta);
  car.aLong = aX;
  car.lastLateralG = aY / g;

  car.s = (car.s + dsDt * dt) % track.length;
  if (car.s < 0) car.s += track.length;
  car.l += car.dl * dt;

  // Runoff drag + soft lateral scrub.
  if (zone.inRunoff) {
    car.v = Math.max(0, car.v - zone.dragDecel * dt);
    car.dl *= Math.exp(-0.5 * dt);
    car.slipAngle *= Math.exp(-0.4 * dt);
  }

  // Barrier.
  applyBarrier(car, car.l, car.dl, width, runoff, discipline, focus, bravery, dt);

  // Grip usage for the HUD / audio + driver: total accel demand ÷ the grip the
  // tyres can actually provide. (The old version divided by the CURRENT force,
  // which read ~2.5 on straights and made the driver lift constantly → crawl.)
  const grip = muFactor * (setup.compoundMu ?? 1) * g;
  car.gripUsage = Math.min(2.5, Math.hypot(aX, aY) / Math.max(grip, g * 0.2));

  // Corner limit speed (peg meter) — what THIS car can carry at this point,
  // from the same grip the driver plans against (no double µ).
  car.vDeslot = Math.min(
    vMaxEff ?? car.stats.vMax,
    Math.sqrt(Math.max(1, (muFactor * (setup.compoundMu ?? 1) * g) / Math.max(Math.abs(kappa), 1e-3))),
  );

  // Off the slot = actually leaving the track. A high slip angle alone is NOT
  // a deslot: cars routinely carry 0.2-0.4 rad of slide through corners and
  // must stay "on the slot" while they do — only genuine corner-exit slides
  // that run the car off the track count. (Spins are still detected separately
  // via SPIN_BETA.) Flagging deslot on slip alone produced hundreds of false
  // "wide" deslots every race.
  const offTrack = Math.abs(car.l) >= width / 2;
  car.slotMode = offTrack ? 'deslot' : 'groove';
  // Spin stun needs real rotation (or near-backward β). High |β| alone is a
  // big slide — flagging it as a spin made Mag scrub opposite a tiny yaw and
  // drive into the wall for a full second.
  if (
    car.spinRemaining <= 0 &&
    ((Math.abs(theta) > SPIN_BETA && Math.abs(r) > 0.5) || Math.abs(theta) > 1.05)
  ) {
    car.spinRemaining = PHYSICS.spinStun;
    car.spinCount += 1;
  }
  if (car.spinRemaining > 0) {
    car.spinRemaining = Math.max(0, car.spinRemaining - dt);
  }

  // Tyre temp.
  const slipMag = Math.hypot(Math.abs(alphaF), Math.abs(alphaR), Math.abs(kappaF), Math.abs(kappaR));
  car.tyreTemp = updateTyreTemp(
    car.tyreTemp,
    dt,
    slipMag,
    v,
    car.slotMode === 'deslot' || car.stunRemaining > 0,
  );
  car.onKerb = zone.onKerb;

  // Marshal for the truly stuck.
  maybeMarshal(car, track, dt);
}

function clampKappa(demandFx: number, Fz: number, muXPeak: number): number {
  const frac = demandFx / Math.max(1, Fz * muXPeak);
  return Math.max(-0.35, Math.min(0.35, frac * 0.1));
}

function clampFx(demand: number, muLong: number, Fz: number): number {
  const cap = Math.abs(muLong) * Math.max(0, Fz);
  return Math.max(-cap, Math.min(cap, demand));
}

/** Lateral max with load sensitivity and friction-ellipse coupling to Fx. */
function lateralMax(
  muLat: number,
  Fz: number,
  fzRef: number,
  fxApplied: number,
  muLong: number,
  fzLong: number,
): number {
  const fyMax = muLat * fzRef * Math.pow(Math.max(0.05, Fz / Math.max(1, fzRef)), LOAD_SENS_N);
  const fxCap = Math.max(1, muLong * fzLong);
  const ellipse = Math.sqrt(Math.max(0, 1 - Math.pow(fxApplied / fxCap, 2)));
  return fyMax * ellipse;
}

function clampBeta(b: number): number {
  // Allow full rotations (a spin) but keep it bounded for stability.
  const max = Math.PI;
  let x = b;
  while (x > max) x -= 2 * max;
  while (x < -max) x += 2 * max;
  return x;
}

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-6, e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Contact unsettle — a hard side/rear impact yanks the car off its line
 * (yaw + slip impulse). Same physical path as any other disturbance: the
 * driver then recovers or the car spins, from the physics.
 */
export function contactDeslot(
  car: CarSimState,
  lateralPush: number,
  severity: number,
  _discipline: DisciplineId = 'track',
): void {
  if (car.deslotImmunity > 0 || severity < 0.45) return;
  const dir = Math.sign(lateralPush) || 1;
  car.slipAngle += dir * (0.08 + 0.12 * severity);
  car.yawRate += dir * (0.4 + 0.7 * severity);
  car.dl += lateralPush * 2.0;
  car.slipAngle = Math.max(-1.1, Math.min(1.1, car.slipAngle));
  car.deslotImmunity = 0.4;
}
