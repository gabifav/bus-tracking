# Sydney Bus Simulator (prototype)

A small 3D bus driving prototype built with Three.js, TypeScript and Vite. Every model is procedural, so there are no assets to download.

## Run

```bash
cd simulator
npm install
npm run dev        # then open the printed URL (http://localhost:5173)
```

Production build: `npm run build`, then `npm run preview` to serve it.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Accelerate (brakes when you're reversing) |
| S / ↓ | Brake; hold it while stopped to reverse |
| A D / ← → | Steer |
| Space | Handbrake |
| R | Reset the bus to the start |
| C | Cycle camera: chase, far, nose |

## Layout

```
src/
  main.ts               entry point
  core/Game.ts          renderer, scene, main loop; wires the systems together
  core/Input.ts         keyboard state, turned into DriveControls
  vehicles/BusModel.ts  procedural bus mesh and dimensions
  vehicles/Bus.ts       arcade bicycle-model physics, tunables in BUS_SPEC
  world/RoadNetwork.ts  road grid as pure data (roads, blocks, isOnRoad)
  world/City.ts         meshes for ground, roads, buildings and parks; collision
  camera/ChaseCamera.ts smoothed follow camera with modes
  ui/Hud.ts             speedometer overlay
```

Extension points for later work:
- Traffic, routes and bus stops can read lane and block data from `RoadNetwork`.
- Physics can be swapped behind `Bus.update`.
- `Collider` is the interface the bus uses for collision.
