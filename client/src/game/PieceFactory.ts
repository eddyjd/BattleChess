import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type PieceColor = "w" | "b";

/**
 * A piece is a THREE.Group carrying metadata + references to its materials
 * so the battle director can flash/dissolve it.
 */
export interface PieceObject extends THREE.Group {
  userData: {
    type: PieceType;
    color: PieceColor;
    square: string;
    materials: THREE.MeshStandardMaterial[];
    /** Approximate height in world units, for camera framing & FX. */
    height: number;
  };
}

/**
 * Optional GLTF source. If you download a free chess set (e.g. a CC0 pack
 * from Kenney / Poly Pizza / Sketchfab) and drop the .glb files in
 * `client/public/models/`, register them here and they'll be used instead
 * of the procedural meshes. The procedural set is always the safe fallback,
 * so the game renders correctly with or without downloaded assets.
 *
 * Each entry maps "<color><type>" (e.g. "wq", "bn") to a model URL.
 */
// Paths are relative to the app base so the pack works under any deploy
// sub-path (e.g. GitHub Pages at /BattleChess/). Resolved via BASE_URL below.
const MODEL_SOURCES: Partial<Record<string, string>> = {
  wp: "models/wp.glb", wn: "models/wn.glb", wb: "models/wb.glb",
  wr: "models/wr.glb", wq: "models/wq.glb", wk: "models/wk.glb",
  bp: "models/bp.glb", bn: "models/bn.glb", bb: "models/bb.glb",
  br: "models/br.glb", bq: "models/bq.glb", bk: "models/bk.glb",
};

const loader = new GLTFLoader();
const modelCache = new Map<string, THREE.Object3D>();

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

function makeArmyMaterial(color: PieceColor): THREE.MeshStandardMaterial {
  if (color === "w") {
    return new THREE.MeshStandardMaterial({
      color: 0xf2ecd8,
      roughness: 0.32,
      metalness: 0.35,
      emissive: new THREE.Color(0xffd27f),
      emissiveIntensity: 0,
    });
  }
  return new THREE.MeshStandardMaterial({
    color: 0x23262f,
    roughness: 0.34,
    metalness: 0.62,
    emissive: new THREE.Color(0x6ea8ff),
    emissiveIntensity: 0,
  });
}

/* ------------------------------------------------------------------ */
/* Procedural geometry helpers                                         */
/* ------------------------------------------------------------------ */

function lathe(profile: [number, number][], mat: THREE.Material, segments = 48): THREE.Mesh {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function ball(r: number, y: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

// --- Profiles (radius, height) bottom -> top -------------------------------

const PAWN: [number, number][] = [
  [0, 0], [0.46, 0], [0.46, 0.05], [0.38, 0.10], [0.29, 0.14],
  [0.33, 0.19], [0.20, 0.24], [0.16, 0.30], [0.15, 0.45], [0.23, 0.51],
  [0.15, 0.55],
];
const ROOK: [number, number][] = [
  [0, 0], [0.50, 0], [0.50, 0.06], [0.40, 0.11], [0.31, 0.16],
  [0.29, 0.55], [0.40, 0.62], [0.40, 0.78],
];
const BISHOP: [number, number][] = [
  [0, 0], [0.47, 0], [0.47, 0.06], [0.37, 0.11], [0.27, 0.17],
  [0.18, 0.24], [0.16, 0.52], [0.27, 0.60], [0.14, 0.66], [0.19, 0.86], [0.0, 0.98],
];
const QUEEN: [number, number][] = [
  [0, 0], [0.51, 0], [0.51, 0.06], [0.41, 0.11], [0.31, 0.17],
  [0.20, 0.26], [0.17, 0.62], [0.28, 0.70], [0.16, 0.76], [0.30, 0.88],
];
const KING: [number, number][] = [
  [0, 0], [0.53, 0], [0.53, 0.06], [0.43, 0.11], [0.33, 0.17],
  [0.21, 0.28], [0.18, 0.68], [0.29, 0.76], [0.17, 0.82], [0.31, 0.96],
];
const KNIGHT_BASE: [number, number][] = [
  [0, 0], [0.49, 0], [0.49, 0.06], [0.39, 0.11], [0.30, 0.16], [0.27, 0.24],
];

const HEIGHTS: Record<PieceType, number> = {
  p: 0.78, r: 0.82, n: 1.05, b: 1.02, q: 1.28, k: 1.4,
};

function buildProcedural(type: PieceType, color: PieceColor): PieceObject {
  const mat = makeArmyMaterial(color);
  const accent = makeArmyMaterial(color);
  accent.metalness = Math.min(1, mat.metalness + 0.2);
  const group = new THREE.Group() as PieceObject;
  const materials = [mat, accent];

  switch (type) {
    case "p": {
      group.add(lathe(PAWN, mat));
      group.add(ball(0.2, 0.7, mat));
      break;
    }
    case "r": {
      group.add(lathe(ROOK, mat));
      // Crenellated battlements around the rim.
      const ring = 7;
      for (let i = 0; i < ring; i++) {
        const a = (i / ring) * Math.PI * 2;
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), accent);
        merlon.position.set(Math.cos(a) * 0.34, 0.86, Math.sin(a) * 0.34);
        merlon.castShadow = true;
        group.add(merlon);
      }
      break;
    }
    case "b": {
      group.add(lathe(BISHOP, mat));
      group.add(ball(0.09, 1.05, accent));
      break;
    }
    case "n": {
      group.add(lathe(KNIGHT_BASE, mat));
      group.add(buildKnightHead(accent));
      break;
    }
    case "q": {
      group.add(lathe(QUEEN, mat));
      // Crown of spikes.
      const spikes = 8;
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2;
        group.add(ball(0.075, 0.96, accent).translateX(Math.cos(a) * 0.3).translateZ(Math.sin(a) * 0.3));
      }
      group.add(ball(0.12, 1.06, accent));
      break;
    }
    case "k": {
      group.add(lathe(KING, mat));
      group.add(ball(0.1, 1.0, accent));
      // Cross finial.
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), accent);
      v.position.y = 1.18;
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.08), accent);
      h.position.y = 1.18;
      v.castShadow = h.castShadow = true;
      group.add(v, h);
      break;
    }
  }

  group.userData = { type, color, square: "", materials, height: HEIGHTS[type] };
  return group;
}

