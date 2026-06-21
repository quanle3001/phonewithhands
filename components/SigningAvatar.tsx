"use client";

import { Component, Suspense, useEffect, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree, useLoader } from "@react-three/fiber";
import { useAnimations } from "@react-three/drei";
import { FBXLoader } from "three-stdlib";
import {
  Box3, LoopRepeat, LoopOnce, Vector3,
  type AnimationAction, type AnimationClip, type Group, type Object3D, type PerspectiveCamera,
} from "three";

// Normalize a gloss token the same way the recognizer does (UPPER + underscores).
function normalizeToken(tok: string): string {
  return tok.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

// SigningAvatar — Phase 3 (simplified).
// Loads the Mixamo character (.fbx) and plays its embedded idle clip. The ONLY
// sign it animates is HELLO: when the gloss contains HELLO it plays a real
// Mixamo "Waving" clip (public/wave.fbx, same character) once, then crossfades
// back to idle. Every other gloss → stays idle (the comprehension text carries
// the meaning). If wave.fbx is missing, HELLO also just stays idle — the demo
// never breaks. Falls back to a placeholder mesh if the character .fbx is missing.

const AVATAR_URL = "/avatar.fbx";
const WAVE_URL = "/wave.fbx";   // Mixamo "Waving" clip (same character, Without Skin, In Place)

function IdleRig({ children }: { children: ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    g.position.y = Math.sin(t * 1.2) * 0.02;
    g.rotation.y = Math.sin(t * 0.5) * 0.05;
    g.rotation.x = Math.sin(t * 1.2) * 0.012;
  });
  return <group ref={ref}>{children}</group>;
}

const HEAD_TARGET_Y = 0.62;
const PLACEHOLDER_HEAD_TOP = 1.83;

const UPPER_FRACTION = 0.30;
const FRAME_MARGIN = 1.22;
const CHEST_BIAS_FRAC = 0.09;

function AvatarModel({ gloss }: { gloss?: string[] }) {
  const fbx = useLoader(FBXLoader, AVATAR_URL);
  const camera = useThree((s) => s.camera);
  const { actions, names, mixer } = useAnimations(fbx.animations, fbx);

  const idleRef = useRef<AnimationAction | null>(null);
  const waveRef = useRef<AnimationAction | null>(null);
  const pendingHelloRef = useRef(false);

  // ── Setup: frame the upper body, start idle ──
  useEffect(() => {
    const obj = fbx as unknown as Object3D;
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    obj.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(obj);
    const size = new Vector3();
    box.getSize(size);
    const center = new Vector3();
    box.getCenter(center);

    const showH = Math.max(0.001, size.y * UPPER_FRACTION);
    const centerY = box.max.y - showH / 2 - showH * CHEST_BIAS_FRAC;
    obj.position.set(-center.x, -centerY, -center.z);
    obj.updateWorldMatrix(true, true);

    const persp = camera as PerspectiveCamera;
    const vFov = (persp.fov * Math.PI) / 180;
    const dist = (showH * FRAME_MARGIN) / (2 * Math.tan(vFov / 2));
    persp.position.set(0, 0, dist);
    persp.near = Math.max(0.01, dist / 100);
    persp.far = dist * 100;
    persp.lookAt(0, 0, 0);
    persp.updateProjectionMatrix();

    const name = names[0];
    const action = name ? actions[name] : undefined;
    idleRef.current = action ?? null;
    action?.reset().setLoop(LoopRepeat, Infinity).fadeIn(0.2).play();
    return () => { action?.stop(); };
  }, [fbx, camera, actions, names]);

  // ── Load the Mixamo wave clip once (graceful if the file is missing) ──
  useEffect(() => {
    let on = true;
    new FBXLoader().load(
      WAVE_URL,
      (loaded) => {
        if (!on) return;
        const clip = loaded.animations?.[0] as AnimationClip | undefined;
        if (!clip) { console.warn("[wave] wave.fbx has no animation track"); return; }
        clip.name = "WAVE";
        const action = mixer.clipAction(clip, fbx);
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
        waveRef.current = action;
        if (pendingHelloRef.current) {
          pendingHelloRef.current = false;
          idleRef.current?.fadeOut(0.2);
          action.reset().setLoop(LoopOnce, 1).fadeIn(0.2).play();
        }
      },
      undefined,
      () => { console.warn("[wave] /wave.fbx not found — HELLO will stay idle"); },
    );
    return () => { on = false; };
  }, [fbx, mixer]);

  // ── When the wave finishes, crossfade back to idle ──
  useEffect(() => {
    const onFinished = (e: { action: AnimationAction }) => {
      if (e.action === waveRef.current) {
        waveRef.current?.fadeOut(0.3);
        idleRef.current?.reset().fadeIn(0.3).play();
      }
    };
    mixer.addEventListener("finished", onFinished as never);
    return () => { mixer.removeEventListener("finished", onFinished as never); };
  }, [mixer]);

  // ── Play the wave ONLY when the gloss contains HELLO; else stay idle ──
  const signKey = (gloss ?? []).map(normalizeToken).join(",");
  useEffect(() => {
    if (!signKey) return;
    if (!signKey.split(",").includes("HELLO")) return; // everything else → idle
    const wave = waveRef.current;
    if (!wave) { pendingHelloRef.current = true; return; } // wave still loading → play when ready
    idleRef.current?.fadeOut(0.2);
    wave.reset().setLoop(LoopOnce, 1).fadeIn(0.2).play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signKey]);

  return <primitive object={fbx} />;
}

