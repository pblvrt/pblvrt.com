// Photoreal avatar made of real footage: every frame is a real video frame of Pablo,
// stabilised to one head pose (see tools/avatar/build_frames.py). While he speaks, a
// Viterbi search picks the frame sequence whose mouths best match the sounds coming up
// (ElevenLabs character timings), preferring to play real footage forward and only
// jumping between frames that look alike. Same interface as the old LipSync class.
(() => {
const FPS = 25, LEAD = 0.04;
const VIS = {}; // char -> [mouth openness, shape]  shape: 0 round, 1 mid, 2 wide
const set = (chars, v) => { for (const c of chars) VIS[c] = v; };
set('aáà', [0.2, 1]); set('eéè', [0.15, 2]); set('iíy', [0.1, 2]);
set('oóò', [0.17, 0]); set('uúü', [0.09, 0]); set('w', [0.05, 0]);
set('mbp', [0.0, 1]); set('fv', [0.025, 2]);
set('tdnlszckgjrhxqñç', [0.075, 1]); set('0123456789', [0.11, 1]);
const REST = [0.0, 1];

const load = src => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = src; });

class Avatar {
  constructor(canvas) { this.cv = canvas; this.cx = canvas.getContext('2d'); this.ready = false; }

  async init(base = '/avatar/real/') {
    const c = this.cfg = await (await fetch(base + 'avatar.json')).json();
    const [W, H] = c.size; this.cv.width = W; this.cv.height = H;
    const N = this.N = c.f.length;
    this.open = Float32Array.from(c.f, f => f[0]); this.wid = Float32Array.from(c.f, f => f[1]); this.blink = Float32Array.from(c.f, f => f[2]);
    this.next = Int32Array.from(c.src, (s, i) => i + 1 < N && c.src[i + 1] === s + 1 ? i + 1 : -1); // real-footage successor
    const ws = [...this.wid].sort((a, b) => a - b), q = p => ws[Math.floor(p * (ws.length - 1))];
    this.shapeW = [q(0.15), q(0.5), q(0.85)];
    this.sheets = []; this.has = new Uint8Array(N); this.desc = new Float32Array(N * 48);
    await this.loadSheet(0, base);
    this.ready = true; this.t0 = performance.now(); this.cur = 0; this.idle = null; this.track = null;
    (async () => { for (let s = 1; s < c.sheets.length; s++) await this.loadSheet(s, base).catch(() => {}); this.jump = null; })();
    const loop = () => { this.frame(); requestAnimationFrame(loop); }; loop();
  }

  async loadSheet(s, base) {
    const c = this.cfg, img = await load(base + c.sheets[s]); this.sheets[s] = img;
    // tiny grey thumbnail of each frame, used to judge how visible a jump between frames is
    const [W, H] = c.size, tc = document.createElement('canvas'); tc.width = 6; tc.height = 8; const tx = tc.getContext('2d', { willReadFrequently: true });
    for (let j = 0; j < c.per; j++) {
      const i = s * c.per + j; if (i >= this.N) break;
      tx.drawImage(img, (j % c.cols) * W, Math.floor(j / c.cols) * H, W, H, 0, 0, 6, 8);
      const px = tx.getImageData(0, 0, 6, 8).data;
      for (let k = 0; k < 48; k++) this.desc[i * 48 + k] = (px[k * 4] * 0.3 + px[k * 4 + 1] * 0.59 + px[k * 4 + 2] * 0.11) / 255;
      this.has[i] = 1;
    }
    this.jump = null;
  }

  // cost of cutting from frame a to frame b (cached; rebuilt as more frames load)
  jumpCost() {
    if (this.jump) return this.jump;
    const N = this.N, J = new Float32Array(N * N), d = this.desc;
    for (let a = 0; a < N; a++) for (let b = a; b < N; b++) {
      let s = 0; for (let k = 0; k < 48; k++) s += Math.abs(d[a * 48 + k] - d[b * 48 + k]);
      J[a * N + b] = J[b * N + a] = 2.5 + 120 * s / 48;
    }
    // keep only the K most similar frames as cut sources for each frame: 10x faster search
    const K = this.K = 40, nb = new Int32Array(N * K), nc = new Float32Array(N * K), idx = [...Array(N).keys()];
    for (let j = 0; j < N; j++) {
      const best = idx.filter(i => i !== j && this.has[i]).sort((a, b) => J[j * N + a] - J[j * N + b]).slice(0, K);
      for (let k = 0; k < K; k++) { const i = best[k] ?? j; nb[j * K + k] = i; nc[j * K + k] = J[j * N + i]; }
    }
    this.nb = nb; this.nc = nc;
    return this.jump = J;
  }

