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
    s.innerHTML = `<button class="strip-name">${tk.name}</button><div class="strip-snd" title=""></div>`;
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
    s.innerHTML = `<div class="strip-name">MASTER</div><div class="strip-snd"></div><div class="strip-spacer"></div>`;
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
    const groupName = { drum: 'DRUM', synth: 'AWM2 SYNTH', dx: 'DX · FM', sampler: 'SAMPLER' }[tk.group];
    sndHead.style.setProperty('--kc', c);
    sndHead.innerHTML = `<div class="snd-head-name">${tk.name}</div><div class="snd-head-info"><div class="snd-head-sound" id="snd-head-sound">${soundNames[p] || '—'}</div><div class="snd-head-sub">TRACK ${p + 1} · CH ${p + 1} · ${groupName}</div></div>`;
    if (tk.group === 'dx') {
      const go = document.createElement('button');
      go.className = 'snd-head-go'; go.textContent = 'OPEN DX EDITOR ▸';
      go.onclick = () => document.querySelector('.tab[data-page="dx"]').click();
      sndHead.appendChild(go);
    }
    const add = (t, defs, cls) => sndGrid.appendChild(section(t, c, krow(defs, c), cls));

    if (tk.group === 'drum') {
      add('PITCH', [P.drumPitch(p), P.velDepth(p)]);
      add('FILTER', [P.cutoff(p), P.reso(p), P.fegDepth(p)]);
      add('AMP', [P.ampAttack(p), P.ampDecRel(p), P.aegS(p)]);
      add('EQ', [P.eqLow(p), P.eqHigh(p)]);
      add('SENDS', [P.reverb(p), P.delay(p)]);
    } else if (tk.group === 'synth') {
      add('FILTER', [P.cutoff(p), P.reso(p), P.fegDepth(p)]);
      add('AMP', [P.ampAttack(p), P.ampDecRel(p), P.aegS(p), P.aegR(p)]);
      add('FILTER ENVELOPE', [P.fegA(p), P.fegD(p), P.fegS(p), P.fegR(p)], 'wide');
      add('PLAY', [P.monoPoly(p), P.portaTime(p), P.noteShift(p)]);
      add('ARP', [P.arpType(p), P.arpGate(p)]);
      add('EQ', [P.eqLow(p), P.eqHigh(p)]);
      add('SENDS', [P.reverb(p), P.delay(p)]);
    } else if (tk.group === 'dx') {
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
    c.className = 'track-chip'; c.textContent = tk.name; c.style.borderColor = tk.color;
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
  // SEQ PAGE — transport, pattern select, drum step editing on the unit
  // ======================================================
  const seqGrid = document.getElementById('seq-grid');
  const seqNums = document.getElementById('seq-step-numbers');
  const seqTrackChips = document.getElementById('seq-track-chips');
  const seqMsg = document.getElementById('seq-msg');
  let seqTrack = 0, seqLen = 16, playing = false, recOn = false;
  const steps = Array.from({ length: 11 }, () => new Array(32).fill(null));   // null = unknown, false = empty, obj = note

  SEQTRAK.TRACKS.forEach((tk, i) => {
    const chip = document.createElement('button');
    chip.className = 'track-chip' + (i === 0 ? ' active' : '');
    chip.textContent = tk.name; chip.style.borderColor = tk.color; chip.dataset.track = i;
    if (i === 0) { chip.style.background = tk.color; chip.style.color = '#fff'; }
    chip.addEventListener('click', () => {
      seqTrackChips.querySelectorAll('.track-chip').forEach(c => { c.classList.remove('active'); c.style.background = ''; c.style.color = ''; });
      chip.classList.add('active'); chip.style.background = tk.color; chip.style.color = '#fff';
      seqTrack = i; renderSeq(); readSteps();
    });
    seqTrackChips.appendChild(chip);
  });

  const isDrumPart = p => SEQTRAK.TRACKS[p].group === 'drum';
  function renderSeq() {
    seqGrid.innerHTML = ''; seqNums.innerHTML = '';
    seqGrid.style.gridTemplateColumns = `repeat(${seqLen}, 1fr)`;
    seqNums.style.gridTemplateColumns = `repeat(${seqLen}, 1fr)`;
    const tk = SEQTRAK.TRACKS[seqTrack];
    const drum = isDrumPart(seqTrack);
    seqMsg.textContent = drum
      ? 'Tap a step to add/remove it on the SEQTRAK. Best done while stopped.'
      : 'Step editing for SYNTH / DX / SAMPLER tracks uses the piano-roll protocol - coming next. Drum tracks work now.';
    seqGrid.classList.toggle('locked', !drum);
    for (let s = 0; s < seqLen; s++) {
      const num = document.createElement('span');
      num.className = 'seq-step-num'; num.textContent = s + 1;
      seqNums.appendChild(num);
      const btn = document.createElement('button');
      const st = steps[seqTrack][s];
      btn.className = 'seq-step' + (st ? ' on' : '') + (st === null ? ' unknown' : '');
      if (s % 4 === 0) btn.classList.add('beat-start');
      btn.dataset.step = s;
      btn.style.setProperty('--tk-color', tk.color);
      btn.addEventListener('click', () => toggleStep(s));
      seqGrid.appendChild(btn);
    }
  }
  function paintStep(p, s) {
    if (p !== seqTrack) return;
    const b = seqGrid.querySelector(`.seq-step[data-step="${s}"]`);
    if (!b) return;
    const st = steps[p][s];
    b.classList.toggle('on', !!st); b.classList.toggle('unknown', st === null);
  }
  async function readStep(p, s) {
    const d = await askRetry(SEQTRAK.STEP.readAddr(p, s), 450, 2);
    if (d === null) return;                       // no reply: leave as unknown
    steps[p][s] = d.length >= 6 ? { note: d[0], vel: d[1], gate: (d[4] << 7) | d[5] } : false;
    paintStep(p, s);
  }
  let readToken = 0;
  async function readSteps() {
    if (!isDrumPart(seqTrack) || !MIDIManager.isConnected()) return;
    const tok = ++readToken, p = seqTrack;
    for (let s = 0; s < seqLen; s++) { if (tok !== readToken) return; await readStep(p, s); }
  }
  async function toggleStep(s) {
    const p = seqTrack;
    if (!isDrumPart(p)) return;
    const st = steps[p][s];
    if (st) MIDIManager.send(SEQTRAK.STEP.del(p, s));
    else MIDIManager.send(SEQTRAK.STEP.add(p, s, 60, 100, 120));     // app defaults: C3, vel 100, gate 120 = one 16th
    steps[p][s] = st ? false : { note: 60, vel: 100, gate: 120 };
    paintStep(p, s);
    setTimeout(() => readStep(p, s), 250);                           // confirm from the unit
  }
  renderSeq();

  document.querySelectorAll('.pattern-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pattern-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const pat = parseInt(btn.dataset.pattern);
      SEQTRAK.TRACKS.forEach((t, p) => sendDef(SEQTRAK.PATTERN_SELECT(p), pat));      // verified 30 5p 0F
      steps.forEach(a => a.fill(null)); renderSeq(); setTimeout(readSteps, 300);
    });
  });
  document.querySelectorAll('.len-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.len-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      seqLen = parseInt(btn.dataset.len);
      renderSeq(); readSteps();
    });
  });
  const recBtn = document.getElementById('seq-rec');
  function setPlaying(v) {
    playing = v;
    document.getElementById('seq-play').classList.toggle('on', v);
    if (!v && recOn) { recOn = false; recBtn.classList.remove('on'); }
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
  document.querySelector('.tab[data-page="seq"]').addEventListener('click', () => { readSteps(); MIDIManager.send(SEQTRAK.buildRequest([0x30, 0x40, 0x76])); });

  // ======================================================
  // M-ONE PAGE — matches M-One VST plugin layout
  // ======================================================
  const m1LoadedName = document.getElementById('m1-loaded-name');
  let m1Target = 7, m1Loaded = null, m1PresetIdx = 0;
  let m1Cat = 'ALL', m1RangeStart = 0;

  // Sub-tab navigation
  document.querySelectorAll('.m1-subtab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.m1-subtab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.m1-subpage').forEach(p => p.classList.remove('active'));
      document.getElementById(`m1-${tab.dataset.m1page}`).classList.add('active');
    });
  });

  // Target track
  document.querySelectorAll('.m1-target-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.m1-target-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      m1Target = parseInt(btn.dataset.track);
    });
  });

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
  document.querySelectorAll('.m1-target-btn').forEach(btn => btn.addEventListener('click', () => setTimeout(buildM1Knobs, 0)));

  // ---- BROWSE sub-page ----
  const m1Cats = document.getElementById('m1-categories');
  const m1Grid = document.getElementById('m1-sound-grid');

  // Category buttons
  const catCounts = M1_SOUNDS.getCategoryCounts();
  M1_SOUNDS.CATEGORIES.forEach(cat => {
    if (!catCounts[cat]) return;
    const btn = document.createElement('button');
    btn.className = 'cat-btn'; btn.dataset.cat = cat;
    btn.innerHTML = `${cat} <span class="cat-count">${catCounts[cat]}</span>`;
    btn.addEventListener('click', () => {
      m1Cats.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); m1Cat = cat; renderM1Grid();
    });
    m1Cats.appendChild(btn);
  });

  m1Cats.querySelector('[data-cat="ALL"]').addEventListener('click', () => {
    m1Cats.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    m1Cats.querySelector('[data-cat="ALL"]').classList.add('active');
    m1Cat = 'ALL'; renderM1Grid();
  });

  // Range tabs (00-19, 20-39, etc.)
  document.querySelectorAll('.m1-range').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.m1-range').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      m1RangeStart = parseInt(btn.dataset.range);
      renderM1Grid();
    });
  });

  function renderM1Grid() {
    let sounds = M1_SOUNDS.getByCategory(m1Cat);
    // If filtering by range and showing ALL, slice to range
    if (m1Cat === 'ALL') {
      sounds = sounds.slice(m1RangeStart, m1RangeStart + 20);
    }
    m1Grid.innerHTML = '';
    sounds.forEach(s => {
      const cell = document.createElement('button');
      cell.className = 'm1-grid-cell' + (m1Loaded === s.id ? ' loaded' : '');
      cell.dataset.id = s.id;
      cell.innerHTML = `<span class="m1-cell-num">${s.id}</span> ${s.name.replace('M1 ', '')}`;
      cell.addEventListener('click', () => {
        m1PresetIdx = s.id;
        updatePresetDisplay();
        loadM1(s);
      });
      m1Grid.appendChild(cell);
    });
  }

  renderM1Grid();

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
  document.querySelectorAll('.m1-target-btn').forEach(btn => btn.addEventListener('click', () => setTimeout(() => { buildM1Fx(0); buildM1Fx(1); }, 0)));

  // ---- PLAY page preset grid (M-One plugin style) ----
  const CAT_COL = { Piano: '#2d8cf0', Keyboard: '#40c8e0', Organ: '#e0a020', Bass: '#e04050', Guitar: '#e07030', Pad: '#9060e0',
    Strings: '#c040a0', Brass: '#e0c040', Woodwind: '#40c060', World: '#30b0a0', Mallet: '#80c040', Bell: '#a0d8ff', Rhythmic: '#f08030', SFX: '#8c9bb0', Lead: '#ff6aa0' };
  const pCats = document.getElementById('m1-pcats');
  const pGrid = document.getElementById('m1-pgrid');
  let pCat = 'ALL', pPage = 0;
  const PER_PAGE = 24;
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
    m1Grid.querySelectorAll('.m1-grid-cell').forEach(c =>
      c.classList.toggle('loaded', parseInt(c.dataset.id) === sound.id));
    const hit = userMap[norm(sound.name)];
    const tname = m1Target === 7 ? 'SYN 1' : 'SYN 2';
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
    (async () => { for (let p = 0; p < 11; p++) await fetchName(p); })();
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
        setTimeout(syncAll, 600);
      } catch (e) {
        midiStatusText.textContent = 'Bluetooth: ' + e.message;
        midiStatusText.style.color = '#e04040';
      }
    });
  }
  MIDIManager.onDisconnect = () => updateMidiStatus(false);
  const syncBtn = document.getElementById('midi-sync');
  if (syncBtn) syncBtn.addEventListener('click', syncAll);

})();
