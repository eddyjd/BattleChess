# ♟️ BattleChess — 3D Combat Chess

A 3D chess game for the browser where **captured pieces come to life and fight**.
Every capture triggers a cinematic battle — the attacker lunges, strikes in slow
motion amid sparks and shockwaves, and the loser is destroyed in a shower of
debris (the attacker always wins, per the rules of chess).

Play it three ways:

- **Vs Computer** — a built-in AI engine with four difficulty levels.
- **Online** — quick-match a stranger or share a 4-letter code with a friend.
- **Local 2-Player** — hot-seat on one device.

It runs in any modern browser on **PC, Android and iOS** from a single codebase,
and installs as a **PWA** ("Add to Home Screen") so it behaves like a native app.

---

## Quick start

```bash
npm install            # installs client + server workspaces

# Development (hot-reload client on :5173, game server on :8787)
npm run dev

# open http://localhost:5173
```

For a production-style run (the server hosts the built client on one port):

```bash
npm run build
npm start               # serves the game + WebSocket on http://localhost:8787
```

> Online play needs the server running. **Vs Computer** and **Local 2-Player**
> work entirely in the browser with no server.

---

## How it's built

| Layer | Tech | Notes |
|-------|------|-------|
| Rendering | **Three.js** | WebGL board, pieces, lighting, particles, cinematics |
| Rules | **chess.js** | Full legal-move generation, check/mate/draw detection |
| AI | **Web Worker** | Negamax + alpha-beta + piece-square tables (off the main thread) |
| Multiplayer | **Node + `ws`** | Authoritative server validates every move and relays it |
| Build/UI | **Vite + TypeScript** | PWA manifest, framework-free DOM UI |

```
BattleChess/
├── shared/protocol.ts        # message types shared by client & server
├── server/                   # authoritative WebSocket game server
│   └── src/index.ts          #   rooms, matchmaking, move validation, static hosting
└── client/                   # Vite + Three.js front end
    └── src/
        ├── scene/Stage.ts            # renderer, camera, lights, slow-mo loop
        ├── game/
        │   ├── GameController.ts     # orchestrates input, rules, AI, net, cinematics
        │   ├── Board3D.ts            # board tiles + highlights
        │   ├── PieceFactory.ts       # procedural piece meshes (+ GLTF hook)
        │   ├── PieceManager.ts       # mesh bookkeeping + move/capture animation
        │   └── effects/
        │       ├── BattleDirector.ts # the capture cinematic
        │       └── Particles.ts      # sparks, debris, shockwaves
        ├── ai/                       # AIController + ai.worker (the engine)
        ├── net/NetClient.ts          # WebSocket client
        └── ui/                       # Menu (lobby) + HUD
```

### The battle cinematic

When a piece is captured, `BattleDirector` takes over: it locks the orbit camera,
dives to a dramatic angle, drops the world into slow motion (`Stage.timeScale`),
and animates the attacker lunging into the defender with multiple strikes —
each hit spawning sparks, a shockwave ring, a light flash and screen shake.
The defender is knocked back, then spins, sinks and dissolves into debris.

---

## 3D piece assets

The pieces ship as **procedurally generated meshes** (lathe-turned classic
silhouettes plus an extruded knight), so the game always renders correctly with
zero external downloads or broken-link risk.

If you'd like richer models, drop a free **CC0 / CC-BY chess set** (`.glb`/`.gltf`
from e.g. Kenney, Poly Pizza, Quaternius or Sketchfab) into
`client/public/models/` and register the files in `MODEL_SOURCES` at the top of
[`client/src/game/PieceFactory.ts`](client/src/game/PieceFactory.ts). The loader
auto-scales and re-bases each model, and silently falls back to the procedural
piece if a model is missing or fails to load. No other code changes are needed.

---

## Deployment

`npm run build` produces `client/dist` (static) and `server/dist` (Node). Run
`npm start` on any Node host (Render, Railway, Fly.io, a VPS…). The server serves
the client and the WebSocket on the same port, so HTTPS termination in front of
it gives you secure `wss://` automatically. Set `PORT` to change the port.

## Roadmap ideas

- Promotion under-promotion picker ✅ · move-clock / timers · spectators
- Per-piece battle choreography (knight charges, bishop magic, rook siege)
- Capacitor wrapper for native App Store / Play Store builds
- A premium Unity edition for console-grade visuals
