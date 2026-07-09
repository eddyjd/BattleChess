/**
 * Builds the playable character pack for BattleChess from the (CC0) KayKit
 * Adventurers + Skeletons source GLBs. Each source carries 76-95 animation
 * clips (~3.5-4.7 MB); we keep only the dozen the game actually plays, then
 * dedup/prune/resample so the whole army is light enough for mobile.
 *
 * Source repos (clone next to this project under /tmp/kaykit, or adjust SRC):
 *   github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
 *   github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0
 *
 * Run: node scripts/build-characters.mjs
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, resample, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import { mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADV = "/tmp/kaykit/adv/addons/kaykit_character_pack_adventures/Characters/gltf";
const SKEL = "/tmp/kaykit/skel/addons/kaykit_character_pack_skeletons/Characters/gltf";
const OUT = join(ROOT, "client", "public", "characters");

// Clips the game plays — everything else is discarded to save weight.
// Kept deliberately small: each extra clip is ~50 bones of keyframes.
const KEEP = new Set([
  "Idle",
  "Walking_A",
  "Running_A",
  "1H_Melee_Attack_Slice_Diagonal", // melee swing
  "1H_Melee_Attack_Stab", // melee variety
  "1H_Melee_Attack_Chop", // melee variety / finisher
  "2H_Melee_Attack_Spin", // heavy hitter (rook/barbarian)
  "Spellcast_Shoot", // caster attack (mage/bishop/queen)
  "Block_Hit", // staggering block during the exchange
  "Hit_A",
  "Death_A",
  "Death_C_Skeletons", // skeletons crumble to bones
  "Cheer", // victor's taunt
]);

const SOURCES = {
  knight: `${ADV}/Knight.glb`,
  barbarian: `${ADV}/Barbarian.glb`,
  mage: `${ADV}/Mage.glb`,
  rogue: `${ADV}/Rogue.glb`,
  skel_warrior: `${SKEL}/Skeleton_Warrior.glb`,
  skel_mage: `${SKEL}/Skeleton_Mage.glb`,
  skel_rogue: `${SKEL}/Skeleton_Rogue.glb`,
  skel_minion: `${SKEL}/Skeleton_Minion.glb`,
};

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
mkdirSync(OUT, { recursive: true });

for (const [name, src] of Object.entries(SOURCES)) {
  const doc = await io.read(src);
  const root = doc.getRoot();

  let kept = 0;
  for (const anim of root.listAnimations()) {
    if (KEEP.has(anim.getName())) kept++;
    else anim.dispose();
  }

  await doc.transform(
    resample(),
    dedup(),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );

  const dest = join(OUT, `${name}.glb`);
  await io.write(dest, doc);
  const kb = (statSync(dest).size / 1024).toFixed(0);
  console.log(`${name.padEnd(14)} kept ${String(kept).padStart(2)} clips -> ${kb} KB`);
}
console.log(`\nDone -> ${OUT}`);
