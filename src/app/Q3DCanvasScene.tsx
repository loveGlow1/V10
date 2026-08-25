"use client";

import { Component, Suspense, useRef, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const ROTATION_PERIOD_SECONDS = 16; // one full revolution every 16s, constant/linear

/* Where the turn begins. Face-on to this camera the key lights rake straight past the
   bevels and the extruded side wall is hidden, so the first frame would render as a flat
   black silhouette; a three-quarter turn puts the side wall and the inner rim into the
   light from the outset. */
const START_ROTATION_Y = -0.45;

// Obsidian black �� deep, near-mirror body color shared by the ring and the tail.
const OBSIDIAN_BLACK = "#08080A";

// Ring proportions, shared by the ring shape and the tail's penetration math below.
const RING_OUTER_RADIUS = 2.0;
const RING_INNER_RADIUS = 1.35; // inner hollow / hole boundary

// The tail is a straight diagonal block that crosses through the ring wall —
// it starts inside the inner hollow (radius < RING_INNER_RADIUS), passes through
// the bottom-right section of the wall (between RING_INNER_RADIUS and
// RING_OUTER_RADIUS), and continues outward past the outer edge, all along a
// single radial line at TAIL_ANGLE (measured from +X, clockwise = negative).
const TAIL_ANGLE = -Math.PI / 4; // 45° down-and-to-the-right
const TAIL_INNER_REACH = 0.55; // well inside the hollow, short of the center
const TAIL_OUTER_REACH = 2.75; // protrudes past the outer wall
const TAIL_STROKE_WIDTH = 0.8;

// Shared extrude settings so the tail has identical depth/bevel/curve quality
// as the ring — this is what lets the two pieces merge into one seamless mesh.
const EXTRUDE_DEPTH = 0.5;
const SHARED_EXTRUDE_SETTINGS = {
  depth: EXTRUDE_DEPTH,
  bevelEnabled: true,
  bevelSegments: 32,
  curveSegments: 128, // fixes the faceted/low-poly look — was defaulting to 12
  steps: 2,
  bevelSize: 0.06,
  bevelThickness: 0.06,
};

// Camera position for the slight three-quarter viewing angle described in the
// design brief: shifted right and raised above center so the ring's right
// outer edge and top-inner rim catch visible depth/shading, instead of the
// flat, dead-on silhouette a straight-on [0, 0, z] camera would give.
const CAMERA_X_OFFSET = 2.4; // shift right, toward the ring's outer edge
const CAMERA_Y_ELEVATION = 1.7; // raise above center, toward the top-inner rim
// Pulled back further than the ring's own footprint requires so that the
// tail's full diagonal reach (TAIL_OUTER_REACH) stays inside the camera's
// frustum at every angle of the 360° Y-axis spin, instead of just clearing
// the ring alone — this is what stops the tail tip from hard-clipping
// against the canvas edges as it rotates through.
const CAMERA_Z_DISTANCE = 9.5;

// GlintLight config: a fast-orbiting point light, independent of the slow 16s
// body spin, so a bright specular glint visibly sweeps across the ring/tail's
// beveled edges every few seconds instead of only reflecting the fixed
// key/rim lights.
const GLINT_PERIOD_SECONDS = 4.5;
const GLINT_ORBIT_RADIUS = 3.4;
// Flattens the orbit's Y extent relative to X, so the glint traces an
// ellipse (wide sweep, shallow rise/fall) rather than a full circle — this
// keeps the flash grazing across the ring's edges instead of swinging
// directly overhead/underneath where it would be less visible.
const GLINT_VERTICAL_COMPRESSION = 0.5;

class EnvironmentErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("Q3DCanvas: failed to load studio environment, rendering without it.", error);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

/* The mark is rendered in several places at once (nav, hero, footer, auth modal), and
   neither the geometry nor the material varies between them — the per-instance scale is
   applied to the group, not the geometry. Building them once for the page instead of once
   per <Canvas> matters because the extrude is not cheap: two shapes at curveSegments 128 /
   bevelSegments 32, then a merge. Doing that work three times was delaying the mark's first
   paint on slower devices. Nothing disposes either object — they live for the page's
   lifetime — so a shared instance is safe across the separate renderers. */
let sharedObsidianMaterial: THREE.MeshPhysicalMaterial | null = null;

function getObsidianMirrorMaterial() {
  if (sharedObsidianMaterial) return sharedObsidianMaterial;

  // Shared by the ring AND the tail so both read as one continuous piece of
  // ultra-glossy obsidian metal — deep black body with crisp mirror-bright
  // specular highlights rather than a flat matte or silver look.
  sharedObsidianMaterial = new THREE.MeshPhysicalMaterial({
    color: OBSIDIAN_BLACK,
    metalness: 0.9,
    roughness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    reflectivity: 1.0,
    envMapIntensity: 1.4,
    flatShading: false,
  });

  return sharedObsidianMaterial;
}

let sharedLogoGeometry: THREE.BufferGeometry | null = null;

function getLogoGeometry(): THREE.BufferGeometry {
  if (sharedLogoGeometry) return sharedLogoGeometry;


  // --- Ring: a flat annulus (outer circle minus inner hole), extruded. ---
  const ringShape = new THREE.Shape();
  ringShape.absarc(0, 0, RING_OUTER_RADIUS, 0, Math.PI * 2, false);

  const innerHole = new THREE.Path();
  innerHole.absarc(0, 0, RING_INNER_RADIUS, 0, Math.PI * 2, true);
  ringShape.holes.push(innerHole);

  const ringGeometry = new THREE.ExtrudeGeometry(ringShape, SHARED_EXTRUDE_SETTINGS);

  // --- Tail: a straight block built directly along the target radial line,
  // so it naturally starts inside the hollow and ends past the outer wall —
  // no boolean subtraction is needed because the ring already has an open
  // hole for the tail to cross through. ---
  const tailShape = new THREE.Shape();
  tailShape.moveTo(-TAIL_STROKE_WIDTH / 2, TAIL_INNER_REACH);
  tailShape.lineTo(TAIL_STROKE_WIDTH / 2, TAIL_INNER_REACH);
  tailShape.lineTo(TAIL_STROKE_WIDTH / 2, TAIL_OUTER_REACH);
  tailShape.lineTo(-TAIL_STROKE_WIDTH / 2, TAIL_OUTER_REACH);
  tailShape.closePath();

  const tailGeometry = new THREE.ExtrudeGeometry(tailShape, SHARED_EXTRUDE_SETTINGS);
  // The shape's local +Y axis currently points straight "up" (90°); rotating
  // it about the shared origin by (TAIL_ANGLE - PI/2) swings that same axis
  // to point along TAIL_ANGLE instead, so the block now runs from
  // TAIL_INNER_REACH to TAIL_OUTER_REACH along the 45° diagonal — starting
  // inside the ring's inner hollow, crossing the wall, and exiting outward.
  tailGeometry.rotateZ(TAIL_ANGLE - Math.PI / 2);

  // Merge into a single BufferGeometry (one mesh, one draw call) so the tail
  // reads as an inseparable part of the ring body rather than a bolted-on
  // piece — same depth, bevel, and material by construction.
  const merged = mergeGeometries([ringGeometry, tailGeometry], false);
  if (!merged) {
    // mergeGeometries only returns null if attribute layouts mismatch, which
    // can't happen here since both shapes use the same ExtrudeGeometry
    // settings — kept as a defensive fallback so a build-time regression
    // still renders the ring (without its tail) instead of crashing the
    // canvas outright.
    // eslint-disable-next-line no-console
    console.warn(
      "Q3DCanvas: failed to merge ring and tail geometries (mismatched attribute layout); rendering ring only."
    );
    const fallback = ringGeometry.clone();
    fallback.center();
    sharedLogoGeometry = fallback;
    return sharedLogoGeometry;
  }
  // Both pieces share identical extrude settings, so their z-range is
  // already identical; simply re-center that shared depth around 0 without
  // touching x/y (which must stay put — the ring's circular symmetry keeps
  // it centered, and the tail's radial offset from the origin must not be
  // disturbed, or it would no longer line up with the ring's hole/wall).
  merged.translate(0, 0, -EXTRUDE_DEPTH / 2);
  sharedLogoGeometry = merged;
  return sharedLogoGeometry;
}

function QLogo({ scale = 1 }: { scale?: number }) {
  const groupRef = useRef<THREE.Group>(null);

  const obsidianMirrorMaterial = getObsidianMirrorMaterial();
  const logoGeometry = getLogoGeometry();

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    // Continuous linear Y-axis rotation only — no easing, no acceleration.
    groupRef.current.rotation.y += (delta * (Math.PI * 2)) / ROTATION_PERIOD_SECONDS;
  });

  return (
    <group
      ref={groupRef}
      position={[-0.12, 0.12, 0]}
      rotation={[0, START_ROTATION_Y, 0]}
      scale={[scale, scale, scale]}
    >
      <mesh geometry={logoGeometry} material={obsidianMirrorMaterial} frustumCulled={false} />
    </group>
  );
}

