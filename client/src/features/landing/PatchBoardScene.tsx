import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { BoardCable, BoardModule } from './board';
import {
  CABLES,
  MODULES,
  MODULE_HEIGHT,
  MODULE_WIDTH,
  PULSE_ROUTE,
  jackPosition,
  moduleById,
} from './board';

const MODULE_DEPTH = 0.42;
const HOP_SECONDS = 0.85;
const REST_SECONDS = 1.2;
const LOOP_SECONDS = PULSE_ROUTE.length * HOP_SECONDS + REST_SECONDS;

/** A cable hangs from its two jacks: it lifts off the board and sags under gravity. */
function cableCurve({ from, to, sag }: BoardCable): THREE.CatmullRomCurve3 {
  const a = moduleById(from);
  const b = moduleById(to);
  const start = jackPosition(a, b);
  const end = jackPosition(b, a);
  const points: THREE.Vector3[] = [];
  const steps = 14;
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const hang = 4 * t * (1 - t);
    points.push(
      new THREE.Vector3(
        THREE.MathUtils.lerp(start.x, end.x, t),
        THREE.MathUtils.lerp(start.y, end.y, t) - sag * hang,
        MODULE_DEPTH * 0.6 + hang * 0.55,
      ),
    );
  }
  return new THREE.CatmullRomCurve3(points);
}

function labelTexture(module: BoardModule): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = module.ink;
    context.font = '600 76px "Archivo Variable", Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(module.label, 256, 134);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function Perforations() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const columns = 30;
  const rows = 18;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    const scale = new THREE.Vector3(1, 1, 1);
    let index = 0;
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const position = new THREE.Vector3(
          (column - (columns - 1) / 2) * 0.55,
          (row - (rows - 1) / 2) * 0.55,
          0.005,
        );
        mesh.setMatrixAt(index, matrix.compose(position, rotation, scale));
        index += 1;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, columns * rows]}>
      <cylinderGeometry args={[0.045, 0.045, 0.01, 12]} />
      <meshStandardMaterial color="#0E1012" />
    </instancedMesh>
  );
}

function Board() {
  const body = useMemo(
    () => new RoundedBoxGeometry(MODULE_WIDTH, MODULE_HEIGHT, MODULE_DEPTH, 4, 0.07),
    [],
  );
  const curves = useMemo(() => CABLES.map(cableCurve), []);
  const tubes = useMemo(
    () => curves.map((curve) => new THREE.TubeGeometry(curve, 64, 0.055, 10, false)),
    [curves],
  );
  const labels = useMemo(() => MODULES.map(labelTexture), []);

  const group = useRef<THREE.Group>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const moduleRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glow = useRef<THREE.PointLight>(null);
  const position = useMemo(() => new THREE.Vector3(), []);

  useEffect(
    () => () => {
      body.dispose();
      tubes.forEach((tube) => tube.dispose());
      labels.forEach((label) => label.dispose());
    },
    [body, tubes, labels],
  );

  const { viewport } = useThree();
  // A narrow frame cannot fit the whole board at full size.
  const fit = Math.min(1, viewport.width / 13.5);

  useFrame(({ clock, pointer }, delta) => {
    const time = clock.elapsedTime;

    if (group.current) {
      // The board leans gently toward the pointer.
      const damping = 1 - Math.exp(-delta * 4);
      group.current.rotation.y += (pointer.x * 0.12 - group.current.rotation.y) * damping;
      group.current.rotation.x += (-0.62 - pointer.y * 0.08 - group.current.rotation.x) * damping;
    }

    const elapsed = time % LOOP_SECONDS;
    const hop = Math.floor(elapsed / HOP_SECONDS);
    const step = PULSE_ROUTE[hop];
    const resting = !step;

    if (pulse.current && glow.current) {
      pulse.current.visible = !resting;
      glow.current.visible = !resting;
      if (step) {
        const raw = (elapsed % HOP_SECONDS) / HOP_SECONDS;
        const eased = raw * raw * (3 - 2 * raw);
        const curve = curves[step.cable];
        curve?.getPointAt(step.reverse ? 1 - eased : eased, position);
        pulse.current.position.copy(position);
        glow.current.position.copy(position);
      }
    }

    // The module a pulse just reached presses down, then springs back.
    const reached = step
      ? (() => {
          const cable = CABLES[step.cable];
          return cable ? (step.reverse ? cable.from : cable.to) : undefined;
        })()
      : 'answer';
    const progress = step ? (elapsed % HOP_SECONDS) / HOP_SECONDS : 1;
    MODULES.forEach((module, index) => {
      const mesh = moduleRefs.current[index];
      if (!mesh) return;
      const pressing = module.id === reached && progress > 0.82;
      const target = pressing ? MODULE_DEPTH / 2 - 0.1 : MODULE_DEPTH / 2;
      mesh.position.z += (target - mesh.position.z) * (1 - Math.exp(-delta * 18));
    });
  });

  return (
    <group ref={group} scale={fit} rotation={[-0.62, 0, -0.07]}>
      <mesh receiveShadow position={[0, 0, -0.02]}>
        <planeGeometry args={[18, 11]} />
        <meshStandardMaterial color="#1B1E22" roughness={0.82} metalness={0.2} />
      </mesh>
      <Perforations />

      {MODULES.map((module, index) => (
        <mesh
          key={module.id}
          ref={(mesh) => {
            moduleRefs.current[index] = mesh;
          }}
          geometry={body}
          position={[module.x, module.y, MODULE_DEPTH / 2]}
          castShadow
        >
          <meshStandardMaterial color={module.color} roughness={0.42} metalness={0.05} />
          <mesh position={[0, 0, MODULE_DEPTH / 2 + 0.002]}>
            <planeGeometry args={[MODULE_WIDTH, MODULE_WIDTH / 2]} />
            <meshBasicMaterial map={labels[index]} transparent toneMapped={false} />
          </mesh>
        </mesh>
      ))}

      {tubes.map((tube, index) => (
        <mesh key={index} geometry={tube} castShadow>
          <meshStandardMaterial color={CABLES[index]?.color} roughness={0.5} />
        </mesh>
      ))}

      <mesh ref={pulse}>
        <sphereGeometry args={[0.13, 20, 20]} />
        <meshBasicMaterial color="#FFFFFF" toneMapped={false} />
      </mesh>
      <pointLight ref={glow} color="#FDBA74" intensity={7} distance={3} />
    </group>
  );
}

function ShadowLight() {
  const light = useRef<THREE.DirectionalLight>(null);
  useLayoutEffect(() => {
    const camera = light.current?.shadow.camera;
    if (!camera) return;
    camera.left = -10;
    camera.right = 10;
    camera.top = 8;
    camera.bottom = -8;
    camera.updateProjectionMatrix();
  }, []);
  return (
    <directionalLight
      ref={light}
      position={[-5, 6, 9]}
      intensity={2.4}
      castShadow
      shadow-mapSize={[1024, 1024]}
    />
  );
}

/** The 3D board in the hero. Loaded on its own, so nothing else on the page pays for three.js. */
export default function PatchBoardScene({
  active,
  onReady,
}: {
  active: boolean;
  onReady: () => void;
}) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      frameloop={active ? 'always' : 'never'}
      camera={{ position: [0, 0, 13], fov: 36 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={onReady}
      aria-hidden
    >
      <ambientLight intensity={1.1} />
      <ShadowLight />
      <Board />
    </Canvas>
  );
}
