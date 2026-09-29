import * as THREE from 'three';

// Procedural placeholder textures so surfaces read well under the flashlight.
// Swap these out for real textures later.

function rand(min, max) { return min + Math.random() * (max - min); }

function makeCanvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function speckle(ctx, s, count, light, dark) {
  for (let i = 0; i < count; i++) {
    const v = Math.random() < 0.5 ? light : dark;
    ctx.fillStyle = `rgba(${v},${v},${v},${rand(0.03, 0.12)})`;
    const r = rand(0.5, 2.5);
    ctx.fillRect(rand(0, s), rand(0, s), r, r);
  }
}

function blotches(ctx, s, count, color, maxR) {
  for (let i = 0; i < count; i++) {
    const x = rand(0, s), y = rand(0, s), r = rand(maxR * 0.2, maxR);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function cracks(ctx, s, count) {
  ctx.strokeStyle = 'rgba(20,20,20,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    let x = rand(0, s), y = rand(0, s);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let j = 0; j < 8; j++) {
      x += rand(-15, 15); y += rand(-15, 15);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

export function concreteTexture() {
  return makeCanvas(512, (ctx, s) => {
    ctx.fillStyle = '#76746e';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, 40, 'rgba(40,38,34,0.25)', 90);
    blotches(ctx, s, 20, 'rgba(160,155,145,0.12)', 70);
    speckle(ctx, s, 9000, 220, 20);
    // water streaks
    for (let i = 0; i < 25; i++) {
      const x = rand(0, s), w = rand(2, 10), h = rand(40, 260);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(30,28,24,0.25)');
      g.addColorStop(1, 'rgba(30,28,24,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, w, h);
    }
    cracks(ctx, s, 6);
  });
}

export function floorTexture() {
  return makeCanvas(512, (ctx, s) => {
    const tiles = 4, t = s / tiles;
    for (let y = 0; y < tiles; y++) {
      for (let x = 0; x < tiles; x++) {
        const v = Math.floor(rand(78, 98));
        ctx.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
        ctx.fillRect(x * t, y * t, t, t);
      }
    }
    blotches(ctx, s, 30, 'rgba(25,22,18,0.35)', 110);
    speckle(ctx, s, 10000, 200, 10);
    ctx.strokeStyle = 'rgba(15,15,15,0.8)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath(); ctx.moveTo(i * t, 0); ctx.lineTo(i * t, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * t); ctx.lineTo(s, i * t); ctx.stroke();
    }
    cracks(ctx, s, 8);
  });
}

export function crateTexture() {
  return makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#6e4d2c';
    ctx.fillRect(0, 0, s, s);
    // planks
    const planks = 5;
    for (let i = 0; i < planks; i++) {
      const v = rand(-12, 12);
      ctx.fillStyle = `rgba(${110 + v},${78 + v},${45 + v},1)`;
      ctx.fillRect(0, (i * s) / planks + 1, s, s / planks - 2);
    }
    // grain
    for (let i = 0; i < 300; i++) {
      ctx.strokeStyle = `rgba(40,25,10,${rand(0.05, 0.2)})`;
      const y = rand(0, s);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(s / 3, y + rand(-4, 4), (2 * s) / 3, y + rand(-4, 4), s, y); ctx.stroke();
    }
    // frame + brace
    ctx.strokeStyle = '#3d2914';
    ctx.lineWidth = 22;
    ctx.strokeRect(11, 11, s - 22, s - 22);
    ctx.lineWidth = 18;
    ctx.beginPath(); ctx.moveTo(20, 20); ctx.lineTo(s - 20, s - 20); ctx.stroke();
    ctx.strokeStyle = '#8a6238';
    ctx.lineWidth = 14;
    ctx.strokeRect(11, 11, s - 22, s - 22);
    ctx.beginPath(); ctx.moveTo(20, 20); ctx.lineTo(s - 20, s - 20); ctx.stroke();
    speckle(ctx, s, 2000, 200, 10);
  });
}

export function metalTexture() {
  return makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#50555a';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},255,0.02)`;
      ctx.fillRect(rand(0, s), 0, rand(1, 3), s);
    }
    blotches(ctx, s, 25, 'rgba(110,55,20,0.4)', 40); // rust
    speckle(ctx, s, 3000, 230, 10);
    ctx.fillStyle = 'rgba(20,20,20,0.7)';
    for (let x = 12; x < s; x += 58) {
      for (const y of [10, s - 10]) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
    }
  });
}

