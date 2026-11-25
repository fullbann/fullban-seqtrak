/* ============================================
   FULLBAN SEQ-TRAK — Main App v4
   MIX (mixer + sound), DX (2 ops + common), sync from the unit
   ============================================ */

(async function () {
  'use strict';

  // ---- Page navigation ----
  const tabs = document.querySelectorAll('.tab');
  const pages = document.querySelectorAll('.page');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.page;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      pages.forEach(p => {
        const show = p.id === `page-${target}`;
        p.classList.toggle('hidden', !show);
      });
    });
  });

  // ---- Helpers ----
  function sendCC(ch, cc, val) { MIDIManager.sendCC(ch, cc, val); }

  function makeSection(title, color, content) {
    const panel = document.createElement('div');
    panel.className = 'section-panel';
    const hdr = document.createElement('div');
    hdr.className = 'section-title';
    hdr.style.color = color || 'var(--fb-blue)';
    hdr.innerHTML = `<span class="dot" style="background:${color || 'var(--fb-blue)'}"></span>${title}`;
    panel.appendChild(hdr);
    if (typeof content === 'string') panel.innerHTML += content;
    else if (content) panel.appendChild(content);
    return panel;
  }

  function knobCC(label, ch, cc, def, color) {
    return { label, min: 0, max: 127, def: def || 0, cc, ch, color };
  }

  function onKnobCC(value, opts) {
    if (opts.cc !== undefined && opts.ch !== undefined) {
      sendCC(opts.ch, opts.cc, value);
    }
  }

  // ---- MIDI connection UI ----
  const midiBtn = document.getElementById('midi-btn');
  const midiOverlay = document.getElementById('midi-overlay');
  const midiDevicesEl = document.getElementById('midi-devices');
  const midiStatusText = document.getElementById('midi-status-text');

  midiBtn.addEventListener('click', () => {
    midiOverlay.classList.toggle('hidden');
    if (!midiOverlay.classList.contains('hidden')) scanDevices();
  });
  document.getElementById('midi-close').addEventListener('click', () => midiOverlay.classList.add('hidden'));
  document.getElementById('midi-scan').addEventListener('click', scanDevices);
  // Parameter Request for tempo (30 40 76) - verified in seqtrak-docs 02-sysex-format
  let tempoWait = null;
  document.getElementById('midi-tempo').addEventListener('click', () => {
    if (!MIDIManager.isConnected()) { midiStatusText.textContent = 'Not connected - tap a device first'; return; }
    midiStatusText.style.color = '';
    midiStatusText.textContent = 'Asking SEQTRAK for its tempo...';
    MIDIManager.send(new Uint8Array([0xF0,0x43,0x30,0x7F,0x1C,0x0C,0x30,0x40,0x76,0xF7]));
    clearTimeout(tempoWait);
    tempoWait = setTimeout(() => { midiStatusText.textContent = 'NO REPLY - messages from the app are not reaching the SEQTRAK'; midiStatusText.style.color = '#e04040'; }, 1500);
  });
  window.__fbTempoReply = (bpm) => {
    clearTimeout(tempoWait);
    midiStatusText.textContent = 'SEQTRAK replied: tempo ' + bpm + ' BPM - sending works!';
    midiStatusText.style.color = '#40c060';
  };
  setInterval(() => { const el = document.getElementById('midi-diag'); if (el) el.textContent = MIDIManager.diag(); }, 300);
  document.getElementById('midi-test').addEventListener('click', () => {
    if (!MIDIManager.isConnected()) { midiStatusText.textContent = 'Not connected - tap a device first'; return; }
    // C4 on SYNTH 1 (ch 8) for half a second
    // Sweep: C4 on channels 1..16, one every 700 ms, so you can hear which one plays
    let c = 0;
    const step = () => {
      if (c > 15) { midiStatusText.textContent = 'Sweep done - which channel played?'; return; }
      const ch = c;
      midiStatusText.textContent = 'Playing channel ' + (ch + 1) + ' of 16';
      MIDIManager.send(new Uint8Array([0x90 | ch, 60, 115]));
      setTimeout(() => MIDIManager.send(new Uint8Array([0x80 | ch, 60, 0])), 450);
      c++; setTimeout(step, 700);
    };
    step();
  });

  function scanDevices() {
    midiDevicesEl.innerHTML = '';
    const devices = MIDIManager.getDevices();
    midiStatusText.textContent = `Found ${devices.outputs.length} out / ${devices.inputs.length} in`;
    midiStatusText.style.color = '';
    if (devices.outputs.length === 0) {
      midiStatusText.textContent = 'No MIDI devices found. Connect SEQTRAK and tap Scan.';
      return;
    }
    devices.outputs.forEach(out => {
      const matchIn = devices.inputs.find(i => i.name === out.name || i.name.includes('SEQTRAK'));
      const btn = document.createElement('button');
      btn.className = 'midi-device-btn';
      btn.textContent = out.name + (matchIn ? ' ✓' : ' (out only)');
      if (out.name.toLowerCase().includes('seqtrak')) btn.style.borderColor = 'var(--fb-blue)';
      btn.onclick = function() {
        try {
          const inDev = matchIn || devices.inputs[0];
          MIDIManager.connect(
            inDev ? { id: inDev.id, name: inDev.name, port: inDev.port } : null,
            { id: out.id, name: out.name, port: out.port }
          );
          midiStatusText.textContent = 'Connected to ' + out.name + '!';
          midiStatusText.style.color = '#40c060';
          updateMidiStatus(true, out.name);
        } catch(e) {
          midiStatusText.textContent = 'Error: ' + e.message;
          midiStatusText.style.color = '#e04040';
        }
      };
      midiDevicesEl.appendChild(btn);
    });
  }

  function updateMidiStatus(connected, name) {
    midiBtn.classList.toggle('connected', connected);
    midiBtn.classList.toggle('disconnected', !connected);
    midiBtn.querySelector('.midi-label').textContent = connected ? (name || 'MIDI') : 'MIDI';
  }

  // ======================================================
  // SYNC REGISTRY — every control registers under its parameter key so
  // values coming back from the SEQTRAK move the right knob/fader.
  // ======================================================
  const soundNames = new Array(11).fill('');   // current sound name per part, read from the unit
  // ---- what each track is: type read from the unit (01 1p 3C), drum parts can be re-typed to SYNTH ----
  const trackType = SEQTRAK.TRACKS.map((t, p) => SEQTRAK.DEFAULT_TYPE(p));
  const groupOf = p => ({ 1: 'drum', 3: 'drum', 2: 'synth', 4: 'dx', 5: 'sampler' })[trackType[p]] || 'drum';
  const typeName = p => SEQTRAK.TYPE_NAMES[trackType[p]] || 'TRACK';
  const usesRoll = p => trackType[p] === 2 || p >= 7;          // event list (chords OK) vs drum step grid
  function typeIndex(p) { let n = 0; for (let i = 0; i <= p; i++) if (trackType[i] === trackType[p]) n++; return n; }
  function trackTitle(p) {                                         // e.g. 'SYNTH 3' (3rd synth-type track)
    const t = trackType[p], many = trackType.filter(x => x === t).length > 1;
    return typeName(p) + (many ? ' ' + typeIndex(p) : '');
  }
  function trackShort(p) {                                         // e.g. '3 SYN'
    const s = { 1: 'DRM', 2: 'SYN', 3: 'KIT', 4: 'DX', 5: 'SMP' }[trackType[p]] || 'TRK';
    return (p + 1) + ' ' + s;
  }
  const trackListeners = [];
  const onTracks = fn => trackListeners.push(fn);
  function tracksChanged() { trackListeners.forEach(fn => { try { fn(); } catch (e) { console.warn(e); } }); }
  function setTrackType(p, t) {
    if (!SEQTRAK.TYPE_NAMES[t] || trackType[p] === t) return;
    trackType[p] = t; tracksChanged();
  }
  const REG = new Map();              // key -> Set of widgets
  function reg(def, w) {
    const keys = [SEQTRAK.keyOf(def)];
    if (def.kind === 'sx' && def.cc !== undefined) keys.push(`cc:${def.addr[1] & 0x0F}:${def.cc}`);
    (def.rx || []).forEach(k => keys.push(k));
    keys.forEach(k => { if (!REG.has(k)) REG.set(k, new Set()); REG.get(k).add(w); });
    w._keys = keys;
    return w;
  }
  function unreg(container) {
    container.querySelectorAll('.knob-wrap, .fb-fader').forEach(w => (w._keys || []).forEach(k => REG.get(k) && REG.get(k).delete(w)));
  }
  function applyIncoming(key, value) {
    const set = REG.get(key);
    if (!set) return false;
    set.forEach(w => { if (document.body.contains(w)) w.setValue(value); });
    return true;
  }
  function sendDef(def, v) { SEQTRAK.messagesFor(def, v).forEach(m => MIDIManager.send(m)); }

  // knob bound to a parameter definition
  function pk(def, color, extra) {
    const k = Knob.create(Object.assign({}, def, { color: color || def.color, onChange: v => sendDef(def, v) }, extra || {}));
    return reg(def, k);
  }
  function krow(defs, color, extra) {
    const row = document.createElement('div');
    row.className = 'knob-row';
    defs.forEach(d => row.appendChild(pk(d, color, extra)));
    return row;
  }

  // ---- Parameter Requests, paced so the unit isn't flooded ----
  const reqQueue = [];
  let reqTimer = null;
  function requestDefs(defs) {
    defs.forEach(d => { if (d && d.kind === 'sx') reqQueue.push(d.addr); });
    if (!reqTimer) reqTimer = setInterval(() => {
      if (!MIDIManager.isConnected()) return;
      const batch = reqQueue.splice(0, 6);
      batch.forEach(a => MIDIManager.send(SEQTRAK.buildRequest(a)));
      if (!reqQueue.length) { clearInterval(reqTimer); reqTimer = null; }
    }, 35);
  }
  function defsIn(container) {
    const out = [];
    container.querySelectorAll('.knob-wrap, .fb-fader').forEach(w => { if (w.opts && w.opts.kind === 'sx') out.push(w.opts); });
    return out;
  }

  // ---- Hardware-style vertical fader ----
  function Fader(def, color, onChange) {
    const min = def.min ?? 0, max = def.max ?? 127;
    let value = def.def ?? 100;
    const w = document.createElement('div');
    w.className = 'fb-fader';
    w.style.setProperty('--kc', color);
    w.innerHTML = '<div class="fb-fader-scale"></div><div class="fb-fader-groove"><div class="fb-fader-fill"></div></div><div class="fb-fader-cap"><span></span></div>';
    const fill = w.querySelector('.fb-fader-fill'), cap = w.querySelector('.fb-fader-cap');
    const draw = () => {
      const f = (value - min) / (max - min);
      fill.style.height = (f * 100) + '%';
      cap.style.bottom = `calc(${f * 100}% - ${f * 30}px)`;
      if (w.onDraw) w.onDraw(value);
    };
    const set = (v, user) => {
      v = Math.round(Math.min(max, Math.max(min, v)));
      if (v === value) return;
      value = v; draw();
      if (user && onChange) onChange(value);
    };
    let drag = null;
    w.addEventListener('pointerdown', e => {
      const r = w.getBoundingClientRect();
      const onCap = e.target.closest('.fb-fader-cap');
      if (!onCap) set(min + (1 - (e.clientY - r.top - 15) / (r.height - 30)) * (max - min), true);
      drag = { y: e.clientY, v: value, h: r.height - 30 };
      w.setPointerCapture(e.pointerId); w.classList.add('active'); e.preventDefault();
    });
    w.addEventListener('pointermove', e => {
      if (!drag) return;
      const scale = e.shiftKey ? 0.25 : 1;
      set(drag.v + (drag.y - e.clientY) / drag.h * (max - min) * scale, true);
    });
    const end = () => { drag = null; w.classList.remove('active'); };
    w.addEventListener('pointerup', end); w.addEventListener('pointercancel', end);
    w.addEventListener('dblclick', () => set(def.def ?? 100, true));
    w.addEventListener('wheel', e => { e.preventDefault(); set(value + (e.deltaY < 0 ? 2 : -2), true); }, { passive: false });
    w.setValue = v => { set(v, false); w.classList.remove('synced'); void w.offsetWidth; w.classList.add('synced'); };
    w.getValue = () => value;
    w.opts = def;
    requestAnimationFrame(draw);
    draw();
    return w;
  }

  // ======================================================
  // MIX PAGE — strips on the left, selected track's sound on the right
  // ======================================================
  const stripsEl = document.getElementById('mix-strips');
  const sndHead = document.getElementById('snd-head');
  const sndGrid = document.getElementById('snd-grid');
  let selTrack = 7;
  let soloTrack = -1;

  SEQTRAK.TRACKS.forEach((tk, p) => {
    const s = document.createElement('div');
    s.className = 'strip' + (p === selTrack ? ' sel' : '');
    s.dataset.track = p;
    s.style.setProperty('--kc', tk.color);
    s.innerHTML = `<button class="strip-name">${trackShort(p)}</button><div class="strip-snd" title=""></div>`;
    const pan = pk(SEQTRAK.P.pan(p), tk.color, { size: 'sm', label: 'PAN' });
    s.appendChild(pan);
    const volDef = SEQTRAK.P.volume(p);
    const fader = reg(volDef, Fader(volDef, tk.color, v => sendDef(volDef, v)));
    const readout = document.createElement('div');
    readout.className = 'strip-val';
    fader.onDraw = v => { readout.textContent = v; };
    s.appendChild(fader);
    s.appendChild(readout);
    const btns = document.createElement('div');
    btns.className = 'strip-btns';
    const mute = document.createElement('button'); mute.className = 'strip-m'; mute.textContent = 'M';
    const solo = document.createElement('button'); solo.className = 'strip-s'; solo.textContent = 'S';
    mute.addEventListener('click', e => { e.stopPropagation(); mute.classList.toggle('on'); MIDIManager.sendCC(p, 23, mute.classList.contains('on') ? 127 : 0); });
    solo.addEventListener('click', e => {
      e.stopPropagation();
      soloTrack = soloTrack === p ? -1 : p;
      stripsEl.querySelectorAll('.strip-s').forEach((b, i) => b.classList.toggle('on', i === soloTrack));
      MIDIManager.sendCC(p, 24, soloTrack < 0 ? 0 : soloTrack + 1);       // CC24: 0 off / 1-11 track
    });
    btns.append(mute, solo);
    s.appendChild(btns);
    s.querySelector('.strip-name').addEventListener('click', () => selectTrack(p));
    stripsEl.appendChild(s);
  });

  // master strip (speaker master volume 00 00 00)
  {
    const s = document.createElement('div');
    s.className = 'strip strip-master';
    s.style.setProperty('--kc', '#ffffff');
    s.innerHTML = `<div class="strip-name">MAIN</div><div class="strip-snd"></div><div class="strip-spacer"></div>`;
    const def = SEQTRAK.MASTER_VOLUME;
    const f = reg(def, Fader(def, '#cfe3ff', v => sendDef(def, v)));
    const ro = document.createElement('div'); ro.className = 'strip-val';
    f.onDraw = v => { ro.textContent = v; };
    s.append(f, ro);
    const sp = document.createElement('div'); sp.className = 'strip-btns'; s.appendChild(sp);
    stripsEl.appendChild(s);
  }

  function section(title, color, body, cls) {
    const p = document.createElement('div');
    p.className = 'snd-sec' + (cls ? ' ' + cls : '');
    p.style.setProperty('--kc', color);
    p.innerHTML = `<div class="snd-sec-title"><span class="dot"></span>${title}</div>`;
    p.appendChild(body);
    return p;
  }

  function selectTrack(p) {
    selTrack = p;
    stripsEl.querySelectorAll('.strip').forEach(s => s.classList.toggle('sel', +s.dataset.track === p));
    buildSound(p);
  }

  function buildSound(p) {
    unreg(sndGrid);
    sndGrid.innerHTML = '';
    const tk = SEQTRAK.TRACKS[p], c = tk.color, P = SEQTRAK.P;
    const grp = groupOf(p);
    const groupName = { drum: trackType[p] === 3 ? 'DRUM KIT' : 'DRUM', synth: 'AWM2 SYNTH', dx: 'DX · FM', sampler: 'SAMPLER' }[grp];
    sndHead.style.setProperty('--kc', c);
    sndHead.innerHTML = `<div class="snd-head-name">${trackTitle(p)}</div><div class="snd-head-info"><div class="snd-head-sound" id="snd-head-sound">${soundNames[p] || '—'}</div><div class="snd-head-sub">TRACK ${p + 1} · CH ${p + 1} · ${groupName}</div></div>`;
    if (presetEngine(p)) {
      const nav = document.createElement('div');
      nav.className = 'snd-head-nav';
      nav.innerHTML = '<button class="snd-nav-btn" data-d="-1">◀</button><button class="snd-nav-btn snd-browse-btn">BROWSE</button><button class="snd-nav-btn" data-d="1">▶</button>';
      nav.querySelectorAll('[data-d]').forEach(b => b.onclick = () => stepPreset(p, +b.dataset.d));
      nav.querySelector('.snd-browse-btn').onclick = () => openBrowser(p);
      sndHead.appendChild(nav);
    }
    if (grp === 'dx') {
      const go = document.createElement('button');
      go.className = 'snd-head-go'; go.textContent = 'OPEN DX EDITOR ▸';
      go.onclick = () => document.querySelector('.tab[data-page="dx"]').click();
      sndHead.appendChild(go);
    }
    const add = (t, defs, cls) => sndGrid.appendChild(section(t, c, krow(defs, c), cls));

    if (grp === 'drum') {
      add('PITCH', [P.drumPitch(p), P.velDepth(p)]);
      add('FILTER', [P.cutoff(p), P.reso(p), P.fegDepth(p)]);
      add('AMP', [P.ampAttack(p), P.ampDecRel(p), P.aegS(p)]);
      add('EQ', [P.eqLow(p), P.eqHigh(p)]);
      add('SENDS', [P.reverb(p), P.delay(p)]);
    } else if (grp === 'synth') {
      add('FILTER', [P.cutoff(p), P.reso(p), P.fegDepth(p)]);
      add('AMP', [P.ampAttack(p), P.ampDecRel(p), P.aegS(p), P.aegR(p)]);
      add('FILTER ENVELOPE', [P.fegA(p), P.fegD(p), P.fegS(p), P.fegR(p)], 'wide');
      add('PLAY', [P.monoPoly(p), P.portaTime(p), P.noteShift(p)]);
      add('ARP', [P.arpType(p), P.arpGate(p)]);
      add('EQ', [P.eqLow(p), P.eqHigh(p)]);
      add('SENDS', [P.reverb(p), P.delay(p)]);
    } else if (grp === 'dx') {
      add('FM', [P.fmAlgoCC(p), P.fmModCC(p), P.fmFreqCC(p), P.fmFbCC(p)], 'wide');
      add('CARRIER', [P.fmAttack(p), P.fmDecay(p), P.fmRelease(p)]);
      add('PLAY', [P.monoPoly(p), P.noteShift(p)]);
      add('ARP', [P.arpType(p), P.arpGate(p)]);
      add('EQ', [P.eqLow(p), P.eqHigh(p)]);
      add('SENDS', [P.reverb(p), P.delay(p)]);
    } else {
      add('FILTER', [P.cutoff(p), P.reso(p)]);
      add('AMP', [P.ampAttack(p), P.ampDecRel(p), P.aegS(p), P.aegR(p)]);
      add('PLAY', [P.noteShift(p), P.velDepth(p)]);
      add('EQ', [P.eqLow(p), P.eqHigh(p)]);
      add('SENDS', [P.reverb(p), P.delay(p)]);
    }
    requestDefs(defsIn(sndGrid));
  }
  // ---- Factory preset browser (2,424 presets; Drum/Synth/DX here) ----
  const presetEngine = p => ({ drum: 'Drum', synth: 'Synth', dx: 'DX' })[groupOf(p)] || null;
  const curPreset = new Array(11).fill(0);          // last preset number loaded from the app, per part
  const browserEl = document.getElementById('preset-browser');
  let brPart = 7, brCat = -1, brQuery = '';
  function loadPreset(p, n) {
    const E = PRESETS[presetEngine(p)];
    const k = n - E.first;
    if (k < 0 || k >= E.list.length) return;
    curPreset[p] = n;
    SEQTRAK.loadSound(p, 63, (n - 1) >> 7, (n - 1) & 127).forEach(m => MIDIManager.send(m));
    const want = E.list[k][0];
    setSoundName(p, want);
    // read back what the unit actually loaded (bank size of 128 is documented but not measured)
    setTimeout(async () => {
      const got = await fetchName(p);
      if (got && got.toLowerCase() !== want.toLowerCase()) {
        const el = document.getElementById('snd-head-sound');
        if (el && p === selTrack) el.textContent = got + '  (asked for ' + want + ')';
      }
      if (p === selTrack) requestDefs(defsIn(sndGrid));
    }, 300);
  }
  function stepPreset(p, d) {
    const E = PRESETS[presetEngine(p)];
    let n = curPreset[p];
    if (!n) { const k = E.list.findIndex(x => x[0].toLowerCase() === (soundNames[p] || '').toLowerCase()); n = k >= 0 ? E.first + k : E.first - d; }
    n += d;
    if (n < E.first) n = E.first + E.list.length - 1;
    if (n >= E.first + E.list.length) n = E.first;
    loadPreset(p, n);
  }
  function openBrowser(p) {
    brPart = p; brCat = -1; brQuery = '';
    browserEl.classList.remove('hidden');
    renderBrowser();
    const q = browserEl.querySelector('.br-search'); q.value = ''; 
  }
  function renderBrowser() {
    const eng = presetEngine(brPart), E = PRESETS[eng], tk = SEQTRAK.TRACKS[brPart];
    browserEl.style.setProperty('--kc', tk.color);
    browserEl.querySelector('.br-title').textContent = `${trackTitle(brPart)} · ${eng.toUpperCase()} PRESETS`;
    const cats = browserEl.querySelector('.br-cats');
    cats.innerHTML = '';
    ['ALL', ...E.cats].forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'br-cat' + ((i - 1) === brCat ? ' on' : '');
      const n = i === 0 ? E.list.length : E.list.filter(x => x[1] === i - 1).length;
      b.innerHTML = `${c.toUpperCase()}<span>${n}</span>`;
      b.onclick = () => { brCat = i - 1; renderBrowser(); };
      cats.appendChild(b);
    });
    const list = browserEl.querySelector('.br-list');
    list.innerHTML = '';
    const q = brQuery.toLowerCase();
    let shown = 0;
    E.list.forEach((x, k) => {
      if (brCat >= 0 && x[1] !== brCat) return;
      if (q && !x[0].toLowerCase().includes(q)) return;
      if (shown++ > 600) return;
      const n = E.first + k;
      const b = document.createElement('button');
      b.className = 'br-item' + (n === curPreset[brPart] ? ' on' : '');
      b.innerHTML = `<span class="br-num">${n}</span><span class="br-name">${x[0]}</span><span class="br-c">${E.cats[x[1]]}</span>`;
      b.onclick = () => { loadPreset(brPart, n); list.querySelectorAll('.br-item').forEach(e => e.classList.remove('on')); b.classList.add('on'); };
      list.appendChild(b);
    });
    browserEl.querySelector('.br-count').textContent = shown > 601 ? `${shown} sounds (first 600 shown - search to narrow)` : `${shown} sounds`;
  }
  browserEl.querySelector('.br-search').addEventListener('input', e => { brQuery = e.target.value; renderBrowser(); });
  browserEl.querySelector('.br-close').onclick = () => browserEl.classList.add('hidden');

  buildSound(selTrack);

  // ======================================================
  // DX PAGE — two operators on the left (1·2 / 3·4), common on the right
  // ======================================================
  const DX = SEQTRAK.DX_COMMON, OP = SEQTRAK.DX_OP;
  const dxOps = document.getElementById('dx-ops');
  const dxRight = document.getElementById('dx-right');
  const OPC = ['#40c8e0', '#2d8cf0', '#9060e0', '#e060c0'];

  // envelope picture: DX EG goes L4 -> L1 (R1) -> L2 (R2) -> L3 (R3) ... key off -> L4 (R4)
  function egGraph(color, bipolar) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 60');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('eg-graph');
    svg.innerHTML = `<path class="eg-fill" fill="${color}" fill-opacity=".12"/><path class="eg-line" stroke="${color}" fill="none" stroke-width="1.6"/>` +
      (bipolar ? '<line x1="0" y1="30" x2="200" y2="30" stroke="#ffffff22" stroke-dasharray="3 3"/>' : '');
    svg.update = (R, L, lmin, lmax) => {
      const y = l => 56 - (l - lmin) / (lmax - lmin) * 52;
      const t = r => 6 + (127 - r) / 127 * 40;
      let x = 2;
      const pts = [[x, y(L[3])]];
      for (let i = 0; i < 3; i++) { x += t(R[i]); pts.push([x, y(L[i])]); }
      x += 30; pts.push([x, y(L[2])]);
      x += t(R[3]); pts.push([Math.min(x, 198), y(L[3])]);
      const d = 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L');
      svg.querySelector('.eg-line').setAttribute('d', d);
      svg.querySelector('.eg-fill').setAttribute('d', d + `L${pts[pts.length - 1][0].toFixed(1)} 58L2 58Z`);
    };
    return svg;
  }
  function egBlock(rDefs, lDefs, color, bipolar, lmin, lmax) {
    const box = document.createElement('div');
    box.className = 'eg-block';
    const g = egGraph(color, bipolar);
    box.appendChild(g);
    const knobs = [];
    const redraw = () => g.update(knobs.slice(0, 4).map(k => k.getValue()), knobs.slice(4).map(k => k.getValue()), lmin, lmax);
    const row = document.createElement('div');
    row.className = 'knob-row eg-row';
    [...rDefs, ...lDefs].forEach(d => {
      const k = Knob.create(Object.assign({}, d, { size: 'sm', color, onChange: v => { sendDef(d, v); redraw(); } }));
      const sv = k.setValue; k.setValue = v => { sv(v); redraw(); };
      reg(d, k); knobs.push(k); row.appendChild(k);
    });
    box.appendChild(row);
    redraw();
    return box;
  }

  function opColumn(o) {
    const c = OPC[o];
    const col = document.createElement('div');
    col.className = 'dx-op';
    col.dataset.op = o;
    col.style.setProperty('--kc', c);

    const head = document.createElement('div');
    head.className = 'dx-op-head';
    head.innerHTML = `<span class="dx-op-num">OP ${o + 1}</span>`;
    const onDef = OP.onOff(o);
    const onT = Knob.toggle('ON', true, v => sendDef(onDef, v ? 1 : 0));
    onT.setValue = v => onT.setOn(v); onT.opts = onDef; onT.classList.add('knob-wrap'); reg(onDef, onT);
    const modeDef = OP.freqMode(o);
    const mode = Knob.segment(['RATIO', 'FIXED'], 0, i => sendDef(modeDef, i));
    mode.setValue = v => mode.setIndex(v); mode.opts = modeDef; mode.classList.add('knob-wrap'); reg(modeDef, mode);
    head.append(onT, mode);
    col.appendChild(head);

    const main = document.createElement('div');
    main.className = 'dx-op-main';
    main.appendChild(pk(OP.level(o), c, { size: 'lg' }));
    const freq = krow([OP.coarse(o), OP.fine(o), OP.detune(o)], c);
    main.appendChild(freq);
    col.appendChild(main);

    col.appendChild(section('ENVELOPE', c, egBlock(
      [OP.egR1(o), OP.egR2(o), OP.egR3(o), OP.egR4(o)],
      [OP.egL1(o), OP.egL2(o), OP.egL3(o), OP.egL4(o)], c, false, 0, 127)));
    col.appendChild(section('TONE', c, krow([OP.fbLevel(o), OP.fbType(o), OP.velSens(o), OP.amd(o)], c, { size: 'sm' })));
    col.appendChild(section('KEY SCALING', c, krow([OP.rateScl(o), OP.lvlSclL(o), OP.crvL(o), OP.lvlSclR(o), OP.crvR(o)], c, { size: 'sm' })));

    const tg = document.createElement('div');
    tg.className = 'dx-op-foot';
    const pmdDef = OP.pmdOn(o), pegDef = OP.pegOn(o);
    const pmdT = Knob.toggle('PITCH MOD', true, v => sendDef(pmdDef, v ? 1 : 0));
    const pegT = Knob.toggle('PITCH EG', true, v => sendDef(pegDef, v ? 1 : 0));
    [[pmdT, pmdDef], [pegT, pegDef]].forEach(([t, d]) => { t.setValue = v => t.setOn(v); t.opts = d; t.classList.add('knob-wrap'); reg(d, t); });
    tg.append(pmdT, pegT);
    col.appendChild(tg);
    return col;
  }

  for (let o = 0; o < 4; o++) dxOps.appendChild(opColumn(o));
  let opPair = 0;
  function showPair(i) {
    opPair = i;
    dxOps.querySelectorAll('.dx-op').forEach(c => c.classList.toggle('hidden', Math.floor(+c.dataset.op / 2) !== i));
  }
  document.getElementById('dx-op-switch').appendChild(Knob.segment(['OP 1 · 2', 'OP 3 · 4'], 0, showPair));
  showPair(0);

  // right side: algorithm, LFO, pitch EG, FM quick
  {
    const algoBox = document.createElement('div');
    algoBox.className = 'algo-grid';
    const algoDef = DX.algorithm;
    const big = document.createElement('div');
    big.className = 'algo-big';
    const btns = [];
    for (let a = 0; a < 12; a++) {
      const b = document.createElement('button');
      b.className = 'algo-btn'; b.textContent = a + 1;
      b.onclick = () => { setAlgo(a); sendDef(algoDef, a); };
      btns.push(b); algoBox.appendChild(b);
    }
    function setAlgo(a) { btns.forEach((b, i) => b.classList.toggle('active', i === a)); big.textContent = a + 1; }
    setAlgo(0);
    const algoW = document.createElement('div');
    algoW.className = 'algo-wrap knob-wrap';
    algoW.append(big, algoBox);
    algoW.setValue = setAlgo; algoW.opts = algoDef; reg(algoDef, algoW);
    dxRight.appendChild(section('ALGORITHM', '#9060e0', algoW, 'dx-sec'));

    const lfo = document.createElement('div');
    lfo.className = 'dx-lfo';
    const waveDef = DX.lfoWave;
    const wave = Knob.segment(SEQTRAK.LFO_WAVES, 0, i => sendDef(waveDef, i));
    wave.classList.add('knob-wrap', 'wave-seg'); wave.setValue = v => wave.setIndex(v); wave.opts = waveDef; reg(waveDef, wave);
    lfo.appendChild(wave);
    lfo.appendChild(krow([DX.lfoSpeed, DX.lfoDelay, DX.lfoPmd, DX.pbSens], '#40c8e0'));
    dxRight.appendChild(section('LFO · PITCH', '#40c8e0', lfo, 'dx-sec'));

    dxRight.appendChild(section('PITCH ENVELOPE', '#e0c040', egBlock(
      [DX.pegR1, DX.pegR2, DX.pegR3, DX.pegR4], [DX.pegL1, DX.pegL2, DX.pegL3, DX.pegL4], '#e0c040', true, 0x10, 0x70), 'dx-sec'));

    const P = SEQTRAK.P;
    const dxArt = document.createElement('div'); dxArt.className = 'dx-art';
    setTimeout(() => dxRight.appendChild(dxArt), 0);
    dxRight.appendChild(section('FM MACRO · TRACK 10', '#9040d0',
      krow([P.fmModCC(9), P.fmFreqCC(9), P.fmFbCC(9), P.fmAttack(9), P.fmDecay(9), P.fmRelease(9)], '#9040d0', { size: 'sm' }), 'dx-sec'));
  }

  // read the DX sound when the DX tab is opened
  document.querySelector('.tab[data-page="dx"]').addEventListener('click', () => requestDefs(defsIn(document.getElementById('page-dx'))));

  // ======================================================
  // REQUEST / REPLY + SOUND NAMES
  // ======================================================
  const waiters = new Map();          // sx key -> [resolve]
  function ask(addr, ms) {
    const key = 'sx:' + addr.map(b => b.toString(16).padStart(2, '0')).join('');
    return new Promise(res => {
      const list = waiters.get(key) || [];
      const done = d => { clearTimeout(t); res(d); };
      const t = setTimeout(() => { const l = waiters.get(key) || []; const i = l.indexOf(done); if (i >= 0) l.splice(i, 1); res(null); }, ms || 700);
      list.push(done); waiters.set(key, list);
      MIDIManager.send(SEQTRAK.buildRequest(addr));
    });
  }
  async function askRetry(addr, ms, tries) {
    for (let i = 0; i < (tries || 2); i++) { const d = await ask(addr, ms); if (d) return d; }
    return null;
  }
  async function fetchName(p) {
    const d = await askRetry(SEQTRAK.soundNameAddr(p), 700, 2);
    if (!d) return null;
    return setSoundName(p, SEQTRAK.decodeName(d));
  }
  function setSoundName(p, name) {
    soundNames[p] = name;
    document.querySelectorAll(`.track-chip[data-track="${p}"]`).forEach(c => { c.title = name; const sm = c.querySelector('small'); if (sm) sm.textContent = name; });
    const ln = document.querySelector(`.lr[data-track="${p}"] .lr-name small`); if (ln) ln.textContent = name || '—';
    const s = stripsEl.querySelector(`.strip[data-track="${p}"] .strip-snd`);
    if (s) { s.textContent = name; s.title = name; }
    if (p === selTrack) showSoundName();
    if (p === m1Target && typeof m1LoadedName !== 'undefined' && name) m1LoadedName.textContent = name;
    return name;
  }
  function showSoundName() {
    const el = document.getElementById('snd-head-sound');
    if (el) el.textContent = soundNames[selTrack] || '—';
  }
  // the unit changed sound on part p: read the new name and the new sound's knobs
  let pcTimers = {};
  function onSoundChanged(p) {
    clearTimeout(pcTimers[p]);
    pcTimers[p] = setTimeout(() => {
      fetchName(p);
      if (p === selTrack) requestDefs(defsIn(sndGrid));
      if (p === 9) requestDefs(defsIn(document.getElementById('page-dx')));
    }, 180);
  }

  // ======================================================
  // FX PAGE — send reverb, send delay, master effects, track effect
  // ======================================================
  const fxGrid = document.getElementById('fx-grid');
  const FXD = SEQTRAK.FX;
  const typeLabels = new Map();       // sx key of a TYPE address -> Set of elements
  function addTypeLabel(def, el) {
    const k = SEQTRAK.keyOf(def);
    if (!typeLabels.has(k)) typeLabels.set(k, new Set());
    typeLabels.get(k).add(el);
  }
  function setTypeName(key, name) { const set = typeLabels.get(key); if (set) set.forEach(el => { if (document.body.contains(el)) el.textContent = name; }); }
  function fxPanel(title, color, typeDef, onDef, knobs, note) {
    const body = document.createElement('div');
    body.className = 'fx-body';
    const top = document.createElement('div');
    top.className = 'fx-top';
    if (typeDef) {
      const t = document.createElement('div');
      t.className = 'fx-type'; t.textContent = '—';
      addTypeLabel(typeDef, t);
      top.appendChild(t);
    }
    if (onDef) {
      const tg = Knob.toggle('ON', true, v => sendDef(onDef, v ? 1 : 0));
      tg.setValue = v => tg.setOn(v); tg.opts = onDef; tg.classList.add('knob-wrap'); reg(onDef, tg);
      top.appendChild(tg);
    }
    body.appendChild(top);
    body.appendChild(krow(knobs, color));
    if (note) { const n = document.createElement('div'); n.className = 'fx-note'; n.textContent = note; body.appendChild(n); }
    return section(title, color, body, 'fx-sec');
  }
  const PARAM_NOTE = 'PARAM 1-3 are the effect\'s three FX knobs - what they do depends on the effect type.';
  fxGrid.appendChild(fxPanel('SEND REVERB', '#40c8e0', FXD.revType, FXD.revOn, [...FXD.revP, FXD.revReturn, FXD.revPan], PARAM_NOTE));
  fxGrid.appendChild(fxPanel('SEND DELAY', '#f08030', FXD.dlyType, FXD.dlyOn, [...FXD.dlyP, FXD.dlyReturn, FXD.dlyPan, FXD.dlyToRev]));
  [1, 2, 3].forEach(e => fxGrid.appendChild(fxPanel('MASTER FX ' + e, ['#9060e0', '#e060c0', '#e0c040'][e - 1], FXD.mType(e), FXD.mOn(e), FXD.mP(e))));

  // track effect + sends, for the track picked in the chips
  const fxTrackWrap = document.createElement('div');
  fxTrackWrap.className = 'fx-track';
  const fxChips = document.createElement('div');
  fxChips.className = 'track-chips';
  const fxTrackBody = document.createElement('div');
  let fxTrack = 7;
  function buildFxTrack() {
    unreg(fxTrackBody); fxTrackBody.innerHTML = '';
    const tk = SEQTRAK.TRACKS[fxTrack];
    fxTrackBody.appendChild(krow([...FXD.trackP(fxTrack), SEQTRAK.P.reverb(fxTrack), SEQTRAK.P.delay(fxTrack)], tk.color));
    fxChips.querySelectorAll('.track-chip').forEach((c, i) => {
      const on = i === fxTrack;
      c.classList.toggle('active', on); c.style.background = on ? SEQTRAK.TRACKS[i].color : ''; c.style.color = on ? '#fff' : '';
    });
  }
  SEQTRAK.TRACKS.forEach((tk, i) => {
    const c = document.createElement('button');
    c.className = 'track-chip'; c.dataset.track = i; c.textContent = trackShort(i); c.style.borderColor = tk.color;
    c.onclick = () => { fxTrack = i; buildFxTrack(); };
    fxChips.appendChild(c);
  });
  fxTrackWrap.append(fxChips, fxTrackBody);
  fxGrid.appendChild(section('TRACK FX + SENDS', '#2d8cf0', fxTrackWrap, 'fx-sec wide'));
  buildFxTrack();
  async function readFxTypes() {
    for (const key of typeLabels.keys()) {
      const addr = [0, 1, 2].map(i => parseInt(key.slice(3 + i * 2, 5 + i * 2), 16));
      const d = await askRetry(addr, 600, 2);
      if (d && d.length >= 2) setTypeName(key, SEQTRAK.fxTypeName(d[0], d[1]));
    }
  }
  document.querySelector('.tab[data-page="fx"]').addEventListener('click', () => {
    requestDefs(defsIn(document.getElementById('page-fx')));
    readFxTypes();
  });

  // ======================================================
  // SEQ PAGE — STEP / CHORDS / PIANO ROLL on one note engine
  // DRUM-type parts: step record (70). SYNTH-type parts (incl. re-typed drums), DX, SAMPLER:
  // piano roll event lists (72-75 or 22-25). Patterns: 30 5p 0F, lengths 30 5p 16+2n.
  // ======================================================
  const seqTrackChips = document.getElementById('seq-track-chips');
  const seqMsg = document.getElementById('seq-msg');
  const seqBody = document.getElementById('seq-body');
  let seqTrack = 0, seqLen = 16, playing = false, recOn = false, seqMode = 'step';
  const patSel = new Array(11).fill(0);
  const steps = Array.from({ length: 11 }, () => new Array(128).fill(null));   // drum parts: null unknown, false empty, {note,vel,gate}
  const rollEvents = Array.from({ length: 11 }, () => null);                  // roll parts: [{idx,time,note,vel,gate}]
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = n => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2);          // Yamaha: 60 = C3
  const isDrumPart = p => !usesRoll(p);
  const TPS = 120;                                                               // ticks per 16th step

  // ---- chips ----
  function buildSeqChips() {
    seqTrackChips.innerHTML = '';
    SEQTRAK.TRACKS.forEach((tk, i) => {
      const chip = document.createElement('button');
      chip.className = 'track-chip seq-chip' + (i === seqTrack ? ' active' : '');
      chip.dataset.track = i; chip.style.borderColor = tk.color;
      if (i === seqTrack) { chip.style.background = tk.color; chip.style.color = '#fff'; }
      chip.innerHTML = `<b>${trackShort(i)}</b><small>${soundNames[i] || ''}</small>`;
      chip.onclick = () => { seqTrack = i; buildSeqChips(); loadTrack(); };
      seqTrackChips.appendChild(chip);
    });
  }
  onTracks(buildSeqChips);

  // ---- note engine ----
  let busy = false;
  function setBusy(v, msg) { busy = v; seqBody.classList.toggle('busy', v); if (msg) seqMsg.textContent = msg; }
  async function readStep(p, s) {
    const d = await askRetry(SEQTRAK.STEP.readAddr(p, s), 450, 2);
    if (d === null) return;
    steps[p][s] = d.length >= 6 ? { note: d[0], vel: d[1], gate: (d[4] << 7) | d[5] } : false;
    paintStep(p, s);
  }
  async function readRoll(p) {
    const list = [];
    for (let idx = 0; idx < 1024; idx++) {
      const d = await askRetry(SEQTRAK.ROLL.readAddr(p, idx), 450, 3);
      if (d === null) return null;                      // lost replies: don't trust a partial list
      if (d.length < 8) break;                          // empty reply = end of the list
      list.push({ idx, time: (d[0] << 7) | d[1], type: d[2], note: d[3], vel: d[4], gate: (d[6] << 7) | d[7] });
    }
    rollEvents[p] = list.filter(e => e.type === 0);
    return list;
  }
  let readToken = 0;
  async function readSteps() {                           // (re)read the selected track from the unit
    if (!MIDIManager.isConnected()) { renderSeq(); return; }
    const tok = ++readToken, p = seqTrack;
    if (isDrumPart(p)) {
      renderSeq();
      for (let s = 0; s < seqLen; s++) { if (tok !== readToken) return; await readStep(p, s); }
    } else {
      setBusy(true, 'Reading the pattern from the SEQTRAK...');
      const ok = await readRoll(p);
      if (tok !== readToken) return;
      setBusy(false, ok ? '' : 'Some replies were lost - tap the track again to re-read.');
      renderSeq();
    }
  }
  // edits on roll tracks: delete (highest index first) + add, then re-read the list (indices shift)
  async function rollEdit(p, removeEvents, addNotes) {
    if (busy) return;
    setBusy(true, 'Writing to the SEQTRAK...');
    [...removeEvents].sort((x, y) => y.idx - x.idx).forEach(e => MIDIManager.send(SEQTRAK.ROLL.del(p, e.idx)));
    addNotes.forEach(n => MIDIManager.send(SEQTRAK.ROLL.addNote(p, Math.max(0, Math.round(n.time)), n.note, n.vel || 100, Math.max(1, Math.round(n.gate || TPS)))));
    await new Promise(r => setTimeout(r, 150 + 10 * (removeEvents.length + addNotes.length)));
    await readRoll(p);
    setBusy(false, '');
    renderSeq();
  }
  async function loadTrack() {
    const p = seqTrack;
    if (MIDIManager.isConnected()) {
      const ps = await askRetry(SEQTRAK.PATTERN_SELECT(p).addr, 450, 2);
      if (ps && ps.length) patSel[p] = ps[0];
      const ln = await askRetry(SEQTRAK.PATTERN_STEPS(p, patSel[p]), 450, 2);
      if (ln && ln.length >= 2) seqLen = Math.max(1, Math.min(128, (ln[0] << 7) | ln[1]));
    }
    document.querySelectorAll('.pattern-btn').forEach(b => b.classList.toggle('active', +b.dataset.pattern === patSel[p]));
    document.querySelectorAll('.len-btn').forEach(b => b.classList.toggle('active', +b.dataset.len === seqLen));
    readSteps();
  }

  // ---- mode tabs ----
  document.querySelectorAll('.seq-mode').forEach(b => b.addEventListener('click', () => {
    seqMode = b.dataset.mode;
    document.querySelectorAll('.seq-mode').forEach(x => x.classList.toggle('active', x === b));
    renderSeq();
  }));
  function renderSeq() {
    seqBody.innerHTML = '';
    seqBody.dataset.mode = seqMode;
    if (seqMode === 'step') renderStep();
    else if (seqMode === 'chords') renderChords();
    else renderRoll();
  }

  // ======================= STEP =======================
  let pickNote = 60;
  function renderStep() {
    const p = seqTrack, tk = SEQTRAK.TRACKS[p], drum = isDrumPart(p);
    if (!drum) seqBody.appendChild(notePicker());
    const n = Math.min(seqLen, 64), rows = Math.ceil(n / 16);
    for (let r = 0; r < rows; r++) {
      const row = document.createElement('div');
      row.className = 'step-row';
      for (let s = r * 16; s < Math.min(n, r * 16 + 16); s++) {
        const btn = document.createElement('button');
        btn.className = 'seq-step' + (s % 4 === 0 ? ' beat-start' : '');
        btn.dataset.step = s;
        btn.style.setProperty('--tk-color', tk.color);
        btn.innerHTML = `<i>${s + 1}</i><span></span>`;
        btn.onclick = () => toggleStep(s);
        row.appendChild(btn);
      }
      seqBody.appendChild(row);
    }
    for (let s = 0; s < n; s++) paintStep(p, s);
    if (!seqMsg.textContent || seqMsg.dataset.auto) {
      seqMsg.dataset.auto = 1;
      seqMsg.textContent = drum ? 'Tap a step to add or remove it on the SEQTRAK. Best done while stopped.'
        : 'Pick a note, then tap a step. Tap a filled step to clear it. Chords and lengths: use CHORDS or PIANO ROLL.';
    }
  }
  function stepContents(p, s) {
    if (isDrumPart(p)) return steps[p][s];
    const ev = rollEvents[p];
    if (!ev) return null;
    const here = ev.filter(e => Math.floor(e.time / TPS) === s);
    return here.length ? here : false;
  }
  function paintStep(p, s) {
    if (p !== seqTrack || seqMode !== 'step') return;
    const b = seqBody.querySelector(`.seq-step[data-step="${s}"]`);
    if (!b) return;
    const st = stepContents(p, s);
    b.classList.toggle('on', !!st); b.classList.toggle('unknown', st === null);
    b.querySelector('span').textContent = (!isDrumPart(p) && st) ? st.map(e => noteName(e.note)).join(' ') : '';
  }
  function toggleStep(s) {
    const p = seqTrack;
    if (isDrumPart(p)) {
      const st = steps[p][s];
      if (st) MIDIManager.send(SEQTRAK.STEP.del(p, s));
      else MIDIManager.send(SEQTRAK.STEP.add(p, s, 60, 100, TPS));
      steps[p][s] = st ? false : { note: 60, vel: 100, gate: TPS };
      paintStep(p, s);
      setTimeout(() => readStep(p, s), 250);
      return;
    }
    if (rollEvents[p] === null) return;
    const here = stepContents(p, s);
    if (here) rollEdit(p, here, []);
    else rollEdit(p, [], [{ time: s * TPS + 60, note: pickNote, vel: 100, gate: TPS }]);
  }
  function previewNotes(notes, ch, ms) {
    notes.forEach(n => MIDIManager.send(new Uint8Array([0x90 | ch, n & 0x7F, 100])));
    setTimeout(() => notes.forEach(n => MIDIManager.send(new Uint8Array([0x80 | ch, n & 0x7F, 0]))), ms || 350);
  }
  function notePicker() {
    const w = document.createElement('div');
    w.className = 'seq-notepick';
    const draw = () => {
      w.innerHTML = '';
      const oct = Math.floor(pickNote / 12);
      const mk = (txt, cls, fn) => { const b = document.createElement('button'); b.className = cls; b.textContent = txt; b.onclick = fn; w.appendChild(b); };
      mk('◀ OCT', 'np-oct', () => { pickNote = Math.max(0, pickNote - 12); draw(); });
      NOTE_NAMES.forEach((nm, i) => { const n = oct * 12 + i; mk(noteName(n), 'np-key' + (nm.includes('#') ? ' black' : '') + (n === pickNote ? ' on' : ''), () => { pickNote = n; draw(); previewNotes([n], seqTrack, 250); }); });
      mk('OCT ▶', 'np-oct', () => { pickNote = Math.min(127, pickNote + 12); draw(); });
    };
    draw();
    return w;
  }

  // ======================= CHORDS (Pad Perform / OXI style) =======================
  const SCALES = { 'Major': [0, 2, 4, 5, 7, 9, 11], 'Minor': [0, 2, 3, 5, 7, 8, 10], 'Dorian': [0, 2, 3, 5, 7, 9, 10], 'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
    'Phrygian': [0, 1, 3, 5, 7, 8, 10], 'Lydian': [0, 2, 4, 6, 7, 9, 11], 'Harm Minor': [0, 2, 3, 5, 7, 8, 11], 'Melodic Minor': [0, 2, 3, 5, 7, 9, 11] };
  const CHORD_TYPES = { 'TRIAD': [0, 2, 4], '7TH': [0, 2, 4, 6], '9TH': [0, 2, 4, 6, 8], 'SUS2': [0, 1, 4], 'SUS4': [0, 3, 4], '6TH': [0, 2, 4, 5], 'POWER': 'power' };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const cs = { key: 0, scale: 'Minor', type: '7TH', oct: 3, inv: 0, spread: false, len: 4, brush: null, genre: 'Piano House', prog: 0 };
  try { Object.assign(cs, JSON.parse(localStorage.getItem('fbChordSettings') || '{}'), { brush: null }); } catch (e) {}
  const saveCs = () => { try { const { brush, ...keep } = cs; localStorage.setItem('fbChordSettings', JSON.stringify(keep)); } catch (e) {} };

  function degreeChord(d) {
    const sc = SCALES[cs.scale] || SCALES.Major, base = 12 * (cs.oct + 2) + cs.key;
    const at = i => base + sc[i % 7] + 12 * Math.floor(i / 7);
    let notes = CHORD_TYPES[cs.type] === 'power' ? [at(d), at(d + 4), at(d) + 12] : CHORD_TYPES[cs.type].map(k => at(d + k));
    return voice(notes);
  }
  function voice(notes) {
    notes = [...notes].sort((a, b) => a - b);
    for (let i = 0; i < cs.inv; i++) { const lo = notes.shift(); notes.push(lo + 12); }
    if (cs.spread && notes.length >= 3) notes[1] += 12;
    return notes.sort((a, b) => a - b).filter(n => n >= 0 && n <= 127);
  }
  const QUAL = [[[0, 4, 7], ''], [[0, 3, 7], 'm'], [[0, 3, 6], 'dim'], [[0, 4, 8], 'aug'], [[0, 2, 7], 'sus2'], [[0, 5, 7], 'sus4'], [[0, 4, 7, 11], 'maj7'],
    [[0, 3, 7, 10], 'm7'], [[0, 4, 7, 10], '7'], [[0, 3, 6, 10], 'm7b5'], [[0, 4, 7, 9], '6'], [[0, 3, 7, 9], 'm6'], [[0, 4, 7, 11, 2], 'maj9'], [[0, 3, 7, 10, 2], 'm9'],
    [[0, 4, 7, 10, 2], '9'], [[0, 4, 7, 2], 'add9'], [[0, 3, 7, 2], 'madd9'], [[0, 4, 7, 11, 2, 9], 'maj13'], [[0, 3, 7, 10, 2, 5], 'm11'], [[0, 7], '5']];
  function chordName(notes) {
    const pcs = [...new Set(notes.map(n => n % 12))];
    const bass = Math.min(...notes) % 12;
    for (const root of [bass, ...pcs.filter(x => x !== bass)]) {
      const iv = pcs.map(x => (x - root + 12) % 12).sort((a, b) => a - b);
      for (const [q, nm] of QUAL) if (q.length === iv.length && [...q].sort((a, b) => a - b).every((v, i) => v === iv[i]))
        return NOTE_NAMES[root] + nm + (root !== bass ? '/' + NOTE_NAMES[bass] : '');
    }
    return notes.map(n => NOTE_NAMES[n % 12]).join('');
  }
  // chords already in the pattern: events grouped by start time
  function chordBlocks(p) {
    const ev = rollEvents[p] || [], byT = new Map();
    ev.forEach(e => { if (!byT.has(e.time)) byT.set(e.time, []); byT.get(e.time).push(e); });
    return [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, es]) => ({ time: t, step: Math.floor(t / TPS), len: Math.max(1, Math.round(Math.max(...es.map(e => e.gate)) / TPS)), events: es, name: chordName(es.map(e => e.note)) }));
  }
  function placeChord(step, notes, lenSteps) {
    const p = seqTrack;
    const end = step + lenSteps;
    const clash = (rollEvents[p] || []).filter(e => { const s = Math.floor(e.time / TPS); return s >= step && s < end; });
    rollEdit(p, clash, notes.map(n => ({ time: step * TPS + 60, note: n, vel: 100, gate: lenSteps * TPS - 10 })));
  }
  function renderChords() {
    const p = seqTrack, tk = SEQTRAK.TRACKS[p];
    if (!usesRoll(p)) {
      seqMsg.textContent = 'Chords need a SYNTH-type track (SYNTH 1/2, DX, SAMPLER, or a drum track re-typed to SYNTH).';
      return;
    }
    seqMsg.textContent = cs.brush ? `Brush: ${cs.brush.label} - tap the timeline to place it (${cs.len} steps). Tap a chord in the timeline to remove it.`
      : 'Tap a pad to hear a chord and pick it as the brush, then tap the timeline. Or PLACE a whole progression.';
    const wrap = document.createElement('div'); wrap.className = 'chd';
    // controls
    const ctl = document.createElement('div'); ctl.className = 'chd-ctl';
    const sel = (label, opts, val, fn) => {
      const l = document.createElement('label'); l.className = 'chd-sel'; l.innerHTML = `<span>${label}</span>`;
      const s = document.createElement('select'); opts.forEach(o => { const op = document.createElement('option'); op.value = o; op.textContent = o; if (String(o) === String(val)) op.selected = true; s.appendChild(op); });
      s.onchange = () => { fn(s.value); saveCs(); renderSeq(); }; l.appendChild(s); ctl.appendChild(l);
    };
    sel('KEY', NOTE_NAMES, NOTE_NAMES[cs.key], v => cs.key = NOTE_NAMES.indexOf(v));
    sel('SCALE', Object.keys(SCALES), cs.scale, v => cs.scale = v);
    sel('CHORD', Object.keys(CHORD_TYPES), cs.type, v => cs.type = v);
    sel('OCTAVE', [1, 2, 3, 4, 5], cs.oct, v => cs.oct = +v);
    sel('INVERSION', [0, 1, 2, 3], cs.inv, v => cs.inv = +v);
    sel('LENGTH', [1, 2, 4, 8, 16], cs.len, v => cs.len = +v);
    const sp = Knob.toggle('SPREAD', cs.spread, v => { cs.spread = v; saveCs(); renderSeq(); }); ctl.appendChild(sp);
    const clr = document.createElement('button'); clr.className = 'chd-clear'; clr.textContent = 'CLEAR PATTERN';
    clr.onclick = () => { if (confirm('Clear every note on this track\'s pattern?')) rollEdit(p, rollEvents[p] || [], []); };
    ctl.appendChild(clr);
    wrap.appendChild(ctl);
    // degree pads
    const pads = document.createElement('div'); pads.className = 'chd-pads';
    for (let d = 0; d < 7; d++) {
      const notes = degreeChord(d), nm = chordName(notes);
      const b = document.createElement('button');
      b.className = 'chd-pad' + (cs.brush && cs.brush.label === nm ? ' on' : '');
      b.style.setProperty('--kc', tk.color);
      b.innerHTML = `<i>${ROMAN[d]}</i><b>${nm}</b><small>${notes.map(noteName).join(' ')}</small>`;
      b.onclick = () => { previewNotes(notes, p, 600); cs.brush = { label: nm, notes }; renderSeq(); };
      pads.appendChild(b);
    }
    wrap.appendChild(pads);
    // progressions (Chris's Fullban set)
    const pr = document.createElement('div'); pr.className = 'chd-prog';
    const genres = [...new Set(PROGRESSIONS.map(x => x.g))];
    const list = PROGRESSIONS.filter(x => x.g === cs.genre);
    if (cs.prog >= list.length) cs.prog = 0;
    const gs = document.createElement('select'); genres.forEach(g => { const o = document.createElement('option'); o.textContent = g; if (g === cs.genre) o.selected = true; gs.appendChild(o); });
    gs.onchange = () => { cs.genre = gs.value; cs.prog = 0; saveCs(); renderSeq(); };
    const ps = document.createElement('select'); list.forEach((x, i) => { const o = document.createElement('option'); o.value = i; o.textContent = x.n.replace(/^Fullban [^-]*- /, '') + ` (${x.r} ${x.s})`; if (i === cs.prog) o.selected = true; ps.appendChild(o); });
    ps.onchange = () => { cs.prog = +ps.value; saveCs(); renderSeq(); };
    const prog = list[cs.prog];
    const octShift = n => n + 12 * (cs.oct - 1);              // his files are written low (recording octave 2)
    const place = document.createElement('button'); place.className = 'chd-place'; place.textContent = 'PLACE ▸';
    place.onclick = () => {
      if (!prog) return;
      const k = prog.c.length, span = Math.max(1, Math.floor(seqLen / k));
      const add = [];
      prog.c.forEach(([nm, notes], i) => voice(notes.map(octShift)).forEach(n => add.push({ time: i * span * TPS + 60, note: n, vel: 100, gate: span * TPS - 10 })));
      rollEdit(p, rollEvents[p] || [], add);
    };
    pr.innerHTML = '<span class="chd-lbl">PROGRESSION</span>';
    pr.append(gs, ps, place);
    const pchords = document.createElement('div'); pchords.className = 'chd-pchords';
    (prog ? prog.c : []).forEach(([nm, notes]) => {
      const v = voice(notes.map(octShift));
      const b = document.createElement('button'); b.className = 'chd-pc' + (cs.brush && cs.brush.label === nm ? ' on' : ''); b.textContent = nm;
      b.onclick = () => { previewNotes(v, p, 600); cs.brush = { label: nm, notes: v }; renderSeq(); };
      pchords.appendChild(b);
    });
    pr.appendChild(pchords);
    wrap.appendChild(pr);
    // timeline
    const tl = document.createElement('div'); tl.className = 'chd-tl';
    tl.style.gridTemplateColumns = `repeat(${seqLen}, 1fr)`;
    for (let s = 0; s < seqLen; s++) {
      const c = document.createElement('button'); c.className = 'chd-cell' + (s % 4 === 0 ? ' beat' : '');
      c.style.gridColumn = `${s + 1}`; c.textContent = s + 1;
      c.onclick = () => { if (cs.brush) placeChord(s, cs.brush.notes, Math.min(cs.len, seqLen - s)); };
      tl.appendChild(c);
    }
    chordBlocks(p).forEach(b => {
      if (b.step >= seqLen) return;
      const e = document.createElement('button'); e.className = 'chd-block';
      e.style.gridColumn = `${b.step + 1} / span ${Math.min(b.len, seqLen - b.step)}`;
      e.style.setProperty('--kc', tk.color);
      e.innerHTML = `<b>${b.name}</b><small>${b.events.map(x => noteName(x.note)).join(' ')}</small>`;
      e.onclick = () => rollEdit(p, b.events, []);
      tl.appendChild(e);
    });
    wrap.appendChild(tl);
    seqBody.appendChild(wrap);
  }

  // ======================= PIANO ROLL (MPC style) =======================
  const pr = { tool: 'draw', grid: 120, len: 120, lowest: 48, rows: 36, snap: true, sel: new Set(), vel: 100 };
  function inScale(n) { const sc = SCALES[cs.scale] || SCALES.Major; return sc.includes(((n - cs.key) % 12 + 12) % 12); }
  function snapPitch(n) { if (!pr.snap) return n; for (let d = 0; d < 12; d++) { if (inScale(n - d)) return n - d; if (inScale(n + d)) return n + d; } return n; }
  function renderRoll() {
    const p = seqTrack, tk = SEQTRAK.TRACKS[p];
    if (!usesRoll(p)) { seqMsg.textContent = 'The piano roll works on SYNTH-type tracks (SYNTH 1/2, DX, SAMPLER, or a drum track re-typed to SYNTH). Use STEP for drum tracks.'; return; }
    seqMsg.textContent = { draw: 'DRAW: tap to add a note, drag a note to move it, drag its right edge to change its length.', select: 'SELECT: tap notes to select, then transpose, quantize, set velocity or delete.', erase: 'ERASE: tap a note to delete it.' }[pr.tool];
    const evs = rollEvents[p] || [];
    const total = seqLen * TPS;
    const wrap = document.createElement('div'); wrap.className = 'pr';
    // toolbar
    const tb = document.createElement('div'); tb.className = 'pr-tb';
    const seg = (labels, idx, fn) => Knob.segment(labels, idx, fn);
    tb.appendChild(seg(['DRAW', 'SELECT', 'ERASE'], ['draw', 'select', 'erase'].indexOf(pr.tool), i => { pr.tool = ['draw', 'select', 'erase'][i]; renderSeq(); }));
    const grids = [[480, '1/4'], [240, '1/8'], [120, '1/16'], [60, '1/32']];
    const gl = document.createElement('span'); gl.className = 'pr-lbl'; gl.textContent = 'GRID'; tb.appendChild(gl);
    tb.appendChild(seg(grids.map(g => g[1]), grids.findIndex(g => g[0] === pr.grid), i => { pr.grid = grids[i][0]; renderSeq(); }));
    const lens = [[60, '1/32'], [120, '1/16'], [240, '1/8'], [480, '1/4'], [960, '1/2'], [1920, '1 BAR']];
    const ll = document.createElement('span'); ll.className = 'pr-lbl'; ll.textContent = 'LENGTH'; tb.appendChild(ll);
    tb.appendChild(seg(lens.map(g => g[1]), lens.findIndex(g => g[0] === pr.len), i => { pr.len = lens[i][0]; renderSeq(); }));
    const snapT = Knob.toggle(`SCALE ${NOTE_NAMES[cs.key]} ${cs.scale.toUpperCase()}`, pr.snap, v => { pr.snap = v; renderSeq(); }); tb.appendChild(snapT);
    const btn = (t, fn, cls) => { const b = document.createElement('button'); b.className = 'pr-btn' + (cls ? ' ' + cls : ''); b.textContent = t; b.onclick = fn; tb.appendChild(b); return b; };
    btn('▲ OCT', () => { pr.lowest = Math.min(127 - pr.rows, pr.lowest + 12); renderSeq(); });
    btn('▼ OCT', () => { pr.lowest = Math.max(0, pr.lowest - 12); renderSeq(); });
    const selEvs = () => evs.filter(e => pr.sel.has(e.idx));
    const moveSel = (dt, dn) => { const s = selEvs(); if (!s.length) return; pr.sel.clear(); rollEdit(p, s, s.map(e => ({ time: Math.min(total - 1, Math.max(0, e.time + dt)), note: Math.min(127, Math.max(0, e.note + dn)), vel: e.vel, gate: e.gate }))); };
    btn('-12', () => moveSel(0, -12)); btn('-1', () => moveSel(0, -1)); btn('+1', () => moveSel(0, 1)); btn('+12', () => moveSel(0, 12));
    btn('QUANTIZE', () => { const s = selEvs(); if (!s.length) return; pr.sel.clear(); rollEdit(p, s, s.map(e => ({ time: Math.round((e.time - 60) / pr.grid) * pr.grid + 60, note: e.note, vel: e.vel, gate: e.gate }))); });
    btn('ALL', () => { evs.forEach(e => pr.sel.add(e.idx)); renderSeq(); });
    btn('DELETE', () => { const s = selEvs(); pr.sel.clear(); if (s.length) rollEdit(p, s, []); }, 'danger');
    wrap.appendChild(tb);
    // grid
    const area = document.createElement('div'); area.className = 'pr-area';
    const keys = document.createElement('div'); keys.className = 'pr-keys';
    const grid = document.createElement('div'); grid.className = 'pr-grid';
    grid.style.setProperty('--steps', seqLen);
    const top = pr.lowest + pr.rows - 1;
    for (let n = top; n >= pr.lowest; n--) {
      const k = document.createElement('div'); const black = NOTE_NAMES[n % 12].includes('#');
      k.className = 'pr-key' + (black ? ' black' : '') + (n % 12 === 0 ? ' c' : '');
      k.textContent = n % 12 === 0 || !black ? noteName(n) : '';
      k.onclick = () => previewNotes([n], p, 300);
      keys.appendChild(k);
      const row = document.createElement('div');
      row.className = 'pr-row' + (black ? ' black' : '') + (inScale(n) ? ' scale' : '') + (n % 12 === cs.key ? ' root' : '');
      grid.appendChild(row);
    }
    const H = pr.rows;
    const pct = t => (t / total * 100) + '%';
    evs.forEach(e => {
      if (e.note < pr.lowest || e.note > top || e.time >= total) return;
      const d = document.createElement('div'); d.className = 'pr-note' + (pr.sel.has(e.idx) ? ' sel' : '');
      d.style.left = pct(e.time - 60 < 0 ? e.time : e.time - 60); d.style.width = `calc(${pct(Math.min(e.gate, total - e.time + 60))} - 2px)`;
      d.style.top = ((top - e.note) / H * 100) + '%'; d.style.height = (100 / H) + '%';
      d.style.setProperty('--kc', tk.color); d.style.opacity = 0.45 + 0.55 * e.vel / 127;
      d.innerHTML = '<span></span><em></em>';
      d.dataset.idx = e.idx;
      grid.appendChild(d);
    });
    // pointer handling on the grid
    const posOf = ev => { const r = grid.getBoundingClientRect(); return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height, r }; };
    let drag = null;
    grid.addEventListener('pointerdown', ev => {
      if (busy) return;
      const noteEl = ev.target.closest('.pr-note');
      const { x, y } = posOf(ev);
      if (noteEl) {
        const e = evs.find(z => z.idx === +noteEl.dataset.idx);
        if (pr.tool === 'erase') { rollEdit(p, [e], []); return; }
        if (pr.tool === 'select') { pr.sel.has(e.idx) ? pr.sel.delete(e.idx) : pr.sel.add(e.idx); noteEl.classList.toggle('sel'); return; }
        const edge = ev.target.tagName === 'EM';
        drag = { e, el: noteEl, edge, x0: x, y0: y, dt: 0, dn: 0, dg: 0 };
        grid.setPointerCapture(ev.pointerId);
        previewNotes([e.note], p, 200);
        return;
      }
      if (pr.tool !== 'draw') { pr.sel.clear(); renderSeq(); return; }
      const t = Math.floor(x * total / pr.grid) * pr.grid + 60;
      const n = snapPitch(top - Math.floor(y * H));
      previewNotes([n], p, 200);
      rollEdit(p, [], [{ time: Math.min(t, total - 1), note: n, vel: pr.vel, gate: pr.len - 10 }]);
    });
    grid.addEventListener('pointermove', ev => {
      if (!drag) return;
      const { x, y } = posOf(ev);
      if (drag.edge) {
        drag.dg = Math.round((x - drag.x0) * total / pr.grid) * pr.grid;
        drag.el.style.width = `calc(${pct(Math.max(pr.grid / 2, drag.e.gate + drag.dg))} - 2px)`;
      } else {
        drag.dt = Math.round((x - drag.x0) * total / pr.grid) * pr.grid;
        drag.dn = -Math.round((y - drag.y0) * H);
        drag.el.style.transform = `translate(${drag.dt / total * 100 * drag.el.parentElement.clientWidth / 100}px, ${-drag.dn * drag.el.parentElement.clientHeight / H}px)`;
      }
    });
    grid.addEventListener('pointerup', () => {
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.dt && !d.dn && !d.dg) return;
      const e = d.e;
      rollEdit(p, [e], [{ time: Math.min(total - 1, Math.max(0, e.time + d.dt)), note: snapPitch(Math.min(127, Math.max(0, e.note + d.dn))), vel: e.vel, gate: Math.max(pr.grid / 2, e.gate + d.dg) }]);
    });
    area.append(keys, grid);
    // beat ruler
    const ruler = document.createElement('div'); ruler.className = 'pr-ruler';
    ruler.style.gridTemplateColumns = `repeat(${seqLen}, 1fr)`;
    for (let s = 0; s < seqLen; s++) { const c = document.createElement('span'); c.textContent = s % 4 === 0 ? (s / 4 + 1) : ''; ruler.appendChild(c); }
    wrap.appendChild(ruler);
    wrap.appendChild(area);
    // velocity lane
    const vl = document.createElement('div'); vl.className = 'pr-vel';
    evs.forEach(e => {
      if (e.time >= total) return;
      const b = document.createElement('div'); b.className = 'pr-vbar' + (pr.sel.has(e.idx) ? ' sel' : '');
      b.style.left = pct(Math.max(0, e.time - 60)); b.style.height = (e.vel / 127 * 100) + '%';
      b.style.setProperty('--kc', tk.color);
      b.title = 'velocity ' + e.vel;
      let vd = null;
      b.addEventListener('pointerdown', ev => { vd = { r: vl.getBoundingClientRect() }; b.setPointerCapture(ev.pointerId); });
      b.addEventListener('pointermove', ev => { if (!vd) return; const v = Math.round(Math.min(127, Math.max(1, (1 - (ev.clientY - vd.r.top) / vd.r.height) * 127))); b.style.height = (v / 127 * 100) + '%'; vd.v = v; });
      b.addEventListener('pointerup', () => { if (vd && vd.v && vd.v !== e.vel) rollEdit(p, [e], [{ time: e.time, note: e.note, vel: vd.v, gate: e.gate }]); vd = null; });
      vl.appendChild(b);
    });
    const vlab = document.createElement('div'); vlab.className = 'pr-vlab'; vlab.textContent = 'VELOCITY';
    vl.appendChild(vlab);
    wrap.appendChild(vl);
    seqBody.appendChild(wrap);
    // start scrolled so the notes are in view
    if (evs.length && !pr.autoScrolled) {
      pr.autoScrolled = true;
      const lo = Math.min(...evs.map(e => e.note)), hi = Math.max(...evs.map(e => e.note));
      if (lo < pr.lowest || hi > top) { pr.lowest = Math.max(0, Math.min(127 - pr.rows, lo - 4)); renderSeq(); }
    }
  }

  // ---- patterns, length, transport ----
  document.querySelectorAll('.pattern-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pat = parseInt(btn.dataset.pattern);
      MIDIManager.send(SEQTRAK.buildParam(SEQTRAK.PATTERN_MODE, 1));                 // patterns 3-6 reachable (verified)
      SEQTRAK.TRACKS.forEach((t, p) => { sendDef(SEQTRAK.PATTERN_SELECT(p), pat); patSel[p] = pat; });
      steps.forEach(a => a.fill(null)); rollEvents.fill(null);
      setTimeout(loadTrack, 300);
    });
  });
  document.querySelectorAll('.len-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = parseInt(btn.dataset.len);
      seqLen = n;
      document.querySelectorAll('.len-btn').forEach(b => b.classList.toggle('active', b === btn));
      // set this track's current pattern length on the unit (30 5p 16+2n, 2 bytes)
      MIDIManager.send(SEQTRAK.buildParamData(SEQTRAK.PATTERN_STEPS(seqTrack, patSel[seqTrack]), [(n >> 7) & 0x7F, n & 0x7F]));
      readSteps();
    });
  });
  const recBtn = document.getElementById('seq-rec');
  function setPlaying(v) {
    playing = v;
    document.querySelectorAll('.seq-play, #seq-play').forEach(b => b.classList.toggle('on', v));
    if (!v && recOn) { recOn = false; recBtn.classList.remove('on'); }
    if (typeof launchPlaying === 'function') launchPlaying(v);
  }
  document.getElementById('seq-play').addEventListener('click', () => { MIDIManager.send(new Uint8Array([0xFA])); setPlaying(true); });
  document.getElementById('seq-stop').addEventListener('click', () => { MIDIManager.send(new Uint8Array([0xFC])); setPlaying(false); });
  recBtn.addEventListener('click', () => {
    if (!playing) { seqMsg.textContent = 'REC only works while playing - press play first (the SEQTRAK ignores it when stopped).'; return; }
    recOn = !recOn;
    recBtn.classList.toggle('on', recOn);
    sendDef(SEQTRAK.RECORDING, recOn ? 1 : 0);                                      // verified 01 10 21 (writable while playing)
  });
  document.getElementById('seq-bpm-input').addEventListener('change', e => {
    const bpm = Math.max(5, Math.min(300, parseInt(e.target.value) || 120));
    MIDIManager.send(SEQTRAK.buildParamData([0x30, 0x40, 0x76], [(bpm >> 7) & 0x7F, bpm & 0x7F]));   // 02-sysex-format example
  });
  document.querySelector('.tab[data-page="seq"]').addEventListener('click', () => { buildSeqChips(); loadTrack(); MIDIManager.send(SEQTRAK.buildRequest([0x30, 0x40, 0x76])); });
  buildSeqChips();
  renderSeq();

  // ======================================================
  // LAUNCH PAGE — clip launch: each track's 6 patterns, scenes = a column on every track
  // Pattern Select 30 5p 0F (verified); Pattern Select Mode 30 40 79 = 1 so patterns 3-6
  // are reachable (verified - in mode 0 writes to 3-6 silently land on 2). Read back after
  // every switch, as the docs advise.
  // ======================================================
  const launchGrid = document.getElementById('launch-grid');
  const muted = new Array(11).fill(false);
  let soloPart = -1;
  function setMute(p, on) {
    muted[p] = on;
    MIDIManager.sendCC(p, 23, on ? 127 : 0);
    const sm = stripsEl.querySelector(`.strip[data-track="${p}"] .strip-m`); if (sm) sm.classList.toggle('on', on);
    const lm = launchGrid.querySelector(`.lr-m[data-track="${p}"]`); if (lm) lm.classList.toggle('on', on);
  }
  function setSolo(p) {
    soloPart = soloPart === p ? -1 : p;
    MIDIManager.sendCC(p, 24, soloPart < 0 ? 0 : soloPart + 1);
    launchGrid.querySelectorAll('.lr-s').forEach(b => b.classList.toggle('on', +b.dataset.track === soloPart));
    stripsEl.querySelectorAll('.strip-s').forEach((b, i) => b.classList.toggle('on', i === soloPart));
  }
  // scene memory: 8 slots, each = a pattern number per track. 1-6 start as "every track on pattern n"
  let scenes = (() => { try { const v = JSON.parse(localStorage.getItem('fbScenes')); if (Array.isArray(v) && v.length === 8) return v; } catch (e) {} return null; })()
    || [0, 1, 2, 3, 4, 5].map(n => new Array(11).fill(n)).concat([null, null]);
  let storeArmed = false;
  function saveScenes() { try { localStorage.setItem('fbScenes', JSON.stringify(scenes)); } catch (e) {} }
  function sceneMatch(i) { return !!scenes[i] && scenes[i].every((n, p) => patSel[p] === n); }
  function paintScenes() { launchGrid.querySelectorAll('.sb-scene').forEach(b => b.classList.toggle('on', sceneMatch(+b.dataset.scene))); }
  function storeScene(i) { scenes[i] = SEQTRAK.TRACKS.map((t, p) => patSel[p] || 0); saveScenes(); storeArmed = false; renderLaunch(); }
  function recallScene(i) {
    const sc = scenes[i]; if (!sc) { storeArmed = true; renderLaunch(); return; }
    ensureMode();
    sc.forEach((n, p) => { if (patSel[p] === n) return; sendDef(SEQTRAK.PATTERN_SELECT(p), n); const c = launchGrid.querySelector(`.lr-clip[data-track="${p}"][data-pat="${n}"]`); if (c) c.classList.add('queued'); });
    setTimeout(async () => { for (let p = 0; p < 11; p++) await confirmPattern(p); }, 250);
  }
  function renderLaunch() {
    launchGrid.innerHTML = '';
    const head = document.createElement('div'); head.className = 'lr lr-head';
    // 8 scene memories across the top (the unit has 6 patterns per track, a scene is any mix of them)
    const bar = document.createElement('div'); bar.className = 'scene-bar';
    bar.innerHTML = '<div class="sb-label">SCENES</div>';
    for (let i = 0; i < 8; i++) {
      const b = document.createElement('button'); b.className = 'sb-scene' + (scenes[i] ? '' : ' empty') + (sceneMatch(i) ? ' on' : '');
      b.dataset.scene = i;
      b.innerHTML = `<b>${i + 1}</b><small>${scenes[i] ? scenes[i].map(n => n + 1).join('') : 'EMPTY'}</small>`;
      b.onclick = () => storeArmed ? storeScene(i) : recallScene(i);
      bar.appendChild(b);
    }
    const st = document.createElement('button'); st.className = 'sb-store' + (storeArmed ? ' armed' : '');
    st.textContent = storeArmed ? 'TAP A SCENE' : 'STORE';
    st.onclick = () => { storeArmed = !storeArmed; renderLaunch(); };
    bar.appendChild(st);
    launchGrid.appendChild(bar);
    head.innerHTML = '<div class="lr-name">TRACKS</div>';
    for (let n = 0; n < 6; n++) {
      const b = document.createElement('button'); b.className = 'lr-scene'; b.innerHTML = `▶ ALL ${n + 1}`;
      b.onclick = () => launchScene(n);
      head.appendChild(b);
    }
    head.insertAdjacentHTML('beforeend', '<div class="lr-ms">M / S</div>');
    launchGrid.appendChild(head);
    SEQTRAK.TRACKS.forEach((tk, p) => {
      const r = document.createElement('div'); r.className = 'lr'; r.dataset.track = p; r.style.setProperty('--kc', tk.color);
      r.innerHTML = `<div class="lr-name"><b>${trackShort(p)}</b><small>${soundNames[p] || '—'}</small></div>`;
      for (let n = 0; n < 6; n++) {
        const c = document.createElement('button');
        c.className = 'lr-clip' + (patSel[p] === n ? ' on' : '');
        c.dataset.track = p; c.dataset.pat = n;
        c.innerHTML = `<span>${n + 1}</span>`;
        c.onclick = () => launchClip(p, n);
        r.appendChild(c);
      }
      const ms = document.createElement('div'); ms.className = 'lr-ms';
      ms.innerHTML = `<button class="lr-m${muted[p] ? ' on' : ''}" data-track="${p}">M</button><button class="lr-s${soloPart === p ? ' on' : ''}" data-track="${p}">S</button>`;
      ms.querySelector('.lr-m').onclick = () => setMute(p, !muted[p]);
      ms.querySelector('.lr-s').onclick = () => setSolo(p);
      r.appendChild(ms);
      launchGrid.appendChild(r);
    });
  }
  function paintClips(p) {
    launchGrid.querySelectorAll(`.lr-clip[data-track="${p}"]`).forEach(c => {
      c.classList.toggle('on', +c.dataset.pat === patSel[p]);
      c.classList.remove('queued');
    });
    paintScenes();
  }
  let modeSet = false;
  function ensureMode() { if (!modeSet) { MIDIManager.send(SEQTRAK.buildParam(SEQTRAK.PATTERN_MODE, 1)); modeSet = true; } }
  async function confirmPattern(p) {
    const d = await askRetry(SEQTRAK.PATTERN_SELECT(p).addr, 500, 2);
    if (d && d.length) patSel[p] = d[0];
    paintClips(p);
  }
  function launchClip(p, n) {
    ensureMode();
    sendDef(SEQTRAK.PATTERN_SELECT(p), n);
    const c = launchGrid.querySelector(`.lr-clip[data-track="${p}"][data-pat="${n}"]`);
    if (c) c.classList.add('queued');
    setTimeout(() => confirmPattern(p), 250);
  }
  function launchScene(n) {
    ensureMode();
    SEQTRAK.TRACKS.forEach((t, p) => { sendDef(SEQTRAK.PATTERN_SELECT(p), n); const c = launchGrid.querySelector(`.lr-clip[data-track="${p}"][data-pat="${n}"]`); if (c) c.classList.add('queued'); });
    setTimeout(async () => { for (let p = 0; p < 11; p++) await confirmPattern(p); }, 250);
  }
  function launchPlaying(v) { document.querySelectorAll('.launch-play').forEach(b => b.classList.toggle('on', v)); }
  document.querySelector('.launch-play').onclick = () => { MIDIManager.send(new Uint8Array([0xFA])); setPlaying(true); };
  document.querySelector('.launch-stop').onclick = () => { MIDIManager.send(new Uint8Array([0xFC])); setPlaying(false); };
  onTracks(renderLaunch);
  document.querySelector('.tab[data-page="launch"]').addEventListener('click', async () => {
    renderLaunch();
    if (!MIDIManager.isConnected()) return;
    for (let p = 0; p < 11; p++) await confirmPattern(p);
  });
  // strip mute/solo buttons share the same state
  stripsEl.querySelectorAll('.strip[data-track]').forEach(s => {
    const p = +s.dataset.track, m = s.querySelector('.strip-m'), so = s.querySelector('.strip-s');
    if (m) { const nm = m.cloneNode(true); m.replaceWith(nm); nm.onclick = e => { e.stopPropagation(); setMute(p, !muted[p]); }; }
    if (so) { const ns = so.cloneNode(true); so.replaceWith(ns); ns.onclick = e => { e.stopPropagation(); setSolo(p); }; }
  });
  renderLaunch();

  // ======================================================
  // M-ONE PAGE — matches M-One VST plugin layout
  // ======================================================
  const m1LoadedName = document.getElementById('m1-loaded-name');
  let m1Target = 7, m1Loaded = null, m1PresetIdx = 0;

  // Sub-tab navigation
  document.querySelectorAll('.m1-subtab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.m1-subtab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.m1-subpage').forEach(p => p.classList.remove('active'));
      document.getElementById(`m1-${tab.dataset.m1page}`).classList.add('active');
    });
  });

  // Target track: every SYNTH-type track (SYNTH 1/2 and any drum track re-typed to SYNTH)
  const m1TargetEl = document.querySelector('.m1-target');
  const m1TargetHooks = [];
  function buildM1Targets() {
    m1TargetEl.querySelectorAll('.m1-target-btn').forEach(b => b.remove());
    const parts = trackType.map((t, p) => t === 2 ? p : -1).filter(p => p >= 0);
    if (!parts.includes(m1Target)) m1Target = parts.includes(7) ? 7 : parts[0];
    parts.forEach(p => {
      const b = document.createElement('button');
      b.className = 'm1-target-btn' + (p === m1Target ? ' active' : '');
      b.dataset.track = p; b.textContent = trackShort(p);
      b.onclick = () => {
        m1Target = p;
        m1TargetEl.querySelectorAll('.m1-target-btn').forEach(x => x.classList.toggle('active', x === b));
        m1TargetHooks.forEach(fn => fn());
      };
      m1TargetEl.appendChild(b);
    });
  }
  buildM1Targets();

  // ---- PLAY sub-page ----
  // Preset selector
  function updatePresetDisplay() {
    const s = M1_SOUNDS.getById(m1PresetIdx);
    if (!s) return;
    document.getElementById('m1-preset-label').textContent = `${s.cat.toUpperCase()} ${s.id}`;
    document.getElementById('m1-preset-name').textContent = s.name.replace('M1 ', '');
  }

  document.getElementById('m1-prev').addEventListener('click', () => {
    m1PresetIdx = (m1PresetIdx - 1 + 100) % 100;
    updatePresetDisplay();
    loadM1(M1_SOUNDS.getById(m1PresetIdx));
  });
  document.getElementById('m1-next').addEventListener('click', () => {
    m1PresetIdx = (m1PresetIdx + 1) % 100;
    updatePresetDisplay();
    loadM1(M1_SOUNDS.getById(m1PresetIdx));
  });

  updatePresetDisplay();

  // Quick Edit / Sound knobs: same look as the M-One plugin, now on documented SEQTRAK
  // parameters of the target synth part (SYNTH 1 = part 7, SYNTH 2 = part 8)
  const m1QE = document.getElementById('m1-quickedit-knobs');
  const m1SN = document.getElementById('m1-sound-knobs');
  function buildM1Knobs() {
    unreg(m1QE); unreg(m1SN); m1QE.innerHTML = ''; m1SN.innerHTML = '';
    const P = SEQTRAK.P, p = m1Target;
    const rl = (d, l) => Object.assign(d, { label: l });
    m1QE.appendChild(krow([rl(P.cutoff(p), 'CUTOFF'), rl(P.fegDepth(p), 'FILTER EG'), rl(P.ampAttack(p), 'ATTACK'), rl(P.ampDecRel(p), 'DECAY'),
      rl(P.aegS(p), 'SUSTAIN'), rl(P.aegR(p), 'RELEASE'), rl(P.portaTime(p), 'PORTA'), rl(P.reverb(p), 'FX AMT')], 'var(--fb-cyan)'));
    m1SN.appendChild(krow([P.volume(p), P.reverb(p), P.delay(p)], 'var(--fb-blue)'));
    requestDefs(defsIn(m1QE).concat(defsIn(m1SN)));
  }
  buildM1Knobs();
  m1TargetHooks.push(buildM1Knobs);

  // (BROWSE sub-page removed 25 Nov: the PLAY page's preset grid replaces it)

  // ---- FX sub-page: the SEQTRAK's own effects, as if the M1 were the internal synth ----
  // REVERB = send reverb + this track's reverb send, DELAY = send delay + delay send,
  // MOD = the track's insert (single) effect, EQ = the track's EQ. All documented addresses.
  const M1FX_COLORS = ['var(--fb-cyan)', 'var(--fb-orange)'];
  const m1FxCat = [0, 1];                      // panel 1 = REVERB, panel 2 = DELAY
  function m1FxContent(cat, p) {
    const F = SEQTRAK.FX, P = SEQTRAK.P;
    if (cat === 0) return { type: F.revType, on: F.revOn, knobs: [...F.revP, F.revReturn, Object.assign(P.reverb(p), { label: 'SEND' })] };
    if (cat === 1) return { type: F.dlyType, on: F.dlyOn, knobs: [...F.dlyP, F.dlyReturn, Object.assign(P.delay(p), { label: 'SEND' }), F.dlyToRev] };
    if (cat === 2) return { note: 'Track insert effect - its three FX knobs', knobs: F.trackP(p) };
    return { note: 'Track EQ', knobs: [P.eqLow(p), P.eqHigh(p)] };
  }
  function buildM1Fx(panel) {
    const n = panel + 1;
    const host = document.getElementById(`m1-fx${n}-knobs`);
    const tgl = document.getElementById(`m1-fx${n}-toggle`);
    unreg(host); host.innerHTML = '';
    const c = m1FxContent(m1FxCat[panel], m1Target);
    const top = document.createElement('div');
    top.className = 'm1-fx-type';
    if (c.type) { top.textContent = '—'; addTypeLabel(c.type, top); }
    else top.textContent = c.note;
    host.appendChild(top);
    host.appendChild(krow(c.knobs, M1FX_COLORS[panel]));
    // ON switch follows the effect's own on/off where it has one
    tgl.style.visibility = c.on ? 'visible' : 'hidden';
    tgl.onclick = null;
    if (c.on) {
      tgl.opts = c.on;
      tgl.setValue = v => tgl.classList.toggle('on', !!v);
      tgl.onclick = () => { tgl.classList.toggle('on'); sendDef(c.on, tgl.classList.contains('on') ? 1 : 0); };
      reg(c.on, tgl);
    }
    if (c.type) {
      requestDefs([c.on]);
      askRetry(c.type.addr, 600, 2).then(d => { if (d && d.length >= 2) setTypeName(SEQTRAK.keyOf(c.type), SEQTRAK.fxTypeName(d[0], d[1])); });
    }
    requestDefs(c.knobs);
  }
  [0, 1].forEach(panel => {
    const cats = document.getElementById(`m1-fx${panel + 1}-cats`);
    cats.querySelectorAll('.m1-fxcat').forEach((btn, i) => {
      btn.classList.toggle('active', i === m1FxCat[panel]);
      btn.addEventListener('click', () => {
        cats.querySelectorAll('.m1-fxcat').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        m1FxCat[panel] = i; buildM1Fx(panel);
      });
    });
    buildM1Fx(panel);
  });
  document.querySelector('.m1-subtab[data-m1page="fx"]').addEventListener('click', () => { buildM1Fx(0); buildM1Fx(1); });
  m1TargetHooks.push(() => { buildM1Fx(0); buildM1Fx(1); });

  // ---- PLAY page preset grid (M-One plugin style) ----
  const CAT_COL = { Piano: '#2d8cf0', Keyboard: '#40c8e0', Organ: '#e0a020', Bass: '#e04050', Guitar: '#e07030', Pad: '#9060e0',
    Strings: '#c040a0', Brass: '#e0c040', Woodwind: '#40c060', World: '#30b0a0', Mallet: '#80c040', Bell: '#a0d8ff', Rhythmic: '#f08030', SFX: '#8c9bb0', Lead: '#ff6aa0' };
  const pCats = document.getElementById('m1-pcats');
  const pGrid = document.getElementById('m1-pgrid');
  let pCat = 'ALL', pPage = 0;
  const PER_PAGE = 36;
  function buildPresetCats() {
    pCats.innerHTML = '';
    const counts = M1_SOUNDS.getCategoryCounts();
    ['ALL', ...M1_SOUNDS.CATEGORIES.filter(c => counts[c])].forEach(cat => {
      const b = document.createElement('button');
      b.className = 'm1-pcat' + (cat === pCat ? ' on' : '');
      b.style.setProperty('--cc', CAT_COL[cat] || '#2d8cf0');
      b.innerHTML = `${cat.toUpperCase()}<span>${cat === 'ALL' ? 100 : counts[cat]}</span>`;
      b.onclick = () => { pCat = cat; pPage = 0; buildPresetCats(); renderPresetGrid(); };
      pCats.appendChild(b);
    });
  }
  function renderPresetGrid() {
    const list = M1_SOUNDS.getByCategory(pCat);
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    pPage = Math.min(pPage, pages - 1);
    pGrid.innerHTML = '';
    list.slice(pPage * PER_PAGE, pPage * PER_PAGE + PER_PAGE).forEach(s => {
      const t = document.createElement('button');
      t.className = 'm1-ptile' + (s.id === m1PresetIdx ? ' sel' : '') + (s.id === m1Loaded ? ' loaded' : '');
      t.style.setProperty('--cc', CAT_COL[s.cat] || '#2d8cf0');
      t.innerHTML = `<span class="m1-ptile-num">${String(s.id).padStart(2, '0')}</span><span class="m1-ptile-name">${s.name.replace(/^M1 /, '')}</span><span class="m1-ptile-cat">${s.cat}</span>`;
      t.onclick = () => { m1PresetIdx = s.id; updatePresetDisplay(); loadM1(s); renderPresetGrid(); };
      pGrid.appendChild(t);
    });
    const nav = document.getElementById('m1-ppages');
    nav.innerHTML = '';
    for (let i = 0; i < pages && pages > 1; i++) {
      const b = document.createElement('button');
      b.className = 'm1-ppage' + (i === pPage ? ' on' : '');
      b.textContent = `${i * PER_PAGE + 1}-${Math.min(list.length, (i + 1) * PER_PAGE)}`;
      b.onclick = () => { pPage = i; renderPresetGrid(); };
      nav.appendChild(b);
    }
  }
  buildPresetCats();
  renderPresetGrid();
  // keep the grid in step with the arrows
  ['m1-prev', 'm1-next'].forEach(id => document.getElementById(id).addEventListener('click', () => {
    const s = M1_SOUNDS.getById(m1PresetIdx);
    if (s && pCat !== 'ALL' && s.cat !== pCat) { pCat = 'ALL'; buildPresetCats(); }
    const list = M1_SOUNDS.getByCategory(pCat);
    pPage = Math.floor(list.findIndex(x => x.id === m1PresetIdx) / PER_PAGE) || 0;
    renderPresetGrid();
  }));

  // ---- Load sound ----
  // M1 sounds are USER sounds. Their slot in the user bank (MSB 63, LSB 32+, program) is
  // the order they were created in, so LEARN steps through the user bank once on the
  // target track and reads each loaded name back (01 1p 35) - the method verified in
  // seqtrak-docs 06. The map is kept in this browser.
  const USERMAP_KEY = 'fbSeqtrakUserBank';
  let userMap = {};
  try { userMap = JSON.parse(localStorage.getItem(USERMAP_KEY) || '{}'); } catch (e) { userMap = {}; }
  const norm = n => String(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const learnBtn = document.getElementById('m1-learn');
  const learnStatus = document.getElementById('m1-learn-status');
  function learnLabel() {
    const n = Object.keys(userMap).length;
    const m1 = M1_SOUNDS.SOUNDS ? M1_SOUNDS.SOUNDS.filter(s => userMap[norm(s.name)]).length : 0;
    learnStatus.textContent = n ? `${m1}/100 M1 sounds mapped (${n} user sounds)` : 'Tap LEARN once so the app can find your M1 sounds';
  }
  learnLabel();

  let learning = false;
  learnBtn.addEventListener('click', async () => {
    if (learning) { learning = false; return; }
    if (!MIDIManager.isConnected()) { learnStatus.textContent = 'Connect to the SEQTRAK first'; return; }
    learning = true; learnBtn.textContent = 'STOP';
    const p = m1Target, found = {};
    let prev = null, total = 0;
    for (let lsb = 32; lsb < 48 && learning; lsb++) {
      let newHere = 0, sinceNew = 0;
      for (let prog = 0; prog < 128 && learning; prog++) {
        SEQTRAK.loadSound(p, 63, lsb, prog).forEach(m => MIDIManager.send(m));
        await new Promise(r => setTimeout(r, 140));
        const d = await askRetry(SEQTRAK.soundNameAddr(p), 600, 2);
        const name = d ? SEQTRAK.decodeName(d) : null;
        if (name && name !== prev) {
          if (!found[norm(name)]) found[norm(name)] = [lsb, prog, name];
          prev = name; newHere++; total++; sinceNew = 0;
        } else sinceNew++;
        learnStatus.textContent = `Learning... bank ${lsb - 31}, slot ${prog + 1} - ${total} sounds found (last: ${prev || '-'})`;
        if (sinceNew >= 24 && newHere > 0) break;      // past the end of this bank's sounds
        if (sinceNew >= 24 && newHere === 0) break;    // empty bank
      }
      if (newHere === 0) break;
    }
    if (Object.keys(found).length) {
      userMap = found;
      try { localStorage.setItem(USERMAP_KEY, JSON.stringify(userMap)); } catch (e) {}
    }
    learning = false; learnBtn.textContent = 'LEARN';
    learnLabel();
    const piano = userMap[norm('M1 Piano')];
    if (piano) SEQTRAK.loadSound(p, 63, piano[0], piano[1]).forEach(m => MIDIManager.send(m));
  });

  function loadM1(sound) {
    m1Loaded = sound.id;
    if (typeof renderPresetGrid === 'function') renderPresetGrid();
    const hit = userMap[norm(sound.name)];
    const tname = trackShort(m1Target);
    if (!hit) {
      m1LoadedName.textContent = `${sound.name} not mapped yet - tap LEARN`;
      return;
    }
    SEQTRAK.loadSound(m1Target, 63, hit[0], hit[1]).forEach(m => MIDIManager.send(m));
    m1LoadedName.textContent = `${sound.name} → ${tname}`;
    onSoundChanged(m1Target);                     // read the name back to confirm
    const el = document.getElementById('m1-loaded');
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 600);
  }

  // ---- LIBRARY: M1 programs applied live to the target track ----
  const libBanksEl = document.getElementById('lib-banks'), libProgsEl = document.getElementById('lib-progs');
  const libStatus = document.getElementById('lib-status'), libInfo = document.getElementById('lib-info');
  let libBanks = [], libSel = 0, libQuery = '', libLoadedKey = '';
  async function refreshLib() {
    try { libBanks = await M1Lib.allBanks(); } catch (e) { libBanks = []; }
    const nprog = libBanks.reduce((s, b) => s + b.progs.length, 0);
    libStatus.textContent = libBanks.length ? `${libBanks.length} banks · ${nprog.toLocaleString()} programs on this device` : 'No banks yet - tap IMPORT BANKS and pick your .syx / .m1b / .m1lib files';
    renderLib();
  }
  function renderLib() {
    const q = libQuery.toLowerCase();
    libBanksEl.innerHTML = '';
    libBanks.forEach((b, i) => {
      const progHit = q && b.progs.some(p => M1Lib.progName(p).toLowerCase().includes(q));
      if (q && !b.name.toLowerCase().includes(q) && !progHit) return;
      const el = document.createElement('button');
      el.className = 'lib-bank' + (i === libSel ? ' on' : '');
      el.innerHTML = `<span>${b.name}</span><em>${b.progs.length}</em>`;
      el.onclick = () => { libSel = i; renderLib(); };
      libBanksEl.appendChild(el);
    });
    libProgsEl.innerHTML = '';
    const bank = libBanks[libSel];
    if (!bank) return;
    bank.progs.forEach((p, k) => {
      const d = M1Lib.describe(p);
      if (q && !bank.name.toLowerCase().includes(q) && !d.name.toLowerCase().includes(q)) return;
      const ms = M1_SOUNDS.getById(d.ms1);
      const t = document.createElement('button');
      const key = bank.name + '#' + k;
      t.className = 'lib-prog' + (key === libLoadedKey ? ' on' : '') + (d.mode === 2 ? ' drum' : '');
      t.style.setProperty('--cc', ms ? (CAT_COL[ms.cat] || '#2d8cf0') : '#556');
      t.innerHTML = `<span class="lp-num">${String(k).padStart(2, '0')}${d.mode === 1 ? ' · DBL' : d.mode === 2 ? ' · DRUM' : ''}</span><span class="lp-name">${d.name}</span><span class="lp-ms">${ms ? ms.name.replace(/^M1 /, '') : 'MS ' + d.ms1}</span>`;
      t.onclick = () => applyProgram(bank, k);
      libProgsEl.appendChild(t);
    });
  }
  function applyProgram(bank, k) {
    const p = bank.progs[k], d = M1Lib.describe(p), part = m1Target;
    if (d.mode === 2) { libInfo.textContent = `${d.name}: M1 drum programs aren't supported on the SEQTRAK yet.`; return; }
    const ms = M1_SOUNDS.getById(d.ms1);
    const hit = ms && userMap[norm(ms.name)];
    if (!hit) { libInfo.textContent = `${d.name} uses "${ms ? ms.name : 'multisound ' + d.ms1}" - tap LEARN on the PLAY tab first so the app can find it.`; return; }
    SEQTRAK.loadSound(part, 63, hit[0], hit[1]).forEach(m => MIDIManager.send(m));
    setTimeout(() => {
      M1Lib.paramsFor(d, part).forEach(([def, v]) => sendDef(def, v));
      if (part === selTrack) requestDefs(defsIn(sndGrid));
    }, 350);
    libLoadedKey = bank.name + '#' + k;
    m1LoadedName.textContent = `${d.name} (${bank.name}) → ${trackShort(part)}`;
    libInfo.textContent = `${d.name}: ${ms.name}${d.mode === 1 ? ' (double program - OSC 1 only for now)' : ''}, cutoff ${d.cutoff}, EG int ${d.egInt}, level ${d.level}${d.oct1 ? ', octave ' + (d.oct1 > 0 ? '+' : '') + d.oct1 : ''}`;
    renderLib();
  }
  document.getElementById('lib-files').addEventListener('change', async e => {
    const files = e.target.files;
    if (!files.length) return;
    libStatus.textContent = 'Importing...';
    try {
      const r = await M1Lib.importFiles(files, (i, n) => { libStatus.textContent = `Importing ${i}/${n}...`; });
      await refreshLib();
      libStatus.textContent += ` (added ${r.banks}${r.skipped ? ', skipped ' + r.skipped + ' files with no programs' : ''})`;
    } catch (err) { libStatus.textContent = 'Import failed: ' + err.message; }
    e.target.value = '';
  });
  document.getElementById('lib-search').addEventListener('input', e => { libQuery = e.target.value; renderLib(); });
  document.querySelector('.m1-subtab[data-m1page="lib"]').addEventListener('click', refreshLib);
  refreshLib();

  // ---- keep every label in step with what each track is ----
  onTracks(() => {
    stripsEl.querySelectorAll('.strip[data-track]').forEach(s => { const p = +s.dataset.track; s.querySelector('.strip-name').textContent = trackShort(p); });
    document.querySelectorAll('.track-chip[data-track]').forEach(c => { const p = +c.dataset.track; c.textContent = trackShort(p); c.title = soundNames[p] || ''; });
    buildSound(selTrack);
    buildM1Targets();
  });
  async function readTypes() {
    for (let p = 0; p < 11; p++) {
      const d = await askRetry(SEQTRAK.TYPE_ADDR(p), 500, 2);
      if (d && d.length) trackType[p] = d[0];
    }
    tracksChanged();
  }

  // ---- Incoming MIDI: everything the SEQTRAK sends moves the matching control ----
  MIDIManager.onMidiMessage = (data) => {
    if (data[0] === 0xF0) {
      const pc = SEQTRAK.parseParamChange(data);
      if (!pc) return;
      if (pc.key === 'sx:304076' && pc.data.length >= 2) {
        const bpm = (pc.data[0] << 7) | pc.data[1];
        if (window.__fbTempoReply) window.__fbTempoReply(bpm);
        const bi = document.getElementById('seq-bpm-input'); if (bi) bi.value = bpm;
        return;
      }
      const w = waiters.get(pc.key);
      if (w && w.length) { w.shift()(pc.data); }
      else if (pc.addr[0] === 0x01 && (pc.addr[1] & 0xF0) === 0x10 && pc.addr[2] === 0x35) setSoundName(pc.addr[1] & 0x0F, SEQTRAK.decodeName(pc.data));
      else if (pc.addr[0] === 0x01 && (pc.addr[1] & 0xF0) === 0x10 && pc.addr[2] === 0x3C && pc.data.length) setTrackType(pc.addr[1] & 0x0F, pc.data[0]);
      else if (pc.addr[0] === 0x01 && pc.addr[1] === 0x33 && pc.addr[2] === 0x01) setTimeout(readTypes, 300);   // a drum track was re-typed
      else if (pc.addr[0] === 0x70 && (pc.addr[1] & 0xF0) === 0x40) {
        const p = pc.addr[1] & 0x0F, st = pc.addr[2], d = pc.data;
        if (p < 11 && st < 32) { steps[p][st] = d.length >= 6 ? { note: d[0], vel: d[1], gate: (d[4] << 7) | d[5] } : false; paintStep(p, st); }
      }
      if (pc.addr[0] === 0x30 && pc.addr[2] === 0x00 && pc.addr[1] >= 0x41 && pc.addr[1] <= 0x45 && pc.data.length >= 2) {
        setTypeName(pc.key, SEQTRAK.fxTypeName(pc.data[0], pc.data[1]));
      }
      if (pc.data.length) applyIncoming(pc.key, pc.value);
      return;
    }
    const st = data[0] & 0xF0, ch = data[0] & 0x0F;
    if (st === 0xB0) applyIncoming(`cc:${ch}:${data[1]}`, data[2]);
    else if (st === 0xC0 && ch < 11) onSoundChanged(ch);                 // unit changed sound: follow it
    else if (data[0] === 0xFA || data[0] === 0xFB) setPlaying(true);
    else if (data[0] === 0xFC) setPlaying(false);
  };

  // read everything on screen once connected
  function syncAll() {
    const defs = [SEQTRAK.MASTER_VOLUME];
    SEQTRAK.TRACKS.forEach((t, p) => defs.push(SEQTRAK.P.volume(p), SEQTRAK.P.pan(p)));
    requestDefs(defs.concat(defsIn(sndGrid), defsIn(document.getElementById('page-dx'))));
    MIDIManager.send(SEQTRAK.buildRequest([0x30, 0x40, 0x76]));
    (async () => { await readTypes(); for (let p = 0; p < 11; p++) await fetchName(p); })();
  }

  // ---- Init MIDI ----
  const ok = await MIDIManager.init();
  if (ok && MIDIManager.autoConnect()) {
    updateMidiStatus(true, MIDIManager.getConnectionName());
    setTimeout(syncAll, 800);
  }
  const bleBtn = document.getElementById('midi-ble');
  if (bleBtn) {
    if (!MIDIManager.bleSupported()) {
      bleBtn.disabled = true;
      document.getElementById('midi-ble-help').textContent = 'Bluetooth needs Chrome on Android (or PC) and the https copy of this app.';
    }
    bleBtn.addEventListener('click', async () => {
      midiStatusText.style.color = '';
      midiStatusText.textContent = 'Looking for SEQTRAK over Bluetooth...';
      try {
        const name = await MIDIManager.connectBLE();
        midiStatusText.textContent = 'Connected to ' + name + ' over Bluetooth!';
        midiStatusText.style.color = '#40c060';
        updateMidiStatus(true, name);
      } catch (e) {
        midiStatusText.textContent = 'Bluetooth: ' + e.message;
        midiStatusText.style.color = '#e04040';
      }
    });
  }
  MIDIManager.onDisconnect = () => updateMidiStatus(false);
  // Bluetooth status light: green connected, amber reconnecting, red lost (tap MIDI to retry)
  MIDIManager.onBleState = st => {
    midiBtn.classList.toggle('reconnecting', st === 'reconnecting');
    if (st === 'connected') { updateMidiStatus(true, BLEMidi.name()); setTimeout(syncAll, 600); }
    else if (st === 'reconnecting') { midiBtn.classList.remove('connected'); midiBtn.querySelector('.midi-label').textContent = 'RECONNECTING...'; }
    else if (st === 'lost') { updateMidiStatus(false); midiBtn.querySelector('.midi-label').textContent = 'BT LOST - TAP'; }
  };
  // standalone/https copy: try the SEQTRAK used last time without asking
  if (location.protocol === 'https:') MIDIManager.autoBLE().then(n => { if (n) updateMidiStatus(true, n); });
  const syncBtn = document.getElementById('midi-sync');
  if (syncBtn) syncBtn.addEventListener('click', syncAll);

})();
