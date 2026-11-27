/* ============================================
   FULLBAN SEQ-TRAK — VISUALS page (v9i, 27 Nov 2026) - style A: track bars
   One bar per track. A bar jumps when that track plays a note (note-on on its MIDI channel, as sent by the SEQTRAK)
   and falls back; held synth notes keep it up. The background pulses on the beat (MIDI clock).
   Fed from app.js: window.__fbVizIn(bytes) for every non-SysEx message.
   ============================================ */
(function () {
  'use strict';
  const page = document.getElementById('page-viz');
  if (!page || typeof SEQTRAK === 'undefined') return;
  const N = 11;
  const BLUE = ['#2d8cf0', '#2d8cf0', '#2d8cf0', '#2d8cf0', '#2d8cf0', '#2d8cf0', '#2d8cf0', '#7fc0ff', '#7fc0ff', '#7fc0ff', '#7fc0ff'];
  let palette = 'blue';
  try { palette = localStorage.getItem('fbVizPalette') || 'blue'; } catch (e) {}
  const colour = i => (palette === 'blue' ? BLUE[i] : SEQTRAK.TRACKS[i].color);

  const head = document.createElement('div'); head.className = 'viz-head';
  const title = document.createElement('span'); title.className = 'set-title'; title.textContent = 'VISUALS';
  const hint = document.createElement('span'); hint.className = 'set-status'; hint.textContent = 'Press play on the SEQTRAK';
  const palBtn = document.createElement('button'); palBtn.className = 'btn btn-dim';
  const paintPal = () => { palBtn.textContent = palette === 'blue' ? 'COLOURS: BLUE' : 'COLOURS: TRACKS'; };
  palBtn.onclick = () => { palette = palette === 'blue' ? 'tracks' : 'blue'; try { localStorage.setItem('fbVizPalette', palette); } catch (e) {} paintPal(); };
  paintPal();
  head.appendChild(title); head.appendChild(hint); head.appendChild(palBtn);
  const wrap = document.createElement('div'); wrap.className = 'viz-wrap';
  const cv = document.createElement('canvas'); cv.className = 'viz-canvas';
  wrap.appendChild(cv);
  page.appendChild(head); page.appendChild(wrap);
  const ctx = cv.getContext('2d');

  const level = new Array(N).fill(0);     // bar height 0..1
  const peak = new Array(N).fill(0);      // falling peak marker
  const held = new Array(N).fill(0);      // notes held per track
  const hold = new Array(N).fill(0);      // level to hold while notes are down
  let beat = 0, clk = 0, seen = false;

  window.__fbVizIn = d => {
    const st = d[0] & 0xF0, ch = d[0] & 0x0F;
    if (st === 0x90 && d[2] > 0 && ch < N) {
      const v = 0.35 + 0.65 * (d[2] / 127);
      level[ch] = Math.max(level[ch], v); peak[ch] = Math.max(peak[ch], v);
      held[ch]++; hold[ch] = v * 0.8;
      if (!seen) { seen = true; hint.textContent = ''; }
    } else if ((st === 0x80 || (st === 0x90 && d[2] === 0)) && ch < N) {
      held[ch] = Math.max(0, held[ch] - 1);
    } else if (d[0] === 0xFA) { clk = 0; beat = 1; held.fill(0); }
    else if (d[0] === 0xFC) { held.fill(0); }
    else if (d[0] === 0xF8) { if (clk % 24 === 0) beat = 1; clk++; }
  };

  let W = 0, H = 0, raf = 0, last = 0;
  function size() {
    const r = wrap.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(50, Math.floor(r.width)); H = Math.max(50, Math.floor(r.height));
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function draw(t) {
    raf = 0;
    if (page.classList.contains('hidden')) return;
    const dt = Math.min(0.1, (t - last) / 1000 || 0.016); last = t;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8,14,22,' + (0.78 - 0.10 * beat) + ')';
    ctx.fillRect(0, 0, W, H);
    const labelH = 26, top = 10, gap = Math.max(4, W * 0.012), bw = (W - gap * (N + 1)) / N, maxH = H - labelH - top;
    ctx.font = '700 ' + Math.max(9, Math.min(13, bw * 0.2)) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < N; i++) {
      const floor = held[i] > 0 ? hold[i] : 0;
      level[i] = Math.max(floor, level[i] - dt * (1.6 + 2.2 * level[i]));
      peak[i] = Math.max(level[i], peak[i] - dt * 0.45);
      const x = gap + i * (bw + gap), c = colour(i);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, top, bw, maxH);
      const h = Math.max(2, level[i] * maxH);
      ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, level[i] * 1.4);
      ctx.fillStyle = c;
      ctx.fillRect(x, top + maxH - h, bw, h);
      ctx.globalAlpha = 1;
      if (peak[i] > 0.02) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x, top + maxH - peak[i] * maxH - 3, bw, 3); }
      ctx.fillStyle = level[i] > 0.05 ? '#ffffff' : '#7d8a9a';
      const tk = SEQTRAK.TRACKS[i];
      ctx.fillText(tk.short || tk.name, x + bw / 2, H - labelH / 2);
    }
    beat = Math.max(0, beat - dt * 4);
    raf = requestAnimationFrame(draw);
  }
  function start() { size(); if (!raf) { last = performance.now(); raf = requestAnimationFrame(draw); } }
  const tab = document.querySelector('.tab[data-page="viz"]');
  if (tab) tab.addEventListener('click', () => setTimeout(start, 30));
  window.addEventListener('resize', () => { if (!page.classList.contains('hidden')) size(); });
})();