// A fast-orbiting point light, independent of the slow 16s body spin, so a
// bright specular glint visibly sweeps across the ring/tail's beveled edges
// every few seconds instead of only reflecting the fixed key/rim lights.
function GlintLight() {
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    if (!lightRef.current) return;
    const angle = (clock.getElapsedTime() / GLINT_PERIOD_SECONDS) * Math.PI * 2;
    lightRef.current.position.set(
      Math.cos(angle) * GLINT_ORBIT_RADIUS,
      Math.sin(angle) * GLINT_ORBIT_RADIUS * GLINT_VERTICAL_COMPRESSION,
      2.6
    );
  });

  return <pointLight ref={lightRef} color="#ffffff" intensity={6} distance={9} decay={2} />;
}

export default function Q3DCanvasScene({
  scale = 1,
  className = "",
  withBackdrop = false,
}: {
  scale?: number;
  className?: string;
  /** Pitch-black background + faint ambient particles, for standalone/hero display
   *  (kept off by default so the small inline logo instances — nav, footer, login
   *  modal — stay transparent and blend into the page behind them). */
  withBackdrop?: boolean;
}) {
  return (
    <Canvas
      className={className}
      style={{ width: "100%", height: "100%" }}
      gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      dpr={[1, 2]}
      // Slight three-quarter angle: raised and shifted to the right of center so
      // the ring's right outer edge and top-inner rim catch visible depth/shading
      // instead of the flat, dead-on silhouette a straight-on [0,0,z] camera gives.
      camera={{
        fov: 45,
        near: 0.1,
        far: 100,
        position: [CAMERA_X_OFFSET, CAMERA_Y_ELEVATION, CAMERA_Z_DISTANCE],
      }}
    >
      {withBackdrop && (
        <>
          {/* Faint ambient particles drifting in the background. */}
          <Sparkles count={80} scale={9} size={1.4} speed={0.25} opacity={0.35} color="#ffffff" />
        </>
      )}
      {/* Environment loads an HDRI asynchronously; if the fetch fails (e.g. a
          network hiccup or blocked CDN) it throws rather than just suspending,
          which would otherwise crash the whole canvas. Suspense + an error
          boundary let the logo still render (without env reflections) instead
          of taking down the page. */}
      <Suspense fallback={null}>
        <EnvironmentErrorBoundary>
          <Environment preset="studio" />
        </EnvironmentErrorBoundary>
      </Suspense>
      {/* Raised ambient plus an added front-lower fill light so the ring reads as a
          consistent obsidian metal all the way around as it spins, instead of the
          far side falling into total black and only catching highlights on the
          near side (previously it visibly "switched" between dark and lit
          mid-rotation). */}
      <ambientLight intensity={0.45} />
      {/* Crisp, bright white specular key light from the upper right — this is what
          produces the sharp mirror-bright highlight along the ring's right outer
          rim edge. */}
      <directionalLight position={[5, 5, 4]} intensity={2.6} color="#ffffff" />
      {/* Soft directional rim light (brand-green tinted) grazing the far edge. */}
      <directionalLight position={[-6, -6, -4]} intensity={0.35} color={0x8ef08a} />
      <directionalLight position={[-4, 6, -3]} intensity={1.6} color="#ffffff" />
      {/* Front-lower fill light — added alongside the raised ambient above. */}
      <directionalLight position={[4, -5, 5]} intensity={0.8} color="#ffffff" />
      <GlintLight />
      <QLogo scale={scale} />
    </Canvas>
  );
}