export function labelTexture(text, fg = '#ddd', bg = 'rgba(0,0,0,0)', w = 256, h = 128) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = `bold ${Math.floor(h * 0.55)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft ring pattern projected by the flashlight (a "cookie").
export function flashlightCookie() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, s, s);
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, '#fff');
  g.addColorStop(0.18, '#f4f4f4');
  g.addColorStop(0.3, '#9a9a9a');
  g.addColorStop(0.42, '#c8c8c8');
  g.addColorStop(0.55, '#7a7a7a');
  g.addColorStop(0.8, '#303030');
  g.addColorStop(1.0, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // dust / lens smudges
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rand(0.03, 0.1)})`;
    ctx.beginPath();
    ctx.arc(rand(s * 0.2, s * 0.8), rand(s * 0.2, s * 0.8), rand(4, 18), 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- red field textures

export function mudTexture() {
  return makeCanvas(512, (ctx, s) => {
    ctx.fillStyle = '#5a3a30';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, 60, 'rgba(30,12,8,0.45)', 80);
    blotches(ctx, s, 30, 'rgba(120,60,45,0.18)', 60);
    speckle(ctx, s, 14000, 190, 10);
    // pebbles
    for (let i = 0; i < 250; i++) {
      const v = Math.floor(rand(40, 110));
      ctx.fillStyle = `rgba(${v},${v * 0.7},${v * 0.6},0.6)`;
      ctx.beginPath();
      ctx.ellipse(rand(0, s), rand(0, s), rand(1, 4), rand(1, 3), rand(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
    // wet streaks
    blotches(ctx, s, 12, 'rgba(90,10,8,0.25)', 50);
  });
}

export function rockTexture() {
  return makeCanvas(512, (ctx, s) => {
    ctx.fillStyle = '#4a302b';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, 50, 'rgba(20,8,6,0.4)', 100);
    blotches(ctx, s, 30, 'rgba(140,70,55,0.15)', 70);
    speckle(ctx, s, 12000, 200, 10);
    ctx.strokeStyle = 'rgba(15,5,4,0.55)';
    for (let i = 0; i < 25; i++) {
      ctx.lineWidth = rand(1, 3);
      let x = rand(0, s), y = rand(0, s);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += rand(-40, 40); y += rand(-20, 40); ctx.lineTo(x, y); }
      ctx.stroke();
    }
  });
}

export function woodTexture() {
  return makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#4b3122';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 180; i++) {
      ctx.strokeStyle = `rgba(${rand(15, 40)},${rand(8, 20)},5,${rand(0.15, 0.4)})`;
      ctx.lineWidth = rand(0.5, 2.5);
      const x = rand(0, s);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x + rand(-6, 6), s / 3, x + rand(-6, 6), (2 * s) / 3, x, s); ctx.stroke();
    }
    blotches(ctx, s, 12, 'rgba(90,10,8,0.35)', 30); // blood
    speckle(ctx, s, 2500, 180, 10);
  });
}

export function burlapTexture() {
  return makeCanvas(128, (ctx, s) => {
    ctx.fillStyle = '#7a5a3a';
    ctx.fillRect(0, 0, s, s);
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < s; i += 3) {
      ctx.fillStyle = i % 6 ? '#3a2715' : '#9a7a52';
      ctx.fillRect(i, 0, 1, s);
      ctx.fillRect(0, i, s, 1);
    }
    ctx.globalAlpha = 1;
    blotches(ctx, s, 6, 'rgba(90,10,8,0.4)', 25);
  });
}

export function fleshTexture() {
  return makeCanvas(512, (ctx, s) => {
    ctx.fillStyle = '#3a0c0a';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, 80, 'rgba(110,20,15,0.35)', 60);
    blotches(ctx, s, 40, 'rgba(10,2,2,0.5)', 70);
    // scaly bumps
    for (let i = 0; i < 1400; i++) {
      const x = rand(0, s), y = rand(0, s), r = rand(2, 7);
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      g.addColorStop(0, 'rgba(120,45,35,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // glowing cracks
    ctx.strokeStyle = 'rgba(220,40,20,0.55)';
    for (let i = 0; i < 18; i++) {
      ctx.lineWidth = rand(0.5, 2);
      let x = rand(0, s), y = rand(0, s);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 7; j++) { x += rand(-25, 25); y += rand(-25, 25); ctx.lineTo(x, y); }
      ctx.stroke();
    }
  });
}

export function drumSkinTexture() {
  return makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#b8a890';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, 25, 'rgba(60,40,25,0.3)', 50);
    blotches(ctx, s, 14, 'rgba(110,8,5,0.55)', 40); // blood
    speckle(ctx, s, 3000, 230, 20);
    ctx.strokeStyle = 'rgba(40,20,10,0.5)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2); ctx.stroke();
  });
}

export function drumShellTexture() {
  return makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#4a0808';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, 20, 'rgba(0,0,0,0.5)', 40);
    speckle(ctx, s, 2500, 200, 10);
    // lugs
    for (let x = 8; x < s; x += 32) {
      ctx.fillStyle = '#9a9a9a';
      ctx.fillRect(x, s * 0.3, 10, s * 0.4);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x + 7, s * 0.3, 3, s * 0.4);
    }
  });
}

export function beachBallTexture() {
  return makeCanvas(256, (ctx, s) => {
    const cols = ['#c22', '#ddd', '#c22', '#ddd', '#c22', '#ddd'];
    cols.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect((i * s) / 6, 0, s / 6 + 1, s); });
    blotches(ctx, s, 20, 'rgba(40,10,5,0.45)', 30);
  });
}

export function leafTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = '#b01818';
  ctx.beginPath();
  ctx.moveTo(s / 2, 2);
  ctx.bezierCurveTo(s * 1.05, s * 0.3, s * 0.8, s * 0.85, s / 2, s - 2);
  ctx.bezierCurveTo(s * 0.2, s * 0.85, -s * 0.05, s * 0.3, s / 2, 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,0,0,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(s / 2, 4); ctx.lineTo(s / 2, s - 4); ctx.stroke();
  for (let i = 1; i < 6; i++) {
    const y = (i * s) / 6;
    ctx.beginPath(); ctx.moveTo(s / 2, y); ctx.lineTo(s * 0.2, y - 12); ctx.moveTo(s / 2, y); ctx.lineTo(s * 0.8, y - 12); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
