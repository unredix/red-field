// Set pieces for generated maps, adapted from the matching areas of the classic
// Red Field. Each landmark has a footprint (r), an optional flattened area and
// path entry points; build(ctx, L) places its props.
//   ctx = { kit, R, rnd, clear, claim, pathDist, reserved }
//   L   = { type, x, z, rot, axis, ... }

// rotate a local offset (lx, lz) by L.rot around the landmark centre
const at = (L, lx, lz) => {
  const c = Math.cos(L.rot), s = Math.sin(L.rot);
  return [L.x + lx * c + lz * s, L.z - lx * s + lz * c];
};

export const LANDMARKS = {
  // ruined chapel inside a fenced graveyard (axis aligned: the chapel's big door faces +z)
  graveyard: {
    r: 25, flat: { y: 0.2, r1: 13, r2: 19 }, stoneYard: true,
    entries: (L) => [[L.x, L.z + 17]],
    build({ kit, R, rnd, clear, claim, pathDist, reserved }, L) {
      const { x: cx, z: cz } = L;
      kit.chapel(cx, cz);
      reserved.push([cx, cz, 11]);
      for (let z = cz - 12; z <= cz + 10; z += 3.4) {
        for (let x = cx - 20; x <= cx + 20; x += 3) {
          if (Math.abs(x - cx) < 9 || rnd() < 0.3) continue;
          const jx = x + (rnd() - 0.5) * 1.2, jz = z + (rnd() - 0.5) * 1.0;
          if (!clear(jx, jz, 0.5, 0.4) || pathDist(jx, jz) < 1.5) continue;
          claim(jx, jz, 0.5);
          if (rnd() < 0.55) kit.tombstone(jx, jz, (rnd() - 0.5) * 0.5);
          else kit.cross(jx, jz, R(2.2, 3.2), (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.3, rnd() < 0.5);
        }
      }
      const W = cx - 22, E = cx + 22, N = cz - 14, S = cz + 13;
      kit.fence(W, N, E, N);
      kit.fence(W, S, cx - 5, S);
      kit.fence(cx + 5, S, E, S);
      kit.fence(W, N, W, S);
      kit.fence(E, N, E, S);
      for (let i = 0; i < 4; i++) {
        const x = cx + (rnd() < 0.5 ? -1 : 1) * R(11, 20), z = cz + R(-12, 10);
        if (clear(x, z, 0.6, 0.5)) { kit.deadTree(x, z, R(6, 9), rnd() < 0.6); claim(x, z, 0.6); }
      }
    },
  },

  // "orchestra" clearing: rings of chairs facing a stage of pianos, drums and a gong
  orchestra: {
    r: 17, flat: { y: 0, r1: 15, r2: 21 },
    entries: (L) => [at(L, 0, 19)],
    build({ kit, R, rnd, claim }, L) {
      for (const [r0, n] of [[6, 14], [8, 18], [10, 22]]) {
        for (let i = 0; i < n; i++) {
          const a = Math.PI * 0.15 + (i / n) * Math.PI * 1.7;
          if (rnd() < 0.2) continue;
          const [x, z] = at(L, Math.sin(a) * r0, Math.cos(a) * r0);
          const face = Math.atan2(L.x - x, L.z - z);
          kit.chair(x, z, face + (rnd() - 0.5) * 0.4, rnd() < 0.25);
          if (rnd() < 0.5) {
            const [mx, mz] = at(L, Math.sin(a) * (r0 - 0.8), Math.cos(a) * (r0 - 0.8));
            kit.musicStand(mx, mz, face + Math.PI);
          }
        }
      }
      const put = (lx, lz, fn, r = 1) => { const [x, z] = at(L, lx, lz); fn(x, z); if (r) claim(x, z, r); };
      put(-12, 2, (x, z) => kit.uprightPiano(x, z, Math.PI / 2 + L.rot));
      put(11, 6, (x, z) => kit.uprightPiano(x, z, -Math.PI / 2 - 0.3 + L.rot));
      put(2, 13, (x, z) => kit.piano(x, z, 2.6 + L.rot), 1.6);
      put(-5, 12.5, (x, z) => kit.drumKit(x, z, Math.PI + L.rot), 0);
      put(7, 11, (x, z) => kit.drumKit(x, z, Math.PI + 0.5 + L.rot), 0);
      put(-9, 11, (x, z) => kit.gong(x, z, Math.PI - 0.6 + L.rot), 0);
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * 0.25 + (i / 6) * Math.PI * 1.5;
        const [x, z] = at(L, Math.sin(a) * R(14, 16), Math.cos(a) * R(14, 16));
        kit.speakerStack(x, z, Math.atan2(L.x - x, L.z - z), 2 + Math.floor(rnd() * 2));
        claim(x, z, 1.2);
      }
      for (let i = 0; i < 4; i++) { const [x, z] = at(L, R(-12, 12), R(-4, 12)); kit.instrument('cello', x, z, rnd() * 6, true); }
      for (let i = 0; i < 3; i++) { const [x, z] = at(L, R(-13, 13), R(-3, 14)); kit.bassDrum(x, z, rnd() * 6); }
    },
  },

  // a stand of dead trees with hanging dolls
  deadForest: {
    r: 17, flat: null,
    entries: () => [],
    build({ kit, R, rnd, clear, claim, pathDist }, L) {
      const disc = (n, r, spacing, place) => {
        for (let i = 0; i < n; i++) {
          for (let t = 0; t < 30; t++) {
            const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * L.r;
            const x = L.x + Math.cos(a) * d, z = L.z + Math.sin(a) * d;
            if (!clear(x, z, r, spacing) || pathDist(x, z) < r + 1.2) continue;
            claim(x, z, r);
            place(x, z);
            break;
          }
        }
      };
      disc(28, 0.6, 3.4, (x, z) => kit.deadTree(x, z, R(5.5, 10), rnd() < 0.35));
      disc(3, 2.2, 2, (x, z) => kit.boulder(x, z, R(1.6, 2.6), R(1.4, 2.6), R(1.6, 2.6), rnd() * 6));
    },
  },

  // two rows of big boulders: mostly player-only gaps, every third gap fits the monster
  canyon: {
    r: 21, flat: null,
    entries: (L) => (L.axis === 'x' ? [[L.x - 22, L.z], [L.x + 22, L.z]] : [[L.x, L.z - 22], [L.x, L.z + 22]]),
    build({ kit, R, rnd, claim }, L) {
      for (const off of [-5.5, 5.5]) {
        let u = -18, k = 0;
        while (u < 18) {
          const s = R(2.8, 3.6);
          const j = R(-1, 1);
          const [x, z] = L.axis === 'x' ? [L.x + u, L.z + off + j] : [L.x + off + j, L.z + u];
          kit.boulder(x, z, s, R(2.8, 3.4), s, rnd() * 6); // tops stay within the monster's reach
          claim(x, z, s * 1.2);
          u += s * 2.05 + (++k % 3 === 0 ? 4.5 : R(0.9, 1.6));
        }
      }
    },
  },

  // junk heap: speaker stacks, upright pianos, bass drums behind a broken fence
  junkyard: {
    r: 13, flat: null,
    entries: () => [],
    build({ kit, R, rnd, clear, claim }, L) {
      for (let i = 0; i < 7; i++) {
        const [x, z] = at(L, R(-11, 11), R(-11, 11));
        if (!clear(x, z, 1.2, 1.5)) continue;
        claim(x, z, 1.2);
        kit.speakerStack(x, z, rnd() * 6, 1 + Math.floor(rnd() * 3));
      }
      for (let i = 0; i < 3; i++) {
        const [x, z] = at(L, R(-10, 10), R(-10, 10));
        if (!clear(x, z, 1.6, 2)) continue;
        claim(x, z, 1.6);
        kit.uprightPiano(x, z, rnd() * 6);
      }
      for (let i = 0; i < 8; i++) { const [x, z] = at(L, R(-12, 12), R(-12, 12)); kit.bassDrum(x, z, rnd() * 6); }
      kit.fence(L.x - 13, L.z - 13, L.x + 13, L.z - 13); // fences are axis aligned
    },
  },
};
