import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";

export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type PieceColor = "w" | "b";

/** A live, animated character standing on a square. */
export interface PieceObject extends THREE.Group {
  userData: {
    type: PieceType;
    color: PieceColor;
    square: string;
    height: number;
    materials: THREE.Material[]; // kept for API compatibility (unused for chars)
    mixer: THREE.AnimationMixer;
    clips: Record<string, THREE.AnimationClip>;
    current: THREE.AnimationAction | null;
    attack: string;
    death: string;
    caster: boolean;
  };
}

interface CharDef {
  file: string;
  hide: string[]; // accessory node names to hide
  attack: string;
  death: string;
  caster: boolean;
}

// One definition per distinct character model.
const CHARS: Record<string, CharDef> = {
  knight: { file: "knight", hide: ["1H_Sword_Offhand", "Badge_Shield", "Rectangle_Shield", "Spike_Shield", "2H_Sword"], attack: "1H_Melee_Attack_Slice_Diagonal", death: "Death_A", caster: false },
  barbarian: { file: "barbarian", hide: ["1H_Axe_Offhand", "Barbarian_Round_Shield", "1H_Axe", "Mug"], attack: "2H_Melee_Attack_Spin", death: "Death_A", caster: false },
  mage: { file: "mage", hide: ["Spellbook", "Spellbook_open", "1H_Wand"], attack: "Spellcast_Shoot", death: "Death_A", caster: true },
  rogue: { file: "rogue", hide: ["Knife_Offhand", "1H_Crossbow", "2H_Crossbow", "Throwable"], attack: "1H_Melee_Attack_Stab", death: "Death_A", caster: false },
  skel_warrior: { file: "skel_warrior", hide: [], attack: "1H_Melee_Attack_Slice_Diagonal", death: "Death_C_Skeletons", caster: false },
  skel_mage: { file: "skel_mage", hide: [], attack: "Spellcast_Shoot", death: "Death_C_Skeletons", caster: true },
  skel_rogue: { file: "skel_rogue", hide: [], attack: "1H_Melee_Attack_Stab", death: "Death_C_Skeletons", caster: false },
  skel_minion: { file: "skel_minion", hide: [], attack: "1H_Melee_Attack_Chop", death: "Death_C_Skeletons", caster: false },
};

/**
 * Piece identity, Battle Chess style: every chess piece must be readable at a
 * glance, so each one gets a distinct character, its own height (pawns small,
 * royals tall — mirroring a real Staunton set), and regalia: the king a great
 * crown, the queen a spiked coronet, the bishop keeps the mitre-like hat.
 */
interface PieceDef {
  char: string;
  height: number;
  crown?: "king" | "queen";
  /** extra nodes to hide for THIS piece (e.g. swap hat for crown). */
  hideExtra?: string[];
  /** attach a bone weapon (for skeletons whose weapons ship separately). */
  blade?: boolean;
}

const PIECES: Record<PieceColor, Record<PieceType, PieceDef>> = {
  w: {
    p: { char: "rogue", height: 1.25 },
    n: { char: "knight", height: 1.55, hideExtra: [] },
    b: { char: "mage", height: 1.6 },
    r: { char: "barbarian", height: 1.7 },
    q: { char: "mage", height: 1.85, crown: "queen", hideExtra: ["Mage_Hat"] },
    k: { char: "knight", height: 1.95, crown: "king", hideExtra: ["Knight_Helmet"] },
  },
  b: {
    p: { char: "skel_minion", height: 1.25, blade: true },
    n: { char: "skel_rogue", height: 1.55, blade: true },
    b: { char: "skel_mage", height: 1.6 },
    r: { char: "skel_warrior", height: 1.7, blade: true },
    q: { char: "skel_mage", height: 1.85, crown: "queen", hideExtra: ["Skeleton_Mage_Hat"] },
    k: { char: "skel_warrior", height: 1.95, crown: "king", blade: true, hideExtra: ["Skeleton_Warrior_Helmet"] },
  },
};

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

interface LoadedChar {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Height of the unscaled source model, for computing per-piece scale. */
  rawHeight: number;
}
const cache = new Map<string, Promise<LoadedChar>>();

function loadChar(key: string): Promise<LoadedChar> {
  if (cache.has(key)) return cache.get(key)!;
  const def = CHARS[key];
  const p = loader.loadAsync(`${import.meta.env.BASE_URL}characters/${def.file}.glb`).then((gltf) => {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    return { scene, clips: gltf.animations, rawHeight: size.y || 1 };
  });
  cache.set(key, p);
  return p;
}

/** Preload every character used by both armies (for a loading screen). */
export async function preloadAll(onProgress?: (done: number, total: number) => void): Promise<void> {
  const keys = [
    ...new Set([...Object.values(PIECES.w), ...Object.values(PIECES.b)].map((d) => d.char)),
  ];
  let done = 0;
  await Promise.all(
    keys.map((k) =>
      loadChar(k).then(() => {
        done++;
        onProgress?.(done, keys.length);
      }),
    ),
  );
}

/* ------------------------- regalia & weapons ------------------------- */

/** GLTFLoader strips reserved chars from node names ("handslot.r" ->
 *  "handslotr"), so match on the stripped form. */
function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const want = name.replace(/[^a-z0-9_]/gi, "").toLowerCase();
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && o.name.replace(/[^a-z0-9_]/gi, "").toLowerCase() === want) found = o;
  });
  return found;
}

function collectMaterials(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      if (Array.isArray(o.material)) out.push(...o.material);
      else if (o.material) out.push(o.material);
    }
  });
  return out;
}

function goldMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xe7b23c,
    metalness: 1,
    roughness: 0.28,
    emissive: new THREE.Color(0x3a2600),
    emissiveIntensity: 0.5,
  });
}

/** A crown built in head-bone space so it rides every animation. */
function buildCrown(kind: "king" | "queen", headSize: number): THREE.Group {
  const g = new THREE.Group();
  const gold = goldMaterial();
  const r = headSize * 0.52;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.06, headSize * 0.28, 24, 1, true), gold);
  band.material.side = THREE.DoubleSide;
  g.add(band);
  const points = kind === "king" ? 4 : 8;
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const spike = new THREE.Mesh(
      new THREE.ConeGeometry(headSize * (kind === "king" ? 0.12 : 0.07), headSize * (kind === "king" ? 0.42 : 0.3), 6),
      gold,
    );
    spike.position.set(Math.cos(a) * r * 0.92, headSize * 0.3, Math.sin(a) * r * 0.92);
    g.add(spike);
  }
  if (kind === "king") {
    // Cross finial in the centre, unmistakably The King.
    const v = new THREE.Mesh(new THREE.BoxGeometry(headSize * 0.08, headSize * 0.4, headSize * 0.08), gold);
    v.position.y = headSize * 0.42;
    const h = new THREE.Mesh(new THREE.BoxGeometry(headSize * 0.26, headSize * 0.08, headSize * 0.08), gold);
    h.position.y = headSize * 0.48;
    g.add(v, h);
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return g;
}

/** A simple sword for skeletons (their weapons ship as separate assets). */
function buildBlade(size: number): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xc8cede, metalness: 0.9, roughness: 0.35 });
  const gold = goldMaterial();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(size * 0.1, size * 1.05, size * 0.03), steel);
  blade.position.y = size * 0.62;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(size * 0.07, size * 0.18, 4), steel);
  tip.position.y = size * 1.22;
  tip.rotation.y = Math.PI / 4;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(size * 0.34, size * 0.07, size * 0.07), gold);
  guard.position.y = size * 0.1;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.045, size * 0.045, size * 0.24, 8), gold);
  grip.position.y = -0.04 * size;
  g.add(blade, tip, guard, grip);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return g;
}

export async function createPiece(type: PieceType, color: PieceColor): Promise<PieceObject> {
  const pieceDef = PIECES[color][type];
  const def = CHARS[pieceDef.char];
  const loaded = await loadChar(pieceDef.char);

  const model = skeletonClone(loaded.scene) as THREE.Object3D;
  model.scale.setScalar(pieceDef.height / loaded.rawHeight);
  // Re-base so feet sit on the board.
  const box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;

  // Hide unwanted accessories; collect materials.
  const hide = [...def.hide, ...(pieceDef.hideExtra ?? [])];
  const materials: THREE.Material[] = [];
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // skinned bounds can be wrong; avoid pop-out
      if (hide.includes(o.name)) o.visible = false;
      // Clone materials per instance so fading a dying piece can't affect
      // other pieces that share the same source material.
      if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
      else if (o.material) o.material = o.material.clone();
      const m = o.material;
      if (Array.isArray(m)) materials.push(...m);
      else if (m) materials.push(m);
    }
  });

  // Regalia + weapons ride their bones through every animation.
  // Sizes are in un-scaled model space (the root scale shrinks/grows them).
  const headSize = loaded.rawHeight * 0.34;
  if (pieceDef.crown) {
    const head = findBone(model, "head");
    if (head) {
      const crown = buildCrown(pieceDef.crown, headSize);
      crown.position.y = headSize * 1.04;
      head.add(crown);
      materials.push(...collectMaterials(crown));
    }
  }
  if (pieceDef.blade) {
    const slot = findBone(model, "handslot.r");
    if (slot) {
      const blade = buildBlade(loaded.rawHeight * 0.36);
      slot.add(blade);
      materials.push(...collectMaterials(blade));
    }
  }

  const group = new THREE.Group() as PieceObject;
  group.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const c of loaded.clips) clips[c.name] = c;

  group.userData = {
    type,
    color,
    square: "",
    height: pieceDef.height,
    materials,
    mixer,
    clips,
    current: null,
    attack: def.attack,
    death: def.death,
    caster: def.caster,
  };

  playLoop(group, "Idle", 0);
  return group;
}

/** Face the enemy side (white at +Z faces -Z toward black, and vice-versa). */
export function orientPiece(piece: PieceObject): void {
  piece.rotation.y = piece.userData.color === "w" ? Math.PI : 0;
}

/* --------------------------- animation API --------------------------- */

export function playLoop(piece: PieceObject, name: string, fade = 0.25): void {
  const d = piece.userData;
  const clip = d.clips[name] ?? d.clips["Idle"];
  if (!clip) return;
  const action = d.mixer.clipAction(clip);
  action.enabled = true;
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.clampWhenFinished = false;
  action.reset();
  action.fadeIn(fade);
  action.play();
  if (d.current && d.current !== action) d.current.fadeOut(fade);
  d.current = action;
}

/** Play a one-shot clip; returns its (speed-adjusted) duration in seconds. */
export function playOnce(piece: PieceObject, name: string, fade = 0.1, speed = 1): number {
  const d = piece.userData;
  const clip = d.clips[name];
  if (!clip) return 0;
  const action = d.mixer.clipAction(clip);
  action.enabled = true;
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.timeScale = speed;
  action.reset();
  action.fadeIn(fade);
  action.play();
  if (d.current && d.current !== action) d.current.fadeOut(fade);
  d.current = action;
  return clip.duration / speed;
}

export function updateMixer(piece: PieceObject, dt: number): void {
  piece.userData.mixer.update(dt);
}
