// ─────────────────────────────────────────────────────────────────────────────
// lib/signRetarget.ts — Phase 3 Stage C: drive Mixamo arm + finger bones from
// recorded MediaPipe landmarks.
//
// Arms: from poseWorld, compute shoulder→elbow (upper arm) and elbow→wrist
// (forearm) direction vectors and rotate each bone's bind direction onto the
// target (quaternion swing, eased per frame).
// Fingers: from the 21 hand landmarks, compute per-joint segment angles and curl
// the three finger segments.
// All bone lookups match Mixamo names case-insensitively by substring (the
// "mixamorig:" prefix is optional); "forearm" is checked before "arm". Missing
// bones / missing data are skipped gracefully (that limb eases back to rest).
// ─────────────────────────────────────────────────────────────────────────────

import { Object3D, Quaternion, Vector3 } from "three";

// MediaPipe world-landmark axes → avatar axes.
// LIVE-TUNABLE: set window.__signTune in the browser console to iterate without
// a rebuild, e.g.  window.__signTune = { perm:[0,1,2], sx:1, sy:-1, sz:-1 }
// perm = which source axis (0=x,1=y,2=z) feeds avatar x,y,z (lets us try all
// 48 orientations live). Defaults reproduce the original SX/SY/SZ behavior.
const _TUNE = { perm: [0, 1, 2] as number[], sx: 1, sy: -1, sz: -1 };
function _readTune() {
  if (typeof window !== "undefined") {
    const w = (window as any).__signTune;
    if (w) {
      if (Array.isArray(w.perm)) _TUNE.perm = w.perm;
      if (typeof w.sx === "number") _TUNE.sx = w.sx;
      if (typeof w.sy === "number") _TUNE.sy = w.sy;
      if (typeof w.sz === "number") _TUNE.sz = w.sz;
    }
  }
}
// Pose world landmark indices.
const POSE = { LSH: 11, RSH: 12, LEL: 13, REL: 14, LWR: 15, RWR: 16 };

// Finger curl tuning.
const FINGER_GAIN = 1.1;
const CURL_AXIS = new Vector3(0, 0, 1);
const RIGHT_CURL_SIGN = -1;
const LEFT_CURL_SIGN = 1;

type FingerKey = "thumb" | "index" | "middle" | "ring" | "pinky";
const FINGER_KEYS: FingerKey[] = ["thumb", "index", "middle", "ring", "pinky"];

interface RestInfo { localQuat: Quaternion; worldQuat: Quaternion; worldDir: Vector3 | null; }
interface Finger { b1?: Object3D; b2?: Object3D; b3?: Object3D; idx: number[]; }
interface Hand { thumb: Finger; index: Finger; middle: Finger; ring: Finger; pinky: Finger; curlSign: number; }
interface Arm { upperArm?: Object3D; foreArm?: Object3D; hand?: Object3D; }

export interface BoneMap {
  leftArm: Arm;
  rightArm: Arm;
  leftHand: Hand;
  rightHand: Hand;
  rest: Map<Object3D, RestInfo>;
}

function mkFinger(idx: number[]): Finger { return { idx }; }
function mkHand(sign: number): Hand {
  return {
    thumb: mkFinger([1, 2, 3, 4]),
    index: mkFinger([5, 6, 7, 8]),
    middle: mkFinger([9, 10, 11, 12]),
    ring: mkFinger([13, 14, 15, 16]),
    pinky: mkFinger([17, 18, 19, 20]),
    curlSign: sign,
  };
}

/** Build the bone map and capture the bind (rest) transforms. Call before the
    idle clip starts moving bones so the captured pose is the true bind. */
