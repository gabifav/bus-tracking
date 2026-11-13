# Sydney Bus Simulator (prototype)

A small 3D bus driving prototype built with Three.js, TypeScript and Vite. Every model is procedural, so there are no assets to download.

## Run

```bash
cd simulator
npm install
npm run dev        # then open the printed URL (http://localhost:5173)
```

Production build: `npm run build`, then `npm run preview` to serve it.

## Route 445 data

The streets are built from the real route 445 path and stops in OpenStreetMap,
saved in `src/data/route445.json` (Campsie Station to Balmain, 14.5 km, 53 stops).
To refresh it from OpenStreetMap (needs internet):

```bash
node scripts/fetch-route.mjs
```

It also includes the real building footprints (with heights/levels where
mapped) and side streets within ~100 m of the route. Gaps where OpenStreetMap
has no buildings are filled with generated houses and shops.

Sharp corners get an intersection area so the 12 m bus can swing through them,
and the bus scrapes along kerbs rather than stopping dead.

Map data © OpenStreetMap contributors (ODbL).

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Accelerate (brakes when you're reversing) |
| S / ↓ | Brake; hold it while stopped to reverse |
| A D / ← → | Steer |
| Space | Handbrake |
| R | Reset the bus to the start |
| C | Cycle camera: chase, far, nose |
| M | Mute sound |

## Layout

```
src/
  main.ts               entry point
  core/Game.ts          renderer, scene, main loop; wires the systems together
  core/Input.ts         keyboard state, turned into DriveControls
  vehicles/BusModel.ts  procedural bus mesh and dimensions
  vehicles/Bus.ts       arcade bicycle-model physics, tunables in BUS_SPEC
  world/RoutePath.ts    route centre-line with fast nearest-point queries
  world/RouteWorld.ts   streetscape built along the route; road collision
  world/Buildings.ts    extrudes real OSM footprints (walls, gable/flat roofs)
  world/StreetIndex.ts  side-street segments for drawing and collision
  audio/BusAudio.ts     procedural diesel engine and air-brake sounds
  data/route445.json    route path and stops (from scripts/fetch-route.mjs)
  camera/ChaseCamera.ts smoothed follow camera with modes
  ui/Hud.ts             speedometer overlay
```

Extension points for later work:
- Traffic, timetables and passengers can use `RoutePath` (arc length, nearest point) and the stop list.
- Physics can be swapped behind `Bus.update`.
- `Collider` is the interface the bus uses for collision.
