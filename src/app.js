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
    s.innerHTML = `<button class="strip-name">${tk.name}</button>`;
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
    s.innerHTML = `<div class="strip-name">MASTER</div><div class="strip-spacer"></div>`;
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
    sndHead.innerHTML = `<div class="snd-head-name">${tk.name}</div><div class="snd-head-sub">TRACK ${p + 1} · CH ${p + 1} · ${groupName}</div>`;
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
  // FX PAGE
  // ======================================================
  const fxBody = document.getElementById('fx-body');
  const fxTrackChips = document.getElementById('fx-track-chips');
  let fxTrack = 0;

  SEQTRAK.TRACKS.forEach((tk, i) => {
    const chip = document.createElement('button');
    chip.className = 'track-chip' + (i === 0 ? ' active' : '');
    chip.textContent = tk.name; chip.style.borderColor = tk.color; chip.dataset.track = i;
    if (i === 0) { chip.style.background = tk.color; chip.style.color = '#fff'; }
    chip.addEventListener('click', () => {
      fxTrackChips.querySelectorAll('.track-chip').forEach(c => { c.classList.remove('active'); c.style.background = ''; c.style.color = ''; });
      chip.classList.add('active'); chip.style.background = tk.color; chip.style.color = '#fff';
      fxTrack = i; buildFxSends(i);
    });
    fxTrackChips.appendChild(chip);
  });

  function buildFxSends(idx) {
    const el = document.getElementById('fx-sends-knobs');
    if (el) el.innerHTML = '';
    const tk = SEQTRAK.TRACKS[idx];
    const row = Knob.buildRow([
      knobCC('REVERB', tk.ch, 91, 0, tk.color),
      knobCC('DELAY', tk.ch, 94, 0, tk.color),
    ], onKnobCC);
    if (el) el.appendChild(row);
  }

  // Master reverb knobs (UI-only until SysEx addresses mapped)
  const revRow = Knob.buildRow([
    { label: 'TIME', min: 0, max: 127, def: 64, color: 'var(--fb-cyan)' },
    { label: 'DIFFUSE', min: 0, max: 127, def: 64, color: 'var(--fb-cyan)' },
    { label: 'HI DAMP', min: 0, max: 127, def: 64, color: 'var(--fb-cyan)' },
    { label: 'MIX', min: 0, max: 127, def: 40, color: 'var(--fb-cyan)' },
  ], () => {});

  const dlyRow = Knob.buildRow([
    { label: 'TIME', min: 0, max: 127, def: 64, color: 'var(--fb-orange)' },
    { label: 'FBACK', min: 0, max: 127, def: 48, color: 'var(--fb-orange)' },
    { label: 'HI DAMP', min: 0, max: 127, def: 64, color: 'var(--fb-orange)' },
    { label: 'MIX', min: 0, max: 127, def: 32, color: 'var(--fb-orange)' },
  ], () => {});

  document.getElementById('fx-reverb-knobs').appendChild(revRow);
  document.getElementById('fx-delay-knobs').appendChild(dlyRow);
  buildFxSends(0);

  // ======================================================
  // SEQ PAGE
  // ======================================================
  const seqGrid = document.getElementById('seq-grid');
  const seqNums = document.getElementById('seq-step-numbers');
  const seqTrackChips = document.getElementById('seq-track-chips');
  let seqTrack = 0, seqLen = 16;
  const seqSteps = Array.from({ length: 11 }, () => new Array(32).fill(false));

  SEQTRAK.TRACKS.forEach((tk, i) => {
    const chip = document.createElement('button');
    chip.className = 'track-chip' + (i === 0 ? ' active' : '');
    chip.textContent = tk.name; chip.style.borderColor = tk.color; chip.dataset.track = i;
    if (i === 0) { chip.style.background = tk.color; chip.style.color = '#fff'; }
    chip.addEventListener('click', () => {
      seqTrackChips.querySelectorAll('.track-chip').forEach(c => { c.classList.remove('active'); c.style.background = ''; c.style.color = ''; });
      chip.classList.add('active'); chip.style.background = tk.color; chip.style.color = '#fff';
      seqTrack = i; renderSeq();
    });
    seqTrackChips.appendChild(chip);
  });

  function renderSeq() {
    seqGrid.innerHTML = ''; seqNums.innerHTML = '';
    const cols = seqLen;
    seqGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    seqNums.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    const tk = SEQTRAK.TRACKS[seqTrack];
    for (let s = 0; s < cols; s++) {
      const num = document.createElement('span');
      num.className = 'seq-step-num'; num.textContent = s + 1;
      seqNums.appendChild(num);

      const btn = document.createElement('button');
      btn.className = 'seq-step' + (seqSteps[seqTrack][s] ? ' on' : '');
      if (s % 4 === 0) btn.classList.add('beat-start');
      btn.dataset.step = s;
      btn.style.setProperty('--tk-color', tk.color);
      btn.addEventListener('click', () => {
        seqSteps[seqTrack][s] = !seqSteps[seqTrack][s];
        btn.classList.toggle('on');
      });
      seqGrid.appendChild(btn);
    }
  }
  renderSeq();

  document.querySelectorAll('.pattern-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pattern-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.querySelectorAll('.len-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.len-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      seqLen = parseInt(btn.dataset.len);
      renderSeq();
    });
  });

  document.getElementById('seq-play').addEventListener('click', () => MIDIManager.send(new Uint8Array([0xFA])));
  document.getElementById('seq-stop').addEventListener('click', () => MIDIManager.send(new Uint8Array([0xFC])));

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

  // ---- FX sub-page ----
  // Effect 1 knobs
  const fx1Knobs = Knob.buildRow([
    { label: 'TIME',     min: 0, max: 127, def: 64, color: 'var(--fb-cyan)' },
    { label: 'PRE-DLY',  min: 0, max: 127, def: 20, color: 'var(--fb-cyan)' },
    { label: 'HI DAMP',  min: 0, max: 127, def: 64, color: 'var(--fb-cyan)' },
    { label: 'MIX L',    min: 0, max: 127, def: 40, color: 'var(--fb-cyan)' },
    { label: 'MIX R',    min: 0, max: 127, def: 40, color: 'var(--fb-cyan)' },
    { label: 'EQ HIGH',  min: 0, max: 127, def: 64, color: 'var(--fb-cyan)' },
    { label: 'EQ LOW',   min: 0, max: 127, def: 64, color: 'var(--fb-cyan)' },
  ], () => {});
  document.getElementById('m1-fx1-knobs').appendChild(fx1Knobs);

  // Effect 2 knobs
  const fx2Knobs = Knob.buildRow([
    { label: 'DEPTH',   min: 0, max: 127, def: 0,  color: 'var(--fb-orange)' },
    { label: 'SPEED',   min: 0, max: 127, def: 13, color: 'var(--fb-orange)' },
    { label: 'WAVE',    min: 0, max: 127, def: 0,  color: 'var(--fb-orange)' },
    { label: 'DELAY',   min: 0, max: 127, def: 0,  color: 'var(--fb-orange)' },
    { label: 'MIX L',   min: 0, max: 127, def: 50, color: 'var(--fb-orange)' },
    { label: 'MIX R',   min: 0, max: 127, def: 50, color: 'var(--fb-orange)' },
    { label: 'EQ HIGH', min: 0, max: 127, def: 64, color: 'var(--fb-orange)' },
    { label: 'EQ LOW',  min: 0, max: 127, def: 64, color: 'var(--fb-orange)' },
  ], () => {});
  document.getElementById('m1-fx2-knobs').appendChild(fx2Knobs);

  // FX category tab clicks
  document.querySelectorAll('.m1-fx-cats').forEach(cats => {
    cats.querySelectorAll('.m1-fxcat').forEach(btn => {
      btn.addEventListener('click', () => {
        cats.querySelectorAll('.m1-fxcat').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  });

  // ---- Load sound ----
  function loadM1(sound) {
    m1Loaded = sound.id;
    m1LoadedName.textContent = `${sound.name} → ${m1Target === 7 ? 'SYN 1' : 'SYN 2'}`;

    // Update grid highlights
    m1Grid.querySelectorAll('.m1-grid-cell').forEach(c =>
      c.classList.toggle('loaded', parseInt(c.dataset.id) === sound.id));

    // Send program change
    const prog = sound.content - M1_SOUNDS.CONTENT_BASE;
    sendCC(m1Target, 0x00, 63);
    sendCC(m1Target, 0x20, 0);
    MIDIManager.send(new Uint8Array([0xC0 | m1Target, prog & 0x7F]));

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
      applyIncoming(pc.key, pc.value);
      return;
    }
    const st = data[0] & 0xF0, ch = data[0] & 0x0F;
    if (st === 0xB0) applyIncoming(`cc:${ch}:${data[1]}`, data[2]);
  };

  // read everything on screen once connected
  function syncAll() {
    const defs = [SEQTRAK.MASTER_VOLUME];
    SEQTRAK.TRACKS.forEach((t, p) => defs.push(SEQTRAK.P.volume(p), SEQTRAK.P.pan(p)));
    requestDefs(defs.concat(defsIn(sndGrid), defsIn(document.getElementById('page-dx'))));
    MIDIManager.send(SEQTRAK.buildRequest([0x30, 0x40, 0x76]));
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