  // Viterbi over frames: targets = [[open, width], ...] at FPS; returns frame indices
  plan(targets, start, idle) {
    const N = this.N, T = targets.length, J = this.jumpCost(), has = this.has, nx = this.next;
    const HOLD = idle ? 0.8 : 0.9, BLINK = idle ? 0.2 : 1.2;
    let D = new Float32Array(N), back = new Int32Array(T * N);
    const emit = (j, t) => { const [o, w] = targets[t]; return ((this.open[j] - o) / 0.025) ** 2 + ((this.wid[j] - w) / 0.09) ** 2 + BLINK * this.blink[j]; };
    for (let j = 0; j < N; j++) D[j] = has[j] ? (start == null ? 0 : start === j ? 0 : nx[start] === j ? 0 : J[start * N + j]) + emit(j, 0) : Infinity;
    for (let t = 1; t < T; t++) {
      const E = new Float32Array(N).fill(Infinity), bt = t * N;
      // best jump into each frame
      for (let j = 0; j < N; j++) {
        if (!has[j]) continue;
        let best = D[j] + HOLD, arg = j; const K = this.K, nb = this.nb, nc = this.nc;
        for (let k = j * K, e = k + K; k < e; k++) { const v = D[nb[k]] + nc[k]; if (v < best) { best = v; arg = nb[k]; } }
        E[j] = best; back[bt + j] = arg;
      }
      // playing real footage forward is free
      for (let i = 0; i < N; i++) { const j = nx[i]; if (j >= 0 && has[j] && D[i] < E[j]) { E[j] = D[i]; back[bt + j] = i; } }
      for (let j = 0; j < N; j++) if (E[j] < Infinity) E[j] += emit(j, t);
      D = E;
    }
    let j = 0; for (let k = 1; k < N; k++) if (D[k] < D[j]) j = k;
    const path = new Int32Array(T); for (let t = T - 1; t >= 0; t--) { path[t] = j; if (t) j = back[t * N + j]; }
    return path;
  }

  // mouth targets per video frame from a character timeline
  targets(tl, dur) {
    const T = Math.max(2, Math.ceil(dur * FPS) + 3), out = [];
    let k = 0;
    for (let t = 0; t < T; t++) {
      const s = t / FPS + LEAD; while (k + 1 < tl.length && tl[k + 1].t0 <= s) k++;
      const c = tl[k]; const v = c && s >= c.t0 && s <= c.t1 + 0.05 ? (VIS[c.ch.toLowerCase()] || REST) : REST;
      out.push([v[0], this.shapeW[v[1]]]);
    }
    // real mouths blend neighbouring sounds
    return out.map((v, t) => { const a = out[Math.max(0, t - 1)], b = out[Math.min(T - 1, t + 1)]; return [(a[0] + 2 * v[0] + b[0]) / 4, (a[1] + 2 * v[1] + b[1]) / 4]; });
  }

  // play the real talking footage straight through (forward, bouncing back at cuts)
  // instead of hopping between frames: real motion reads as natural even off-sync
  speak(tl, dur, clock) {
    const T = Math.ceil(dur * FPS) + 3, path = new Int32Array(T), ok = i => i >= 0 && this.has[i];
    let f = Math.floor(Math.random() * this.N), d = 1; while (!ok(f)) f = (f + 1) % this.N;
    for (let t = 0; t < T; t++) {
      path[t] = f;
      let g = d > 0 ? this.next[f] : (f > 0 && this.next[f - 1] === f ? f - 1 : -1);
      if (!ok(g)) { d = -d; g = d > 0 ? this.next[f] : (f > 0 && this.next[f - 1] === f ? f - 1 : -1); }
      if (ok(g)) f = g;
    }
    this.track = { path, clock }; this.idle = null;
  }

  // ElevenLabs alignment {characters, character_start_times_seconds, character_end_times_seconds}
  playAudio(audio, alignment) {
    if (!alignment) return;
    const tl = alignment.characters.map((ch, k) => ({ ch, t0: alignment.character_start_times_seconds[k], t1: alignment.character_end_times_seconds[k] }));
    const dur = Math.max(audio.duration || 0, tl.length ? tl[tl.length - 1].t1 : 0);
    this.speak(tl, dur, () => (audio.paused || audio.ended) ? null : audio.currentTime);
  }

  // browser speech: no audio access, so estimate timing
  playSynth(utt, text) {
    const cps = 14.5 * (utt.rate || 1); const tl = []; let t = 0;
    for (const ch of text) { const d = /[.,;:!?]/.test(ch) ? 0.22 : ch === ' ' ? 0.06 : 1 / cps; tl.push({ ch, t0: t, t1: t + d }); t += d; }
    let start = 0, on = false;
    utt.addEventListener('start', () => { start = performance.now(); on = true; });
    utt.addEventListener('boundary', e => { const c = tl[e.charIndex]; if (c) start = performance.now() - c.t0 * 1000; });
    const clock = () => on ? (performance.now() - start) / 1000 : null;
    this.speak(tl, t, clock);
    const tr = this.track; utt.addEventListener('end', () => { if (this.track === tr) this.track = null; });
  }

