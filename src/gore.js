// Screen-space blood for the death jumpscare: a burst of splats with satellite
// droplets and spray, then drips that keep running down the screen.

const rand = (a, b) => a + Math.random() * (b - a);

export class Gore {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.drips = [];
    this.clear();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drips = [];
    this.canvas.classList.remove('show');
  }

  // Match the window size (the page may have loaded while hidden, or been resized).
  _fit() {
    const w = window.innerWidth || 1280, h = window.innerHeight || 720; // 0 while the page is hidden
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  _blob(x, y, r, dark) {
    const ctx = this.ctx;
    // irregular body from overlapping circles
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.55;
      const rr = r * rand(0.35, 0.7);
      const g = ctx.createRadialGradient(x + Math.cos(a) * d, y + Math.sin(a) * d, 0, x + Math.cos(a) * d, y + Math.sin(a) * d, rr);
      g.addColorStop(0, dark ? 'rgba(95,0,0,0.97)' : 'rgba(160,8,8,0.95)');
      g.addColorStop(0.75, dark ? 'rgba(75,0,0,0.93)' : 'rgba(125,2,2,0.92)');
      g.addColorStop(1, 'rgba(60,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, rr, 0, Math.PI * 2); ctx.fill();
    }
    // wet highlight
    ctx.fillStyle = 'rgba(200,40,40,0.25)';
    ctx.beginPath(); ctx.ellipse(x - r * 0.2, y - r * 0.25, r * 0.25, r * 0.12, -0.5, 0, Math.PI * 2); ctx.fill();
    // satellite droplets flung outwards
    const n = Math.floor(rand(8, 18));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = r * rand(0.9, 2.4), s = r * rand(0.03, 0.12);
      ctx.fillStyle = 'rgba(100,0,0,0.9)';
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, s, 0, Math.PI * 2); ctx.fill();
      // streak back towards the centre
      ctx.strokeStyle = 'rgba(90,0,0,0.6)';
      ctx.lineWidth = s * 0.8;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d); ctx.lineTo(x + Math.cos(a) * (d - r * 0.4), y + Math.sin(a) * (d - r * 0.4)); ctx.stroke();
    }
  }

  // The big hit when the jaws close.
  splatter() {
    this._fit();
    const w = this.canvas.width, h = this.canvas.height, u = Math.min(w, h);
    this.canvas.classList.add('show');
    for (let i = 0; i < 13; i++) this._blob(rand(0, w), rand(0, h * 0.85), u * rand(0.07, 0.22), i % 3 === 0);
    // fine spray over everything
    for (let i = 0; i < 900; i++) {
      this.ctx.fillStyle = `rgba(${Math.floor(rand(70, 140))},0,0,${rand(0.4, 0.9)})`;
      const s = rand(0.5, 2.8);
      this.ctx.beginPath(); this.ctx.arc(rand(0, w), rand(0, h), s, 0, Math.PI * 2); this.ctx.fill();
    }
    // drips start under the splats
    for (let i = 0; i < 22; i++) {
      this.drips.push({ x: rand(0, w), y: rand(0, h * 0.55), v: rand(40, 160), wdt: rand(2, 7), life: rand(1.5, 4) });
    }
  }

  // A few extra drops (used during the close-up before the bite).
  spray(n = 3) {
    this._fit();
    const w = this.canvas.width, h = this.canvas.height, u = Math.min(w, h);
    this.canvas.classList.add('show');
    for (let i = 0; i < n; i++) this._blob(rand(0, w), rand(0, h), u * rand(0.015, 0.04), false);
  }

  update(dt) {
    const ctx = this.ctx;
    for (const d of this.drips) {
      if (d.life <= 0) continue;
      d.life -= dt;
      const ny = d.y + d.v * dt;
      ctx.strokeStyle = 'rgba(130,0,0,0.95)';
      ctx.lineWidth = d.wdt;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + Math.sin(ny * 0.05) * 0.6, ny); ctx.stroke();
      // heavier bead at the tip
      ctx.fillStyle = 'rgba(150,4,4,0.97)';
      ctx.beginPath(); ctx.arc(d.x, ny, d.wdt * 0.8, 0, Math.PI * 2); ctx.fill();
      d.y = ny;
      d.v *= 0.995;
      d.wdt = Math.max(1, d.wdt * 0.999);
    }
  }
}