/** A stylised horse head/neck built from an extruded 2D silhouette. */
function buildKnightHead(mat: THREE.Material): THREE.Group {
  const s = new THREE.Shape();
  // Silhouette in the X-Y plane (neck rising from the base, head + muzzle).
  s.moveTo(-0.16, 0.0);
  s.lineTo(0.18, 0.0);
  s.quadraticCurveTo(0.26, 0.34, 0.12, 0.52);
  s.quadraticCurveTo(0.34, 0.56, 0.40, 0.74); // muzzle out front
  s.quadraticCurveTo(0.30, 0.80, 0.18, 0.78);
  s.quadraticCurveTo(0.16, 0.86, 0.06, 0.9); // ears
  s.quadraticCurveTo(0.02, 0.82, -0.04, 0.82);
  s.quadraticCurveTo(-0.2, 0.74, -0.22, 0.5);
  s.quadraticCurveTo(-0.26, 0.28, -0.16, 0.0);

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.34,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 3,
    steps: 1,
  });
  geo.center();
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const wrap = new THREE.Group();
  // Raise so the neck base meets the lathe top, and face along +X.
  mesh.position.y = 0.66;
  wrap.add(mesh);
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Public factory                                                      */
/* ------------------------------------------------------------------ */

function applyMeta(group: PieceObject, type: PieceType, color: PieceColor): PieceObject {
  const materials: THREE.MeshStandardMaterial[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      const m = o.material;
      if (m instanceof THREE.MeshStandardMaterial) materials.push(m);
    }
  });
  group.userData = { type, color, square: "", materials, height: HEIGHTS[type] };
  return group;
}

/** Load (once) and cache a normalised model. Returns the shared original. */
async function loadModel(type: PieceType, color: PieceColor): Promise<THREE.Object3D | null> {
  const key = `${color}${type}`;
  const rel = MODEL_SOURCES[key];
  if (!rel) return null;
  if (modelCache.has(key)) return modelCache.get(key)!;
  const url = import.meta.env.BASE_URL + rel;
  try {
    const gltf = await loader.loadAsync(url);
    const root = gltf.scene;
    // Normalise so the piece stands on the ground at the right height.
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    root.scale.setScalar(HEIGHTS[type] / (size.y || 1));
    const grounded = new THREE.Box3().setFromObject(root);
    root.position.y -= grounded.min.y;
    root.updateMatrixWorld(true);
    modelCache.set(key, root);
    return root;
  } catch (err) {
    console.warn(`Failed to load model for ${key}, using procedural piece.`, err);
    return null;
  }
}

/** Clone an object AND its geometries/materials so each piece is independent
 *  (plain Object3D.clone() shares those references, which would corrupt
 *  sibling pieces when one is disposed or made to glow during a battle). */
function deepInstance(source: THREE.Object3D): THREE.Object3D {
  const copy = source.clone(true);
  copy.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry = o.geometry.clone();
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => m.clone())
        : o.material.clone();
    }
  });
  return copy;
}

/**
 * Create a piece. Uses a downloaded GLTF model if one is registered for this
 * piece, otherwise falls back to the built-in procedural mesh.
 */
export async function createPiece(type: PieceType, color: PieceColor): Promise<PieceObject> {
  const model = await loadModel(type, color);
  if (model) {
    const group = new THREE.Group() as PieceObject;
    group.add(deepInstance(model));
    return applyMeta(group, type, color);
  }
  return buildProcedural(type, color);
}

/** Knights should face the enemy side; call after placing on a square. */
export function orientPiece(piece: PieceObject): void {
  if (piece.userData.type === "n") {
    // White (home at +Z) faces -Z toward black, and vice-versa.
    piece.rotation.y = piece.userData.color === "w" ? Math.PI / 2 : -Math.PI / 2;
  }
}
