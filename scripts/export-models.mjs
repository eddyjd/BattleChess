/**
 * Generates the bundled GLB chess-piece pack in client/public/models/.
 *
 * This produces a real, self-contained asset pack (CC0 — authored here) that
 * the game loads through its GLTF pipeline, with finer geometry and glossy
 * clearcoat materials for a more premium look than the runtime procedural
 * fallback. Re-run with `npm run models` after tweaking the shapes.
 *
 * GLTFExporter expects a browser `FileReader`; we provide a tiny Node shim.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

// --- Minimal FileReader shim (ArrayBuffer + DataURL) for Node ---
globalThis.FileReader = class {
  onloadend = null;
  onload = null;
  result = null;
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onload?.();
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      const b64 = Buffer.from(buf).toString("base64");
      this.result = `data:${blob.type || "application/octet-stream"};base64,${b64}`;
      this.onload?.();
      this.onloadend?.();
    });
  }
};

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "client", "public", "models");
const SEG = 64;

const PROFILES = {
  p: [[0,0],[0.46,0],[0.46,0.05],[0.38,0.10],[0.29,0.14],[0.33,0.19],[0.20,0.24],[0.16,0.30],[0.15,0.45],[0.23,0.51],[0.15,0.55]],
  r: [[0,0],[0.50,0],[0.50,0.06],[0.40,0.11],[0.31,0.16],[0.29,0.55],[0.40,0.62],[0.40,0.78]],
  b: [[0,0],[0.47,0],[0.47,0.06],[0.37,0.11],[0.27,0.17],[0.18,0.24],[0.16,0.52],[0.27,0.60],[0.14,0.66],[0.19,0.86],[0.0,0.98]],
  q: [[0,0],[0.51,0],[0.51,0.06],[0.41,0.11],[0.31,0.17],[0.20,0.26],[0.17,0.62],[0.28,0.70],[0.16,0.76],[0.30,0.88]],
  k: [[0,0],[0.53,0],[0.53,0.06],[0.43,0.11],[0.33,0.17],[0.21,0.28],[0.18,0.68],[0.29,0.76],[0.17,0.82],[0.31,0.96]],
  nBase: [[0,0],[0.49,0],[0.49,0.06],[0.39,0.11],[0.30,0.16],[0.27,0.24]],
};

function material(color) {
  return new THREE.MeshPhysicalMaterial({
    color: color === "w" ? 0xf4eede : 0x252834,
    roughness: color === "w" ? 0.3 : 0.32,
    metalness: color === "w" ? 0.35 : 0.65,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    emissive: new THREE.Color(0x000000),
  });
}

function lathe(profile, mat) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  const geo = new THREE.LatheGeometry(pts, SEG);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}
function ball(r, y, mat) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), mat);
  m.position.y = y;
  return m;
}
function baseRing(mat) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 16, SEG), mat);
  m.rotation.x = Math.PI / 2;
  m.position.y = 0.05;
  return m;
}

function knightHead(mat) {
  const s = new THREE.Shape();
  s.moveTo(-0.16, 0.0);
  s.lineTo(0.18, 0.0);
  s.quadraticCurveTo(0.26, 0.34, 0.12, 0.52);
  s.quadraticCurveTo(0.34, 0.56, 0.40, 0.74);
  s.quadraticCurveTo(0.30, 0.80, 0.18, 0.78);
  s.quadraticCurveTo(0.16, 0.86, 0.06, 0.9);
  s.quadraticCurveTo(0.02, 0.82, -0.04, 0.82);
  s.quadraticCurveTo(-0.2, 0.74, -0.22, 0.5);
  s.quadraticCurveTo(-0.26, 0.28, -0.16, 0.0);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.34, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4, steps: 1,
  });
  geo.center();
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.66;
  return mesh;
}

function buildPiece(type, color) {
  const mat = material(color);
  const accent = material(color);
  accent.metalness = Math.min(1, mat.metalness + 0.2);
  const g = new THREE.Group();
  g.add(baseRing(accent));
  switch (type) {
    case "p": g.add(lathe(PROFILES.p, mat), ball(0.2, 0.7, mat)); break;
    case "r": {
      g.add(lathe(PROFILES.r, mat));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), accent);
        m.position.set(Math.cos(a) * 0.34, 0.86, Math.sin(a) * 0.34);
        g.add(m);
      }
      break;
    }
    case "b": g.add(lathe(PROFILES.b, mat), ball(0.09, 1.05, accent)); break;
    case "n": g.add(lathe(PROFILES.nBase, mat), knightHead(accent)); break;
    case "q": {
      g.add(lathe(PROFILES.q, mat));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.add(ball(0.075, 0.96, accent).translateX(Math.cos(a) * 0.3).translateZ(Math.sin(a) * 0.3));
      }
      g.add(ball(0.12, 1.06, accent));
      break;
    }
    case "k": {
      g.add(lathe(PROFILES.k, mat), ball(0.1, 1.0, accent));
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), accent); v.position.y = 1.18;
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.08), accent); h.position.y = 1.18;
      g.add(v, h);
      break;
    }
  }
  return g;
}

const exporter = new GLTFExporter();
mkdirSync(OUT, { recursive: true });
const types = ["p", "n", "b", "r", "q", "k"];
const colors = ["w", "b"];

for (const color of colors) {
  for (const type of types) {
    const piece = buildPiece(type, color);
    const glb = await exporter.parseAsync(piece, { binary: true, onlyVisible: true });
    const file = join(OUT, `${color}${type}.glb`);
    writeFileSync(file, Buffer.from(glb));
    console.log(`wrote ${color}${type}.glb (${(glb.byteLength / 1024).toFixed(1)} KB)`);
  }
}
console.log(`\nDone — ${colors.length * types.length} models in ${OUT}`);