export function buildBoneMap(root: Object3D): BoneMap {
  const leftArm: Arm = {}, rightArm: Arm = {};
  const leftHand = mkHand(LEFT_CURL_SIGN), rightHand = mkHand(RIGHT_CURL_SIGN);

  root.traverse((o) => {
    const n = o.name.toLowerCase();
    const isLeft = n.includes("left");
    const isRight = n.includes("right");

    // Fingers first (their names also contain "hand").
    for (const fk of FINGER_KEYS) {
      if (n.includes(fk)) {
        const m = n.match(/(\d)\s*$/);
        const s = m ? parseInt(m[1], 10) : 0;
        const hand = isLeft ? leftHand : isRight ? rightHand : null;
        if (hand) {
          const f = hand[fk];
          if (s === 1) f.b1 = o; else if (s === 2) f.b2 = o; else if (s === 3) f.b3 = o;
        }
        return;
      }
    }
    if (n.includes("forearm")) {
      if (isLeft) leftArm.foreArm = o; else if (isRight) rightArm.foreArm = o;
    } else if (n.includes("arm")) {
      if (isLeft) leftArm.upperArm = o; else if (isRight) rightArm.upperArm = o;
    } else if (n.includes("hand")) {
      if (isLeft) leftArm.hand = o; else if (isRight) rightArm.hand = o;
    }
  });

  const rest = new Map<Object3D, RestInfo>();
  root.updateWorldMatrix(true, true);
  const capture = (bone?: Object3D, child?: Object3D) => {
    if (!bone) return;
    const worldQuat = bone.getWorldQuaternion(new Quaternion());
    let worldDir: Vector3 | null = null;
    if (child) {
      const a = bone.getWorldPosition(new Vector3());
      const b = child.getWorldPosition(new Vector3());
      const d = b.sub(a);
      if (d.lengthSq() > 1e-8) worldDir = d.normalize();
    }
    rest.set(bone, { localQuat: bone.quaternion.clone(), worldQuat, worldDir });
  };
  capture(leftArm.upperArm, leftArm.foreArm);
  capture(leftArm.foreArm, leftArm.hand);
  capture(rightArm.upperArm, rightArm.foreArm);
  capture(rightArm.foreArm, rightArm.hand);
  for (const hand of [leftHand, rightHand]) {
    for (const fk of FINGER_KEYS) {
      const f = hand[fk];
      capture(f.b1); capture(f.b2); capture(f.b3);
    }
  }

  return { leftArm, rightArm, leftHand, rightHand, rest };
}

function v(a: number[]): Vector3 { return new Vector3(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0); }
function mp(a: number[]): Vector3 {
  _readTune();
  const c = [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
  const p = _TUNE.perm;
  return new Vector3(c[p[0]] * _TUNE.sx, c[p[1]] * _TUNE.sy, c[p[2]] * _TUNE.sz);
}

// Rotate a bone so its bind direction points along targetDir (world space), eased.
function pointBone(bone: Object3D | undefined, rest: Map<Object3D, RestInfo>, targetDir: Vector3, ease: number) {
  if (!bone) return;
  const r = rest.get(bone);
  if (!r || !r.worldDir) return;
  if (targetDir.lengthSq() < 1e-8) return;
  const tdir = targetDir.clone().normalize();
  const swing = new Quaternion().setFromUnitVectors(r.worldDir, tdir);
  const targetWorld = swing.multiply(r.worldQuat.clone());
  const parentWorld = bone.parent ? bone.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
  const targetLocal = parentWorld.invert().multiply(targetWorld);
  bone.quaternion.slerp(targetLocal, ease);
  bone.updateWorldMatrix(false, false);
}

function easeRest(bone: Object3D | undefined, rest: Map<Object3D, RestInfo>, ease: number) {
  if (!bone) return;
  const r = rest.get(bone);
  if (!r) return;
  bone.quaternion.slerp(r.localQuat, ease);
  bone.updateWorldMatrix(false, false);
}

function curl(bone: Object3D | undefined, rest: Map<Object3D, RestInfo>, angle: number, sign: number, ease: number) {
  if (!bone) return;
  const r = rest.get(bone);
  if (!r) return;
  const q = new Quaternion().setFromAxisAngle(CURL_AXIS, sign * angle * FINGER_GAIN);
  const target = r.localQuat.clone().multiply(q);
  bone.quaternion.slerp(target, ease);
}

function applyArm(
  arm: Arm, rest: Map<Object3D, RestInfo>,
  sh: number[] | undefined, el: number[] | undefined, wr: number[] | undefined, ease: number
) {
  if (sh && el) pointBone(arm.upperArm, rest, mp(el).sub(mp(sh)), ease);
  else easeRest(arm.upperArm, rest, ease * 0.5);
  if (el && wr) pointBone(arm.foreArm, rest, mp(wr).sub(mp(el)), ease);
  else easeRest(arm.foreArm, rest, ease * 0.5);
}

function angleBetween(a: Vector3, b: Vector3): number {
  if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) return 0;
  return a.angleTo(b);
}

