/* ============================================
   FULLBAN SEQ-TRAK — SETTINGS page (v9g, 27 Nov 2026)
   The unit's own system settings (addresses 00 00 xx, Yamaha Data List).
   Left out on purpose: USB / Bluetooth MIDI on-off, USB role, Wi-Fi, sink current - changing those can cut this app off.
   ============================================ */
(function () {
  'use strict';
  const page = document.getElementById('page-set');
  if (!page || typeof SEQTRAK === 'undefined' || typeof MIDIManager === 'undefined') return;

  const ONOFF = ['OFF', 'ON'];
  const THRU = ['OFF', 'CHANNEL', 'REALTIME', 'BOTH'];
  const GAIN = ['-6 dB', '0 dB', '+6 dB', '+12 dB'];
  const S = (lo, label, type, extra) => Object.assign({ addr: [0x00, 0x00, lo], label, type }, extra || {});
  const GROUPS = [
    { title: 'SYNC & TRANSPORT', color: 'var(--fb-blue)', items: [
      S(0x2A, 'Tempo sync', 'choice', { names: ['INTERNAL', 'MIDI (AUTO)'], hint: 'MIDI (AUTO) follows an incoming clock, e.g. the MPC' }),
      S(0x2D, 'Send MIDI clock', 'toggle'),
      S(0x2B, 'Send start / stop', 'toggle'),
      S(0x06, 'Local control', 'toggle', { hint: 'OFF = the keys and pads only send MIDI, they do not play the unit' }),
    ] },
    { title: 'MIDI THRU', color: 'var(--fb-cyan)', items: [
      S(0x23, 'USB', 'choice', { names: THRU }),
      S(0x24, 'Bluetooth', 'choice', { names: THRU }),
      S(0x22, 'MIDI socket', 'choice', { names: THRU }),
    ] },
    { title: 'MIDI MESSAGES', color: 'var(--fb-cyan)', items: [
      S(0x07, 'Bank select', 'toggle', { hint: 'send and receive' }),
      S(0x08, 'Program change', 'toggle', { hint: 'send and receive' }),
    ] },
    { title: 'METRONOME', color: 'var(--fb-orange)', items: [
      S(0x25, 'Click', 'toggle'),
      S(0x26, 'Click sound', 'slider', { min: 0, max: 9, show: v => String(v + 1) }),
      S(0x27, 'Click volume', 'slider', { min: 0, max: 127 }),
    ] },
    { title: 'PLAYING & RECORDING', color: 'var(--fb-blue)', items: [
      S(0x1F, 'Record quantize', 'choice', { names: ['OFF', '1/32', '1/16T', '1/16', '1/8T', '1/8'], hint: 'unit values 60 / 80 / 120 / 160 / 240 ticks' }),
      S(0x20, 'Pad velocity', 'slider', { min: 1, max: 127 }),
      S(0x2F, 'Pattern select sensitivity', 'choice', { names: ['1', '2', '3'], base: 1 }),
      S(0x21, 'Sound design mode', 'choice', { names: ['NORMAL', 'ADVANCED'] }),
    ] },
    { title: 'SAMPLING', color: 'var(--fb-orange)', items: [
      S(0x19, 'Source', 'choice', { names: ['RESAMPLE', 'MIC / LINE', 'USB AUDIO'] }),
      S(0x1B, 'Count-in', 'toggle'),
      S(0x1C, 'Auto normalize', 'toggle'),
    ] },
    { title: 'PROJECT', color: 'var(--fb-blue)', items: [
      S(0x1D, 'Resume last project', 'toggle'),
      S(0x1E, 'Resume: auto play', 'toggle'),
    ] },
    { title: 'OUTPUT LEVEL', color: 'var(--fb-cyan)', items: [
      S(0x18, 'Line / phones gain', 'choice', { names: GAIN }),
      S(0x15, 'USB audio gain', 'choice', { names: GAIN }),
    ] },
  ];

  const keyOf = a => 'sx:' + a.map(b => b.toString(16).padStart(2, '0')).join('');
  const ctl = new Map();            // key -> { set(value), touched, seen }
  let total = 0;
  const status = document.createElement('span');
  status.className = 'set-status';

  function write(item, v) {
    const c = ctl.get(keyOf(item.addr)); if (c) c.touched = performance.now();
    if (!MIDIManager.isConnected()) { status.textContent = 'Not connected - nothing sent'; return; }
    MIDIManager.send(SEQTRAK.buildParam(item.addr, v));
  }

  function row(item) {
    const r = document.createElement('div'); r.className = 'set-row unread';
    const l = document.createElement('div'); l.className = 'set-label';
    l.innerHTML = '<span>' + item.label + '</span>' + (item.hint ? '<small>' + item.hint + '</small>' : '');
    const c = document.createElement('div'); c.className = 'set-ctl';
    r.appendChild(l); r.appendChild(c);
    let set;
    if (item.type === 'toggle') {
      const b = document.createElement('button'); b.className = 'op-toggle'; let on = false;
      b.onclick = () => { on = !on; b.classList.toggle('on', on); write(item, on ? 1 : 0); };
      set = v => { on = !!v; b.classList.toggle('on', on); };
      c.appendChild(b);
    } else if (item.type === 'choice') {
      const base = item.base || 0, btns = [];
      item.names.forEach((n, i) => {
        const b = document.createElement('button'); b.className = 'set-opt'; b.textContent = n;
        b.onclick = () => { btns.forEach(x => x.classList.toggle('active', x === b)); write(item, i + base); };
        btns.push(b); c.appendChild(b);
      });
      set = v => btns.forEach((x, i) => x.classList.toggle('active', i + base === v));
    } else {
      const inp = document.createElement('input'); inp.type = 'range'; inp.min = item.min; inp.max = item.max; inp.className = 'set-range';
      const out = document.createElement('span'); out.className = 'set-val';
      const show = v => { out.textContent = item.show ? item.show(v) : String(v); };
      inp.oninput = () => { show(+inp.value); write(item, +inp.value); };
      set = v => { inp.value = v; show(v); };
      c.appendChild(inp); c.appendChild(out); out.textContent = '-';
    }
    ctl.set(keyOf(item.addr), { set, touched: 0, seen: false, row: r });
    total++;
    return r;
  }

  // ---- build the page ----
  const head = document.createElement('div'); head.className = 'set-head';
  const title = document.createElement('span'); title.className = 'set-title'; title.textContent = 'SEQTRAK SETTINGS';
  const rd = document.createElement('button'); rd.className = 'btn btn-dim'; rd.textContent = 'READ FROM UNIT';
  head.appendChild(title); head.appendChild(status); head.appendChild(rd);
  page.appendChild(head);
  const grid = document.createElement('div'); grid.className = 'set-grid';
  GROUPS.forEach(g => {
    const p = document.createElement('div'); p.className = 'section-panel set-panel';
    p.innerHTML = '<div class="section-title" style="color:' + g.color + '"><span class="dot" style="background:' + g.color + '"></span>' + g.title + '</div>';
    g.items.forEach(it => p.appendChild(row(it)));
    grid.appendChild(p);
  });
  page.appendChild(grid);
  const foot = document.createElement('p'); foot.className = 'set-foot';
  foot.textContent = 'Changes go to the unit as you make them and stay there. Greyed rows have not been read from the unit yet. USB / Bluetooth on-off, USB role and Wi-Fi are left out so this app cannot cut itself off.';
  page.appendChild(foot);

  // ---- read: paced Parameter Requests ----
  let timer = null;
  function paint() {
    let seen = 0; ctl.forEach(c => { if (c.seen) seen++; });
    status.textContent = MIDIManager.isConnected() ? seen + ' of ' + total + ' read' : 'Not connected';
  }
  function readAll() {
    if (timer) return;
    if (!MIDIManager.isConnected()) { paint(); return; }
    const q = []; GROUPS.forEach(g => g.items.forEach(it => q.push(it.addr)));
    timer = setInterval(() => {
      q.splice(0, 4).forEach(a => MIDIManager.send(SEQTRAK.buildRequest(a)));
      if (!q.length) { clearInterval(timer); timer = null; setTimeout(paint, 400); }
    }, 60);
  }
  rd.onclick = readAll;
  const tab = document.querySelector('.tab[data-page="set"]');
  if (tab) tab.addEventListener('click', readAll);

  // ---- incoming Parameter Change (called from app.js for every one) ----
  window.__fbSettingsIn = pc => {
    if (pc.addr[0] !== 0x00 || pc.addr[1] !== 0x00 || !pc.data.length) return;
    const c = ctl.get(pc.key); if (!c) return;
    c.seen = true; c.row.classList.remove('unread');
    if (performance.now() - c.touched > 700) c.set(pc.data[0]);
    paint();
  };
  paint();
})();
