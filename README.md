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
        │   ├── Characters.ts         # animated character models + animation API
        │   ├── PieceManager.ts       # spawn / walk / capture, mixer updates
        │   └── effects/
        │       ├── BattleDirector.ts # the capture battle (Battle Chess style)
        │       └── Particles.ts      # sparks, debris, shockwaves
        ├── ai/                       # AIController + ai.worker (the engine)
        ├── net/NetClient.ts          # WebSocket client
        └── ui/                       # Menu (lobby) + HUD
```

### The battle (Battle Chess style)

When a piece is captured, `BattleDirector` takes over: it locks the orbit camera,
dives into a slow-motion close-up, the attacker closes in and strikes with its
real attack animation, the defender plays a hit then a death (skeletons crumble
to bones), sparks/shockwaves/screen-shake punctuate the blow, and the victor
advances onto the square with a cheer.

---

## Characters & assets

Every piece is a rigged, animated character: an **Adventurers** army (Knight,
Barbarian, Mage, Rogue) versus a **Skeletons** army (Warrior, Mage, Rogue,
Minion), all **CC0** from
[KayKit](https://kaylousberg.com). The source packs ship 76–95 animation clips
each (~3.5–4.7 MB); [`scripts/build-characters.mjs`](scripts/build-characters.mjs)
trims them to the ~10 the game uses and meshopt-compresses them into
`client/public/characters/`. The roster (which character plays each piece) and
the per-piece attack/death clips live at the top of
[`client/src/game/Characters.ts`](client/src/game/Characters.ts).

To rebuild the pack: clone the two KayKit repos under `/tmp/kaykit` (see the
script header), `npm i -D @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer`,
then `node scripts/build-characters.mjs`. The compressed GLBs are committed, so a
normal build/deploy needs none of that tooling.

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
