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

const TARGET_HEIGHT = 1.55;

// One definition per distinct character model.
const CHARS: Record<string, CharDef> = {
  knight: { file: "knight", hide: ["1H_Sword_Offhand", "Badge_Shield", "Rectangle_Shield", "Spike_Shield", "2H_Sword"], attack: "1H_Melee_Attack_Slice_Diagonal", death: "Death_A", caster: false },
  barbarian: { file: "barbarian", hide: ["1H_Axe_Offhand", "2H_Axe", "Mug"], attack: "1H_Melee_Attack_Slice_Diagonal", death: "Death_A", caster: false },
  mage: { file: "mage", hide: ["Spellbook", "Spellbook_open", "1H_Wand"], attack: "Spellcast_Shoot", death: "Death_A", caster: true },
  rogue: { file: "rogue", hide: ["Knife_Offhand", "1H_Crossbow", "2H_Crossbow", "Throwable"], attack: "1H_Melee_Attack_Slice_Diagonal", death: "Death_A", caster: false },
  skel_warrior: { file: "skel_warrior", hide: [], attack: "1H_Melee_Attack_Slice_Diagonal", death: "Death_C_Skeletons", caster: false },
  skel_mage: { file: "skel_mage", hide: [], attack: "Spellcast_Shoot", death: "Death_C_Skeletons", caster: true },
  skel_rogue: { file: "skel_rogue", hide: [], attack: "1H_Melee_Attack_Slice_Diagonal", death: "Death_C_Skeletons", caster: false },
  skel_minion: { file: "skel_minion", hide: [], attack: "1H_Melee_Attack_Slice_Diagonal", death: "Death_C_Skeletons", caster: false },
};

// Which character plays each chess piece, per army.
const ROSTER: Record<PieceColor, Record<PieceType, string>> = {
  w: { p: "rogue", r: "barbarian", n: "knight", b: "mage", q: "mage", k: "knight" },
  b: { p: "skel_minion", r: "skel_warrior", n: "skel_rogue", b: "skel_mage", q: "skel_mage", k: "skel_warrior" },
};

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

interface LoadedChar {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  scale: number;
  height: number;
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
    const scale = TARGET_HEIGHT / (size.y || 1);
    return { scene, clips: gltf.animations, scale, height: TARGET_HEIGHT };
  });
  cache.set(key, p);
  return p;
}

/** Preload every character used by both armies (for a loading screen). */
export async function preloadAll(onProgress?: (done: number, total: number) => void): Promise<void> {
  const keys = [...new Set([...Object.values(ROSTER.w), ...Object.values(ROSTER.b)])];
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

export async function createPiece(type: PieceType, color: PieceColor): Promise<PieceObject> {
  const key = ROSTER[color][type];
  const def = CHARS[key];
  const loaded = await loadChar(key);

  const model = skeletonClone(loaded.scene) as THREE.Object3D;
  model.scale.setScalar(loaded.scale);
  // Re-base so feet sit on the board.
  const box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;

  // Hide unwanted accessories; collect materials.
  const materials: THREE.Material[] = [];
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // skinned bounds can be wrong; avoid pop-out
      if (def.hide.includes(o.name)) o.visible = false;
      // Clone materials per instance so fading a dying piece can't affect
      // other pieces that share the same source material.
      if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
      else if (o.material) o.material = o.material.clone();
      const m = o.material;
      if (Array.isArray(m)) materials.push(...m);
      else if (m) materials.push(m);
    }
  });

  const group = new THREE.Group() as PieceObject;
  group.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const c of loaded.clips) clips[c.name] = c;

  group.userData = {
    type,
    color,
    square: "",
    height: loaded.height,
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