function Placeholder() {
  const skin = "#C9D4E0";
  const accent = "#007AFF";
  return (
    <group position={[0, HEAD_TARGET_Y - PLACEHOLDER_HEAD_TOP, 0]}>
      <mesh position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.28, 32, 32]} />
        <meshStandardMaterial color={skin} roughness={0.6} metalness={0.05} />
      </mesh>
      <mesh position={[0, 1.28, 0]}>
        <cylinderGeometry args={[0.1, 0.12, 0.18, 24]} />
        <meshStandardMaterial color={skin} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <capsuleGeometry args={[0.34, 0.55, 8, 24]} />
        <meshStandardMaterial color={accent} roughness={0.5} />
      </mesh>
      <mesh position={[-0.42, 0.95, 0]} rotation={[0, 0, 0.32]}>
        <capsuleGeometry args={[0.1, 0.55, 8, 16]} />
        <meshStandardMaterial color={accent} roughness={0.5} />
      </mesh>
      <mesh position={[0.42, 0.95, 0]} rotation={[0, 0, -0.32]}>
        <capsuleGeometry args={[0.1, 0.55, 8, 16]} />
        <meshStandardMaterial color={accent} roughness={0.5} />
      </mesh>
    </group>
  );
}

interface BoundaryProps { children: ReactNode; fallback: ReactNode }
interface BoundaryState { failed: boolean }
class ModelBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };
  static getDerivedStateFromError(): BoundaryState { return { failed: true }; }
  componentDidCatch() {}
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export interface SigningAvatarProps {
  active?: boolean;
  /** Gloss tokens. Only HELLO is animated (Mixamo wave); all others stay idle. */
  gloss?: string[];
}

export default function SigningAvatar({ gloss }: SigningAvatarProps) {
  return (
    <div
      className="w-full rounded-[10px] overflow-hidden"
      style={{
        aspectRatio: "4 / 3",
        maxWidth: "100%",
        maxHeight: "min(320px, 40vh)",
        background: "linear-gradient(180deg, #F2F4F7 0%, #E8ECF1 100%)",
        border: "1px solid rgba(60,60,67,0.10)",
      }}
    >
      <Canvas
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 0, 2.4], fov: 30 }}
      >
        <ambientLight intensity={0.85} />
        <directionalLight position={[2, 3, 4]} intensity={1.0} />
        <directionalLight position={[-3, 2, -2]} intensity={0.4} />
        <Suspense fallback={null}>
          <ModelBoundary fallback={<IdleRig><Placeholder /></IdleRig>}>
            <AvatarModel gloss={gloss} />
          </ModelBoundary>
        </Suspense>
      </Canvas>
    </div>
  );
}