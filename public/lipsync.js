// Lip-synced talking head drawn on a canvas: one still face plus mouth and blink
// sprites cut from real footage (see github.com/pblvrt/pblvrt.com avatar/lipsync).
// The mouth follows a character timeline (ElevenLabs alignment or an estimate for
// browser speech) and, when we have the audio, its loudness.
(() => {
const VIS = {}; // char -> [openness, shape]  shape: 0 round, 1 mid, 2 wide
const set = (chars, v) => { for (const c of chars) VIS[c] = v; };
set('aáà', [0.21, 1]); set('eéè', [0.14, 2]); set('iíy', [0.09, 2]);
set('oóò', [0.17, 0]); set('uúü', [0.09, 0]); set('w', [0.04, 0]);
set('mbp', [0, 1]); set('fv', [0.015, 2]);
set('tdnlszckgjrhxqñç', [0.06, 1]); set('0123456789', [0.08, 1]);
const REST = [0, 1];

const load = src => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = src; });

class LipSync {
  constructor(canvas) { this.cv = canvas; this.cx = canvas.getContext('2d'); this.ready = false; }
  async init(url = '/avatar/lipsync.json') {
    const c = this.cfg = await (await fetch(url)).json();
    [this.face, this.mouths, this.eyes] = await Promise.all([load(c.face), load(c.mouth.src), load(c.eyes.src)]);
    this.cv.width = c.size[0]; this.cv.height = c.size[1];
    const ws = c.mouth.items.map(i => i.width).sort((a, b) => a - b), q = p => ws[Math.floor(p * (ws.length - 1))];
    this.shapeW = [q(0.15), q(0.5), q(0.85)];
    this.open = 0; this.width = this.shapeW[1]; this.talk = 0; this.amp = 0; this.peak = 0.05;
    this.track = null; this.nextBlink = performance.now() + 2000; this.blinkAt = -1;
    this.ready = true; this.t0 = performance.now();
    const loop = () => { this.frame(); requestAnimationFrame(loop); }; loop();
  }
  // Timeline from ElevenLabs alignment {characters, character_start_times_seconds, character_end_times_seconds}
  playAudio(audio, alignment) {
    const tl = alignment ? alignment.characters.map((ch, k) => ({ ch, t0: alignment.character_start_times_seconds[k], t1: alignment.character_end_times_seconds[k] })) : null;
    let an = null;
    try {
      if (!this.ac || this.ac.state !== 'running') throw 0;
      const src = this.ac.createMediaElementSource(audio); an = this.ac.createAnalyser(); an.fftSize = 1024;
      src.connect(an); an.connect(this.ac.destination);
    } catch { an = null; }
    this.track = { kind: 'audio', audio, tl, an, buf: an && new Float32Array(an.fftSize) };
  }
  // Browser speech: no audio access, so estimate timing and resync on word boundaries.
  playSynth(utt, text) {
    const cps = 14.5 * (utt.rate || 1); const tl = []; let t = 0;
    for (const ch of text) { const d = /[.,;:!?]/.test(ch) ? 0.22 : ch === ' ' ? 0.06 : 1 / cps; tl.push({ ch, t0: t, t1: t + d }); t += d; }
    const tr = this.track = { kind: 'synth', tl, start: 0, on: false };
    utt.addEventListener('start', () => { tr.start = performance.now(); tr.on = true; });
    utt.addEventListener('boundary', e => { const c = tl[e.charIndex]; if (c) tr.start = performance.now() - c.t0 * 1000; });
    utt.addEventListener('end', () => { if (this.track === tr) this.track = null; });
  }
  // call from a click/keypress so the audio analyser is allowed to run
  unlock() { try { this.ac = this.ac || new (window.AudioContext || window.webkitAudioContext)(); this.ac.resume(); } catch {} }
  stop() { this.track = null; }
  target() {
    const tr = this.track; if (!tr) return null;
    let t;
    if (tr.kind === 'audio') { if (tr.audio.paused || tr.audio.ended) return null; t = tr.audio.currentTime + 0.07; } // lips lead the sound slightly
    else { if (!tr.on) return null; t = (performance.now() - tr.start) / 1000; }
    let v = REST, amp = 1;
    if (tr.tl) {
      // binary search the character being spoken
      let lo = 0, hi = tr.tl.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tr.tl[m].t0 <= t) lo = m; else hi = m - 1; }
      const c = tr.tl[lo]; if (c && t <= c.t1 + 0.05) v = VIS[c.ch.toLowerCase()] || REST;
    } else v = [0.11, 1];
    if (tr.an) {
      tr.an.getFloatTimeDomainData(tr.buf); let s = 0; for (const x of tr.buf) s += x * x;
      const rms = Math.sqrt(s / tr.buf.length); if (rms > 0.004) tr.heard = true;
      if (tr.heard) { // only trust loudness once the analyser actually hears something
        this.peak = Math.max(rms, this.peak * 0.995, 0.02);
        this.amp += ((rms / this.peak) - this.amp) * 0.5;
        amp = this.amp < 0.08 ? 0.2 : 0.85 + 0.6 * this.amp;
        if (!tr.tl) v = [0.2 * this.amp, 1];
      }
    }
    return [Math.min(v[0] * amp * 1.35, 0.23), v[1]];
  }
  frame() {
    const now = performance.now(), dt = Math.min(0.05, (now - (this.last || now)) / 1000); this.last = now;
    const tg = this.target(), speaking = !!tg, [to, ts] = tg || REST;
    const k = 1 - Math.exp(-dt / 0.035);
    this.open += (to - this.open) * k; this.width += (this.shapeW[ts] - this.width) * k * 0.8;
    this.talk += ((speaking ? 1 : 0) - this.talk) * (1 - Math.exp(-dt / 0.25));
    const { cx, cfg } = this, [W, H] = cfg.size;
    // subtle head motion, a bit more while talking (drawn into the canvas so recordings keep it)
    const s = (now - this.t0) / 1000, m = 1 + this.talk * (0.6 + this.amp);
    const x = Math.sin(s * 0.7) * 2 * m + Math.sin(s * 1.9) * 0.6, y = Math.sin(s * 0.53 + 1) * 1.5 + this.talk * this.open * 6;
    const r = (Math.sin(s * 0.41) * 0.35 * m + Math.sin(s * 1.3 + 2) * 0.15 * this.talk) * Math.PI / 180;
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.translate(W / 2 + x, H * 0.45 + y); cx.rotate(r); cx.scale(1.03, 1.03); cx.translate(-W / 2, -H * 0.45);
    cx.drawImage(this.face, 0, 0, W, H);
    // mouth: blend the two closest sprites
    if (this.talk > 0.01) {
      const its = cfg.mouth.items, d = its.map((it, i) => [((it.open - this.open) / 0.03) ** 2 + ((it.width - this.width) / 0.07) ** 2, i]).sort((a, b) => a[0] - b[0]);
      const [a, b] = d, wb = a[0] + b[0] > 0 ? a[0] / (a[0] + b[0]) : 0;
      this.sprite(a[1], this.talk); if (wb > 0.05) this.sprite(b[1], this.talk * wb);
    }
    // blinks
    if (now > this.nextBlink) { this.blinkAt = now; this.nextBlink = now + 2200 + Math.random() * 4200; }
    const bt = now - this.blinkAt;
    if (bt >= 0 && bt < 170) { const [ex, ey, ew, eh] = cfg.eyes.box, idx = bt < 40 || bt > 120 ? 1 : 0; cx.globalAlpha = 1; cx.drawImage(this.eyes, idx * ew, 0, ew, eh, ex, ey, ew, eh); }
    cx.globalAlpha = 1; cx.setTransform(1, 0, 0, 1, 0, 0);
  }
  sprite(i, alpha) {
    const [x, y, w, h] = this.cfg.mouth.box, c = this.cfg.mouth.cols, r = Math.floor(i / c), col = i % c;
    this.cx.globalAlpha = Math.max(0, Math.min(1, alpha));
    this.cx.drawImage(this.mouths, col * w, r * h, w, h, x, y, w, h);
  }
}
window.LipSync = LipSync;
})();
