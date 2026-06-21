"use client";

import { Component, Suspense, useEffect, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree, useLoader } from "@react-three/fiber";
import { useAnimations } from "@react-three/drei";
import { FBXLoader } from "three-stdlib";
import { Box3, LoopRepeat, Vector3, type Group, type Object3D, type PerspectiveCamera } from "three";

// SigningAvatar - Phase 3 Stage A.
// Loads the Mixamo character DIRECTLY as .fbx (no lossy GLB conversion) and plays
// its embedded idle clip. Falls back to a placeholder if the file is missing.
// 'active' is reserved for Stage C (switching to sign clips).

const AVATAR_URL = "/avatar.fbx";

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

function AvatarModel() {
  const fbx = useLoader(FBXLoader, AVATAR_URL);
  const camera = useThree((s) => s.camera);
  const { actions, names } = useAnimations(fbx.animations, fbx);

  useEffect(() => {
    const name = names[0];
    const action = name ? actions[name] : undefined;
    if (action) action.reset().setLoop(LoopRepeat, Infinity).fadeIn(0.2).play();
    return () => { action?.fadeOut(0.1); action?.stop(); };
  }, [actions, names]);

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

    const persp = camera as PerspectiveCamera;
    const vFov = (persp.fov * Math.PI) / 180;
    const dist = (showH * FRAME_MARGIN) / (2 * Math.tan(vFov / 2));
    persp.position.set(0, 0, dist);
    persp.near = Math.max(0.01, dist / 100);
    persp.far = dist * 100;
    persp.lookAt(0, 0, 0);
    persp.updateProjectionMatrix();
  }, [fbx, camera]);

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
}

export default function SigningAvatar(_props: SigningAvatarProps) {
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
            <AvatarModel />
          </ModelBoundary>
        </Suspense>
      </Canvas>
    </div>
  );
}