# Red Field (prototype)

First-person survival horror in Three.js. No build step, and all art and sound is procedural placeholder.

**Goal:** wake the three organ-pipe towers. Once all three are awake they sing the drum-headed beast to death. It hunts you by your flashlight and your scent, and one bite kills.

A 12-second intro plays on the first start. Press Space, Enter, Esc or click to skip it.

## Run

Double-click `start.bat`, or:

```
python serve.py 8080
```

(`serve.py` is `http.server` with caching turned off, so your edits always show up on reload.)

then open http://localhost:8080 and click. `?map=test` loads the old movement test map (no monster).

## Controls

| Input | Action |
|---|---|
| WASD / Shift | Move / sprint (sprinting is loud) |
| Space | Jump · wall jump |
| Hold C | **Hide**: you crouch and freeze, and your flashlight goes dark. The light is on whenever you move. Hide in tall grass to be nearly invisible. |
| Left click | **Claw slash**: stuns the monster up close; during its lunge windup it's a **parry** (longer stun) |
| Right click | **Lure**: throws a glowing orb the monster chases and destroys |
| F3 | Debug overlay (monster state, awareness) |
| Esc | Pause: resume, restart (R), settings |

All keys except Esc can be rebound in **Settings** (click a key, then press the new one; a key that's already used swaps). Bindings are saved in the browser.

## Settings and quality-of-life

- **Graphics:** Low / Medium / High. They change resolution scale, flashlight shadows, grass density and cull distance; High is the original look. Low was about 1.7× faster than High in testing. Antialiasing (off on Low) changes after a reload. If the first 20 s run slowly, the game suggests lowering it.
- **HUD toggles:** FPS counter, tower compass (red ✦ = asleep, purple = awake; arrows at the edge when behind you), and sound-direction arcs that show where monster sounds outside your view come from.
- **Tips:** short first-time hints (hiding, lures, the lunge, scent, tall grass, towers, claw charges, stamina). Each shows once; "Reset tips" brings them back.
- **Faster flow:** the intro only auto-plays the first time ("Watch intro" replays it); R / Space / Enter retries on the death and win screens; R restarts from the pause screen; audio ducks while paused.
- R no longer teleports you to spawn in Red Field (it still does on the test map).

## Towers (`src/towers.js`, tune `TOWER_CONFIG`)

The towers stand in the north-east, north-west and south-east corners. Their red crowns are visible from anywhere on the map.

1. **Charge:** stand in the glowing rune circle with your light on (you can't hide while charging) until it reaches 50% (about 10 s). The organ hum grows louder and makes noise that draws the monster in. Progress drains slowly while you're not charging.
2. **Melody:** the tower plays a sequence on its 5 standing stones, and each stone glows as it sounds. Strike the stones in the same order with left-click; this doesn't use claw charges. Aim at any part of a stone, including its floating gem, from up to about 5 m away on the ground. A left-click icon shows during this phase, and the stone you're aiming at lights up. The melodies are 3, 4, then 5 notes long. A **wrong note** is very loud (heard about 45 m away) and restarts the melody.
3. **Charge** the second half. The tower wakes, a purple beam shoots up, and the monster comes to investigate.

When all three are awake, a victory cinematic plays: the beams converge on the beast and it collapses. Your fastest win time is saved.

## How the monster works (`src/monster.js`, tune `MONSTER_CONFIG`)

The monster is 1.5× the original size.

- **Model:** built procedurally in `src/monsterModel.js`, based on monster.png:
  - **Drum head:** tension rods, a torn skin, slit-pupil eyes, two rows of teeth, and a tongue and drool.
  - **Body:** ribs, piano-key scales along the spine, instruments stuck in the back, and muscular legs.
  - **Tail:** hanging rosaries with crosses.
- **Animation:** procedural, in `src/monster.js`.
  - **Feet and legs:** IK foot planting keeps the feet on the ground with no skating.
  - **Body:** follows the terrain, and the spine bends into turns.
  - **Secondary motion:** springy neck, tail and rosaries.
  - **Idles:** sniffing, listening, shivering.
  - **Attack:** an anticipation crouch before the lunge.
  - **Footsteps:** dust puffs, plus camera shake when the monster is close.
- **Death:** a jumpscare (`updateJumpscare` in `src/main.js`, gore in `src/gore.js`), in this order:
  1. It whips your view into its face in slow motion and screams.
  2. You're dragged into its maw.
  3. The teeth slam shut over the screen with a crunch.
  4. Blood splatters and drips.
  5. Your heartbeat fades to a flatline.

**Awareness** builds up from what it perceives; it doesn't detect you instantly.
- Flashlight on with a clear line of sight: detected from up to 40 m.
- Shining the light directly at it: near-instant detection.
- Being seen in the hide stance out in the open: within 5 m.
- Noise: sprinting (16 m), walking (7 m), landing hard, wading.
- Hidden in tall grass: only noticed within 3 m.

**Smell:**
- After about 12 s without seeing you, it sniffs (you'll hear it) and follows your scent trail, which fades over about 60 s.
- Wading through a blood pool wipes the trail and masks your scent for 8 s after you climb out.
- Scent you leave while hidden in grass is faint: it only smells that within 7 m.

**States:** WANDER → INVESTIGATE → CHASE → SEARCH → TRACK (smell), plus LURED / TEAR, ATTACK and STUNNED.

**Attack:** a 0.6 s windup (eyes flare, cymbal crash), then a lunge. One bite kills. Dodge by sidestepping or backing off, or slash to parry. It **rears up to bite players up to 6.5 m above its feet**, so rocks and speaker stacks aren't safe.

**Speed:** chase speed ramps from 7.8 m/s (just under your 8.2 m/s sprint) to 10.5 m/s over 5 minutes.

**Pathfinding:** it uses A* on a navigation grid. It **crashes straight through anything smaller than the player**: shorter than 1.8 m or thinner than 1 m, such as crosses, trees, fences, tombstones, pianos, pews and standing stones (see `World.markSmall`). It still can't fit through gaps under about 3.2 m between big obstacles: canyon gaps, the chapel's back door, narrow rock pairs. If it stops making progress it backs off sideways and re-plans.

## Right arm (`src/arm.js`)

- 2 charges; one refills every 25 s. Vein brightness shows the charges.
- The veins pulse faster the closer the monster is.
- The arm is drawn in its own render pass, so it never clips into walls.

## Files

- `src/main.js`: game loop, game state, death and restart, HUD.
- `src/world.js`: colliders, terrain height, line of sight, hiding and wading zones, noise, navigation grid and A*.
- `src/player.js`: movement (tune `PLAYER_CONFIG`).
- `src/monster.js`: monster model, animation and AI.
- `src/arm.js`: right arm and lure orb.
- `src/flashlight.js`: the flashlight. It flickers more when the monster is near.
- `src/audio.js`: WebAudio synthesized sounds.
  - Monster: drum-hit footsteps, a guitar-chord roar and a cymbal crash on attack.
  - Player: a heartbeat and ambient sound.
- `src/maps/redfield.js`: the 140 × 140 m map.
  - **Centre:** the blood pool, the shed and the piano.
  - **North:** a fenced graveyard with a ruined chapel. Its big front door fits the monster, its back door doesn't, and you can vault through its windows.
  - **East:** a dead forest with hanging dolls.
  - **South:** an "orchestra" clearing with chairs, pianos, drum kits, a gong and speaker stacks.
  - **West:** a rock canyon with player-only gaps, and a second blood pool.
  - **Corners:** a junkyard.
- `src/props.js`: prop builders.
- `src/batch.js`: static mesh merging, used for performance.
- `src/towers.js`: towers (charging, melody puzzle, beacons, the final strike).
- `src/cinematic.js`: shot sequencer used by the intro and victory cinematics.
- `src/monsterModel.js`: the monster's procedural model (swap in a GLB here).
- `src/gore.js`: screen blood for the death jumpscare.
- `src/settings.js`: saved settings, quality presets, default key bindings, key labels.
- `src/menu.js`: start / pause screen and the settings panel (rebinding).
- `src/hints.js`: first-time tips queue.
- `src/maps/testlevel.js`: the old test map.

`window.game` exposes everything in the dev console (e.g. `game.monster.awareness`, `game.restart()`, `game.intro()`, `game.win()`, `game.applyQuality('low')`). `game.die()` triggers the jumpscare. Set `game.jumpscareSpeed = 0` and call `game.jumpscareStep(1/60)` to step through it frame by frame.

## Performance notes

- **Static props** are merged per 35 m chunk and per material. Untextured materials are folded into one vertex-coloured material. Chunks deep in the fog are hidden.
- **Grass and plants** are instanced in spatial chunks, with frustum and distance culling.
- **Monster:** its rigid parts are merged into a few draw calls.
- **Sky and castle** are a backdrop attached to the camera, so the far plane is only 100 m.
- **Sky clouds** come from a pre-baked texture instead of per-pixel noise.
- **Collisions** use a spatial grid.
- **Pixel ratio** is capped at 1.5.
- **Measured on an Intel UHD 630:** about 60–180 draw calls and 11–15 ms per frame.
  - The old small map was about 260 draw calls.
  - This map was 22–29 ms per frame before the sky, bump-map and pixel-ratio changes.

## Replacing placeholders with models

- **Monster:** `buildMonsterModel()` returns named parts (`root`, `body`, `headPivot`, `headCenter`, `jaw`, `legs`, `tail`). Load a GLB there and either map its bones to these names or rewrite `_animate()` to use an `AnimationMixer`.
- **Props:** keep the collider calls (`world.addCollider(...)`) and swap only the meshes:

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
new GLTFLoader().load('models/piano.glb', (gltf) => {
  scene.add(gltf.scene);
  const b = new THREE.Box3().setFromObject(gltf.scene);
  world.colliders.push(b);
});
```
Call `world.buildNav(...)` after adding colliders so the monster paths around them.