function applyFingers(hand: Hand, rest: Map<Object3D, RestInfo>, lms: number[][] | null, ease: number) {
  if (!lms) {
    // Missing hand → keep fingers at rest (never snap).
    for (const fk of FINGER_KEYS) {
      const f = hand[fk];
      easeRest(f.b1, rest, ease * 0.5); easeRest(f.b2, rest, ease * 0.5); easeRest(f.b3, rest, ease * 0.5);
    }
    return;
  }
  const wrist = v(lms[0] ?? [0, 0, 0]);
  for (const fk of FINGER_KEYS) {
    const f = hand[fk];
    const i0 = f.idx[0], i1 = f.idx[1], i2 = f.idx[2], i3 = f.idx[3];
    const mcp = v(lms[i0] ?? [0, 0, 0]);
    const pip = v(lms[i1] ?? [0, 0, 0]);
    const dip = v(lms[i2] ?? [0, 0, 0]);
    const tip = v(lms[i3] ?? [0, 0, 0]);
    const b1 = angleBetween(pip.clone().sub(mcp), mcp.clone().sub(wrist));
    const b2 = angleBetween(dip.clone().sub(pip), pip.clone().sub(mcp));
    const b3 = angleBetween(tip.clone().sub(dip), dip.clone().sub(pip));
    curl(f.b1, rest, b1, hand.curlSign, ease);
    curl(f.b2, rest, b2, hand.curlSign, ease);
    curl(f.b3, rest, b3, hand.curlSign, ease);
  }
}

/** Apply one cleaned frame to the rig (arms from poseWorld, fingers from hands). */
export function applySignFrame(
  map: BoneMap,
  frame: { poseWorld: number[][] | null; left: number[][] | null; right: number[][] | null },
  ease: number
) {
  const pw = frame.poseWorld;
  if (pw) {
    applyArm(map.leftArm, map.rest, pw[POSE.LSH], pw[POSE.LEL], pw[POSE.LWR], ease);
    applyArm(map.rightArm, map.rest, pw[POSE.RSH], pw[POSE.REL], pw[POSE.RWR], ease);
  } else {
    relaxAll(map, ease * 0.5);
  }
  applyFingers(map.leftHand, map.rest, frame.left, ease);
  applyFingers(map.rightHand, map.rest, frame.right, ease);
}

/** Ease every driven bone back toward its rest (used when not signing / on error). */
export function relaxAll(map: BoneMap, ease: number) {
  easeRest(map.leftArm.upperArm, map.rest, ease);
  easeRest(map.leftArm.foreArm, map.rest, ease);
  easeRest(map.rightArm.upperArm, map.rest, ease);
  easeRest(map.rightArm.foreArm, map.rest, ease);
  for (const hand of [map.leftHand, map.rightHand]) {
    for (const fk of FINGER_KEYS) {
      const f = hand[fk];
      easeRest(f.b1, map.rest, ease); easeRest(f.b2, map.rest, ease); easeRest(f.b3, map.rest, ease);
    }
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Procedural HELLO wave — deterministic "hero" sign (Phase 3 Stage C polish).
// Points the right arm to chosen WORLD-space directions (no source-axis guess),
// oscillates the forearm for a wave, opens the right hand. Left arm rests.
// LIVE-TUNABLE: set window.__hello = { up:[x,y,z], fore:[x,y,z], wave, freq }
// in the console to iterate without a rebuild, then bake winning values here.
// ─────────────────────────────────────────────────────────────────────────────
export function applyHelloFrame(map: BoneMap, tSec: number, ease: number) {
  const cfg = { up: [0.35, 0.55, 0.25], fore: [0.05, 1, 0.25], wave: 0.35, freq: 6 };
  if (typeof window !== "undefined") {
    const w = (window as any).__hello;
    if (w) {
      if (Array.isArray(w.up)) cfg.up = w.up;
      if (Array.isArray(w.fore)) cfg.fore = w.fore;
      if (typeof w.wave === "number") cfg.wave = w.wave;
      if (typeof w.freq === "number") cfg.freq = w.freq;
    }
  }
  const wob = Math.sin(tSec * cfg.freq) * cfg.wave;
  const upDir = new Vector3(cfg.up[0], cfg.up[1], cfg.up[2]);
  const foreDir = new Vector3(cfg.fore[0] + wob, cfg.fore[1], cfg.fore[2]);
  pointBone(map.rightArm.upperArm, map.rest, upDir, ease);
  pointBone(map.rightArm.foreArm, map.rest, foreDir, ease);
  easeRest(map.leftArm.upperArm, map.rest, ease);
  easeRest(map.leftArm.foreArm, map.rest, ease);
  for (const fk of FINGER_KEYS) {
    const f = map.rightHand[fk];
    easeRest(f.b1, map.rest, ease); easeRest(f.b2, map.rest, ease); easeRest(f.b3, map.rest, ease);
  }
}