  unlock() {}
  stop() { this.track = null; }

  // calm "listening" face: hold a real closed-mouth frame, drift slowly to a similar one
  // every few seconds, and blink with the most similar real blink frame
  idlePlan() {
    const N = this.N, J = this.jumpCost(), has = this.has;
    const calm = [], blinks = [];
    for (let i = 0; i < N; i++) if (has[i]) { if (this.open[i] < 0.035 && this.blink[i] < 0.3) calm.push(i); else if (this.blink[i] > 0.55) blinks.push(i); }
    if (!calm.length) calm.push(this.cur || 0);
    const near = (from, set, n) => set.slice().sort((x, y) => J[from * N + x] - J[from * N + y]).slice(0, n);
    let f = calm.includes(this.cur) ? this.cur : near(this.cur || 0, calm, 1)[0];
    const path = [];
    for (let seg = 0; seg < 3; seg++) {
      const hold = Math.round(FPS * (2 + Math.random() * 2.5));
      const blinkAt = blinks.length && Math.random() < 0.8 ? Math.floor(hold * (0.3 + Math.random() * 0.4)) : -1;
      const bf = blinkAt >= 0 ? near(f, blinks, 1)[0] : -1;
      for (let k = 0; k < hold; k++) path.push(k >= blinkAt && k < blinkAt + 4 && bf >= 0 ? bf : f);
      const opts = near(f, calm, 8).filter(x => x !== f); if (opts.length) f = opts[Math.floor(Math.random() * opts.length)];
    }
    this.idle = { path: Int32Array.from(path), t0: performance.now() };
  }

  frame() {
    if (!this.ready) return;
    const now = performance.now();
    let pos = null; const tr = this.track;
    if (tr) {
      const t = tr.clock();
      if (t != null && t * FPS < tr.path.length - 1) { pos = { path: tr.path, f: t * FPS }; tr.started = true; }
      else if (tr.started) { this.track = null; this.idle = null; } // finished: settle back from where the mouth is
    }
    if (!pos) {
      if (!this.idle) this.idlePlan();
      const f = (now - this.idle.t0) / 1000 * FPS;
      if (f >= this.idle.path.length - 1) { this.idlePlan(); return this.frame(); }
      pos = { path: this.idle.path, f };
    }
    const k = Math.floor(pos.f), a = pos.path[k], b = pos.path[Math.min(k + 1, pos.path.length - 1)], fr = pos.f - k;
    // cuts between non-consecutive frames dissolve over ~120 ms so they read as motion
    if (this.cur != null && a !== this.cur && a !== this.next[this.cur]) { this.fadeFrom = this.cur; this.fadeAt = now; this.fadeMs = pos.path !== (this.idle && this.idle.path) ? 120 : this.blink[a] > 0.5 || this.blink[this.cur] > 0.5 ? 50 : 450; }
    this.cur = a;
    const fade = this.fadeFrom != null ? Math.min(1, (now - this.fadeAt) / this.fadeMs) : 1;
    if (fade >= 1) this.fadeFrom = null;
    const { cx, cfg } = this, [W, H] = cfg.size;
    const s = (now - this.t0) / 1000, m = tr && tr.started ? 1.5 : 1;
    const x = Math.sin(s * 0.7) * 2 * m + Math.sin(s * 1.9) * 0.6, y = Math.sin(s * 0.53 + 1) * 1.5;
    const r = Math.sin(s * 0.41) * 0.3 * m * Math.PI / 180;
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.translate(W / 2 + x, H * 0.4 + y); cx.rotate(r); cx.scale(1.025, 1.025); cx.translate(-W / 2, -H * 0.4);
    if (this.fadeFrom != null) { cx.globalAlpha = 1; this.draw(this.fadeFrom); }
    cx.globalAlpha = fade; this.draw(a);
    if (b !== a && fr > 0.02) { cx.globalAlpha = fade * fr; this.draw(b); }
    cx.globalAlpha = 1; cx.setTransform(1, 0, 0, 1, 0, 0);
  }

  draw(i) {
    const c = this.cfg, [W, H] = c.size, s = Math.floor(i / c.per), j = i % c.per, img = this.sheets[s];
    if (img) this.cx.drawImage(img, (j % c.cols) * W, Math.floor(j / c.cols) * H, W, H, 0, 0, W, H);
  }
}
window.LipSync = Avatar; // drop-in for the page
})();
