/* ============================================
   FULLBAN SEQ-TRAK — Main App v8
   MAIN MIX (mixer + sound), LAUNCH + SEQ (clips, 64 pads, chords, piano roll), DX, FX, M-ONE
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
    if (def.kind === 'sx' && def.rxcc !== undefined) keys.push(`cc:${def.rxch ?? (def.addr[1] & 0x0F)}:${def.rxcc}`);
    if (def.rd) { w._rdKey = sxKey(def.rd); w._rdConv = def.rdConv; keys.push(w._rdKey); }
    keys.forEach(k => { if (!REG.has(k)) REG.set(k, new Set()); REG.get(k).add(w); });
    w._keys = keys;
    return w;
  }
  function unreg(container) {
    container.querySelectorAll('.knob-wrap, .fb-fader').forEach(w => (w._keys || []).forEach(k => REG.get(k) && REG.get(k).delete(w)));
  }
  function applyIncoming(key, value, data) {
    const set = REG.get(key);
    if (!set) return false;
    const now = performance.now();
    // don't let the unit's echo of an older value pull a control back while (or just after) it's being moved
    set.forEach(w => {
      if (!document.body.contains(w) || (w._touched && now - w._touched < 700)) return;
      w.setValue(w._rdKey === key && w._rdConv && data ? w._rdConv(data) : value);
    });
    return true;
  }
  ['pointerdown', 'pointermove', 'wheel'].forEach(ev => document.addEventListener(ev, e => {
    const w = e.target && e.target.closest && e.target.closest('.knob-wrap, .fb-fader');
    if (w && (ev !== 'pointermove' || e.buttons)) w._touched = performance.now();
  }, { capture: true, passive: true }));
  const sxKey = a => 'sx:' + a.map(b => b.toString(16).padStart(2, '0')).join('');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function sendDefRaw(def, v) { SEQTRAK.messagesFor(def, v).forEach(m => MIDIManager.send(m)); }
  // every knob/fader move goes through here: send it, and remember it for that track's sound
  function sendDef(def, v) { sendDefRaw(def, v); recordEdit(def, v); }

  // ---- REMEMBERED EDITS: what you changed on a sound stays with that sound (per track) until RESET ----
  const EDITS_KEY = 'fbSoundEdits';
  let soundEdits = {};
  try { soundEdits = JSON.parse(localStorage.getItem(EDITS_KEY) || '{}') || {}; } catch (e) { soundEdits = {}; }
  const curSound = new Array(11).fill(null);       // 01 1p 33: catalogue number - 1, per part
  let editsHold = false;                           // true while the app is scanning sounds (don't re-apply edits)
  let editsTimer = null;
  const saveEdits = () => { clearTimeout(editsTimer); editsTimer = setTimeout(() => { try { localStorage.setItem(EDITS_KEY, JSON.stringify(soundEdits)); } catch (e) {} }, 400); };
  const editSlot = p => (curSound[p] == null ? null : p + ':' + curSound[p]);
  function partOfDef(def) {                        // which track's SOUND a parameter belongs to (null = not a sound parameter)
    if (def.kind === 'cc') return def.rd ? def.ch : null;
    const h = def.addr[0], m = def.addr[1];
    if (h === 0x31) return m & 0x0F;
    if (h === 0x48 || h === 0x49) return 9;
    return null;
  }
  function recordEdit(def, v) {
    const p = partOfDef(def); if (p == null) return;
    const slot = editSlot(p); if (!slot) return;
    (soundEdits[slot] = soundEdits[slot] || {})[SEQTRAK.keyOf(def)] = v;
    saveEdits(); paintEdited(p);
  }
  function sendKey(key, v) {
    if (key.startsWith('sx:')) MIDIManager.send(SEQTRAK.buildParam([0, 1, 2].map(i => parseInt(key.slice(3 + 2 * i, 5 + 2 * i), 16)), v));
    else { const k = key.split(':'); MIDIManager.send(SEQTRAK.buildCC(+k[1], +k[2], v)); }
  }
  const hasEdits = p => { const e = soundEdits[editSlot(p)]; return !!e && Object.keys(e).length > 0; };
  function paintEdited(p) { document.querySelectorAll(`.reset-btn[data-track="${p}"]`).forEach(b => b.classList.toggle('edited', hasEdits(p))); }
  function resetButton(p, label) {
    const b = document.createElement('button');
    b.className = 'reset-btn' + (hasEdits(p) ? ' edited' : ''); b.dataset.track = p;
    b.textContent = label || 'RESET'; b.title = 'Put this sound back to how the preset comes';
    b.onclick = () => resetSound(p);
    return b;
  }

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
    defs.forEach(d => { if (d && d.kind === 'sx') reqQueue.push(d.addr); else if (d && d.rd) reqQueue.push(d.rd); });
    if (!reqTimer) reqTimer = setInterval(() => {
      if (!MIDIManager.isConnected()) return;
      const batch = reqQueue.splice(0, 6);
      batch.forEach(a => MIDIManager.send(SEQTRAK.buildRequest(a)));
      if (!reqQueue.length) { clearInterval(reqTimer); reqTimer = null; }
    }, 35);
  }
  function defsIn(container) {
    const out = [];
    container.querySelectorAll('.knob-wrap, .fb-fader').forEach(w => { if (w.opts && (w.opts.kind === 'sx' || w.opts.rd)) out.push(w.opts); });
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

  // master strip: the SEQTRAK has two masters - speaker (00 00 00) and headphones/line out (00 00 01).
  // The fader drives whichever one is in use: the unit reports when a lead is plugged in (01 10 07).
  const masterStrip = document.createElement('div');
  let hpPlugged = false;
  function setPlug(v) {
    hpPlugged = !!v;
    masterStrip.classList.toggle('phones', hpPlugged);
    masterStrip.querySelector('.main-out').textContent = hpPlugged ? 'PHONES' : 'SPEAKER';
  }
  {
    const s = masterStrip;
    s.className = 'strip strip-master';
    s.style.setProperty('--kc', '#ffffff');
    s.innerHTML = `<div class="strip-name">MAIN</div><button class="strip-snd main-out" title="Tap to switch between the speaker and the headphone/line output">SPEAKER</button><div class="strip-spacer"></div>`;
    [[SEQTRAK.MASTER_VOLUME, 'spk'], [SEQTRAK.HP_VOLUME, 'hp']].forEach(([def, id]) => {
      const box = document.createElement('div'); box.className = 'main-fader main-' + id;
      const f = reg(def, Fader(def, '#cfe3ff', v => sendDef(def, v)));
      const ro = document.createElement('div'); ro.className = 'strip-val';
      f.onDraw = v => { ro.textContent = v; };
      box.append(f, ro); s.appendChild(box);
    });
    s.querySelector('.main-out').onclick = () => setPlug(!hpPlugged);
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

  // ONE selected track for the whole app (mix, sequencer, FX, M-One) and for the unit itself
  const trackSelHooks = [];
  function selectTrack(p, fromUnit) {
    if (!(p >= 0 && p <= 10)) return;
    const changed = p !== selTrack;
    selTrack = p;
    stripsEl.querySelectorAll('.strip').forEach(s => s.classList.toggle('sel', +s.dataset.track === p));
    buildSound(p);
    if (!fromUnit && MIDIManager.isConnected()) MIDIManager.send(SEQTRAK.buildParam(SEQTRAK.CURRENT_PART, p));
    trackSelHooks.forEach(fn => { try { fn(p, changed); } catch (e) { console.warn(e); } });
  }
  document.querySelector('.tab[data-page="dx"]').addEventListener('click', () => { if (selTrack !== 9) selectTrack(9); });
  document.querySelector('.tab[data-page="m1"]').addEventListener('click', () => { if (typeof m1Target === 'number' && selTrack !== m1Target) selectTrack(m1Target); });

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
      go.className = 'snd-head-go'; go.textContent = 'DX EDITOR ▸';
      go.onclick = () => document.querySelector('.tab[data-page="dx"]').click();
      sndHead.appendChild(go);
    }
    sndHead.appendChild(resetButton(p));
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
    setSoundName(p, E.list[k][0]);
    onSoundChanged(p);            // reads back the number + name, puts your saved edits back, then the knobs follow
  }
  function stepPreset(p, d) {
    const E = PRESETS[presetEngine(p)];
    let n = curSound[p] != null && curSound[p] + 1 >= E.first && curSound[p] + 1 < E.first + E.list.length ? curSound[p] + 1 : curPreset[p];
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
  document.getElementById('dx-op-switch').appendChild(resetButton(9, 'RESET DX'));
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
    const ln = document.querySelector(`.lg-track[data-track="${p}"] small`); if (ln) ln.textContent = name || '—';
    if (typeof seqMode !== 'undefined' && seqMode === 'step' && typeof isDrumPart === 'function' && isDrumPart(p) && isDrumPart(seqTrack)) { const pr = seqBody.querySelector('.pad-row'); if (pr) pr.replaceWith(padRow()); }
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
    pcTimers[p] = setTimeout(() => soundLoaded(p), 220);
  }
  async function readSoundNo(p) {
    const d = await askRetry(SEQTRAK.CURRENT_SOUND(p), 500, 2);
    if (d && d.length >= 2) curSound[p] = (d[0] << 7) | d[1];
    return curSound[p];
  }
  function refreshKnobs(p) {                       // the knobs follow what the unit now holds
    if (p === selTrack) requestDefs(defsIn(sndGrid));
    if (p === 9) requestDefs(defsIn(document.getElementById('page-dx')));
    if (p === m1Target) requestDefs(defsIn(m1QE).concat(defsIn(m1SN)));
    paintEdited(p);
  }
  async function soundLoaded(p) {
    if (editsHold) return;
    await readSoundNo(p);
    await fetchName(p);
    const e = soundEdits[editSlot(p)];
    if (e) { Object.entries(e).forEach(([k, v]) => sendKey(k, v)); await sleep(150); }   // your edits for this sound come back
    refreshKnobs(p);
  }
  // Load by sound number n = what 01 1p 33 reads for that sound, and check what landed.
  // Factory sounds (n < 4096, catalogue number - 1): bank LSB = n >> 7, program = n & 127.
  // User sounds (n = their content number, 4096 up) sit in the user banks (LSB 32+) in number order:
  // slot = n - 4096 on this unit (measured 25 Nov); if sounds get deleted the offset is found by reading back.
  const USERBASE_KEY = 'fbUserBase2';
  let userBase = parseInt(localStorage.getItem(USERBASE_KEY), 10) || 4096;
  async function loadContent(p, c) {
    let base = userBase;
    for (let t = 0; t < 4; t++) {
      const slot = c - base;
      const tri = c < 4096 ? [c >> 7, c & 127] : (slot >= 0 ? [32 + (slot >> 7), slot & 127] : null);
      if (!tri) { base = c; continue; }
      SEQTRAK.loadSound(p, 63, tri[0], tri[1]).forEach(m => MIDIManager.send(m));
      await sleep(280);
      const d = await askRetry(SEQTRAK.CURRENT_SOUND(p), 600, 3);
      if (!d || d.length < 2) continue;
      const got = (d[0] << 7) | d[1];
      curSound[p] = got;
      if (got === c) { if (base !== userBase) { userBase = base; try { localStorage.setItem(USERBASE_KEY, String(base)); } catch (e) {} } return true; }
      if (c < 4096 || got < 4096) return false;
      base += got - c;                              // slot was off by (got - c): correct and try again
    }
    return false;
  }
  // RESET: forget the saved edits for this track's sound and load the sound fresh (a reload clears every
  // offset on the unit - checked on hardware), then the knobs read the preset's own values back.
  async function resetSound(p) {
    if (!MIDIManager.isConnected()) return;
    if (curSound[p] == null) await readSoundNo(p);
    const slot = editSlot(p);
    if (slot && soundEdits[slot]) { delete soundEdits[slot]; saveEdits(); }
    editsHold = true;
    try { if (curSound[p] != null) await loadContent(p, curSound[p]); } finally { editsHold = false; }
    await sleep(120);
    fetchName(p);
    refreshKnobs(p);
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
    c.onclick = () => selectTrack(i);
    fxChips.appendChild(c);
  });
  fxTrackWrap.append(fxChips, fxTrackBody);
  fxGrid.appendChild(section('TRACK FX + SENDS', '#2d8cf0', fxTrackWrap, 'fx-sec wide'));
  buildFxTrack();
  trackSelHooks.push(p => { if (p !== fxTrack) { fxTrack = p; buildFxTrack(); if (!document.getElementById('page-fx').classList.contains('hidden')) requestDefs(defsIn(fxTrackBody)); } });
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
      chip.onclick = () => selectTrack(i);
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
      for (let s = 0; s < Math.min(seqLen, 64); s++) { if (tok !== readToken) return; await readStep(p, s); }
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
    unreg(seqBody);
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
    const grid = document.createElement('div'); grid.className = 'pad64';
    for (let s = 0; s < 64; s++) {
      const btn = document.createElement('button');
      btn.className = 'seq-step' + (s % 4 === 0 ? ' beat-start' : '') + (s % 16 === 0 ? ' bar-start' : '') + (s >= seqLen ? ' off' : '');
      btn.dataset.step = s;
      btn.style.setProperty('--tk-color', tk.color);
      btn.innerHTML = `<i>${s + 1}</i><span></span>`;
      btn.onclick = () => { if (s < seqLen) toggleStep(s); };
      grid.appendChild(btn);
    }
    seqBody.appendChild(grid);
    seqBody.appendChild(padRow());
    for (let s = 0; s < Math.min(seqLen, 64); s++) paintStep(p, s);
    if (!seqMsg.textContent || seqMsg.dataset.auto) {
      seqMsg.dataset.auto = 1;
      seqMsg.textContent = drum ? 'Tap a pad to add or remove a hit. Bottom row: tap a drum to hear it and switch to it.'
        : 'Bottom row: pick a note, then tap pads to place it. Tap a lit pad to clear it.';
    }
  }
  // bottom row of pads: the drum tracks (drum track selected) or a chromatic octave (synth / DX / sampler)
  function padRow() {
    const p = seqTrack, w = document.createElement('div'); w.className = 'pad-row';
    const mk = (html, cls, fn, color) => { const b = document.createElement('button'); b.className = 'pad ' + cls; b.innerHTML = html; if (color) b.style.setProperty('--kc', color); b.onclick = fn; w.appendChild(b); return b; };
    if (isDrumPart(p)) {
      SEQTRAK.TRACKS.forEach((tk, i) => {
        if (!isDrumPart(i)) return;
        mk(`<b>${trackShort(i)}</b><small>${soundNames[i] || ''}</small>`, 'drum' + (i === p ? ' on' : ''), () => { previewNotes([60], i, 200); if (i !== seqTrack) selectTrack(i); }, tk.color);
      });
    } else {
      const base = Math.floor(pickNote / 12) * 12, color = SEQTRAK.TRACKS[p].color;
      mk('◀ OCT', 'oct', () => { pickNote = Math.max(0, pickNote - 12); renderSeq(); });
      for (let n = base; n <= base + 12 && n <= 127; n++) {
        const black = NOTE_NAMES[n % 12].includes('#');
        mk(`<b>${noteName(n)}</b>`, 'note' + (black ? ' black' : '') + (n === pickNote ? ' on' : ''), () => { pickNote = n; previewNotes([n], p, 250); renderSeq(); }, color);
      }
      mk('OCT ▶', 'oct', () => { pickNote = Math.min(115, pickNote + 12); renderSeq(); });
    }
    return w;
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
  // ======================= CHORDS =======================
  const SCALES = { 'Major': [0, 2, 4, 5, 7, 9, 11], 'Minor': [0, 2, 3, 5, 7, 8, 10], 'Dorian': [0, 2, 3, 5, 7, 9, 10], 'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
    'Phrygian': [0, 1, 3, 5, 7, 8, 10], 'Lydian': [0, 2, 4, 6, 7, 9, 11], 'Harm Minor': [0, 2, 3, 5, 7, 8, 11], 'Melodic Minor': [0, 2, 3, 5, 7, 9, 11] };
  const CHORD_TYPES = { 'TRIAD': [0, 2, 4], '7TH': [0, 2, 4, 6], '9TH': [0, 2, 4, 6, 8], 'SUS2': [0, 1, 4], 'SUS4': [0, 3, 4], '6TH': [0, 2, 4, 5], 'POWER': 'power' };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const cs = { key: 0, scale: 'Minor', type: '7TH', oct: 3, inv: 0, spread: false, len: 4, brush: null, genre: 'Piano House', prog: 0 };
  try { Object.assign(cs, JSON.parse(localStorage.getItem('fbChordSettings') || '{}'), { brush: null }); } catch (e) {}
  const saveCs = () => { try { const { brush, ...keep } = cs; localStorage.setItem('fbChordSettings', JSON.stringify(keep)); } catch (e) {} };

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
  // ---- the SEQTRAK's own chord mode: 7 chords (up to 4 notes each) per scale, per track (SYNTH 1/2, DX) ----
  const proj = { scale: 0, key: 0 };                      // project scale 30 40 7E (0-7), key 30 40 7F (0-11)
  const chordSets = {};                                   // 'part:scale' -> 7 x [n1, n2, n3, n4] as stored (0 = no note)
  let chordPad = 0, chordTok = 0;
  const chordKey = p => p + ':' + proj.scale;
  const hasChords = p => p >= 7 && p <= 9;
  async function readChords(p) {
    const tok = ++chordTok;
    const sc = await askRetry(SEQTRAK.SCALE.addr, 450, 2); if (sc && sc.length) proj.scale = sc[0] & 7;
    const ky = await askRetry(SEQTRAK.KEY.addr, 450, 2); if (ky && ky.length) proj.key = Math.max(0, Math.min(11, ky[0] - 0x40));
    const set = [];
    for (let pad = 0; pad < 7; pad++) {
      const notes = [];
      for (let n = 0; n < 4; n++) {
        if (tok !== chordTok) return;
        const d = await askRetry(SEQTRAK.CHORD_NOTE(p, proj.scale, pad, n), 400, 2);
        notes.push(d && d.length ? d[0] : 0);
      }
      set.push(notes);
    }
    chordSets[chordKey(p)] = set;
    if (seqMode === 'chords' && p === seqTrack) renderSeq();
  }
  // notes a chord pad plays (the project key moves every chord up, like the unit's keys)
  const chordNotes = (p, pad) => (((chordSets[chordKey(p)] || [])[pad]) || []).filter(n => n > 0).map(n => Math.min(127, n + proj.key));
  function renderChords() {
    const p = seqTrack, tk = SEQTRAK.TRACKS[p];
    if (!hasChords(p)) { seqMsg.textContent = 'The SEQTRAK has chords on SYNTH 1, SYNTH 2 and DX - pick one of those tracks.'; return; }
    const set = chordSets[chordKey(p)];
    if (!set) {
      seqMsg.textContent = MIDIManager.isConnected() ? 'Reading the chords from the SEQTRAK...' : 'Connect the SEQTRAK to see its chords.';
      if (MIDIManager.isConnected()) readChords(p);
      return;
    }
    seqMsg.textContent = 'These are the 7 chords on the SEQTRAK\'s own keys (CHORD mode). Tap a chord to hear it, then tap a step to put it in the pattern. Tap a chord in the pattern to remove it.';
    const wrap = document.createElement('div'); wrap.className = 'chd';
    const ctl = document.createElement('div'); ctl.className = 'chd-ctl';
    // CHORD mode on the unit for this track (31 1p 23 = 2): its keys then play these chords
    const modeDef = SEQTRAK.P.monoPoly(p);
    const modeT = Knob.toggle('CHORD MODE ON UNIT', false, v => sendDef(modeDef, v ? 2 : 1));
    modeT.setValue = v => modeT.setOn(v === 2); modeT.opts = modeDef; modeT.classList.add('knob-wrap'); reg(modeDef, modeT);
    ctl.appendChild(modeT);
    const sel = (label, opts, val, fn) => {
      const l = document.createElement('label'); l.className = 'chd-sel'; l.innerHTML = `<span>${label}</span>`;
      const s = document.createElement('select');
      opts.forEach(([v, t]) => { const op = document.createElement('option'); op.value = v; op.textContent = t; if (String(v) === String(val)) op.selected = true; s.appendChild(op); });
      s.onchange = () => fn(s.value); l.appendChild(s); ctl.appendChild(l);
    };
    sel('KEY', NOTE_NAMES.map((n, i) => [i, n]), proj.key, v => { proj.key = +v; cs.key = +v; sendDefRaw(SEQTRAK.KEY, 0x40 + proj.key); renderSeq(); });
    sel('SCALE', [0, 1, 2, 3, 4, 5, 6, 7].map(i => [i, 'SCALE ' + (i + 1)]), proj.scale, v => { proj.scale = +v; sendDefRaw(SEQTRAK.SCALE, proj.scale); renderSeq(); });
    sel('LENGTH', [1, 2, 4, 8, 16].map(n => [n, n + (n === 1 ? ' STEP' : ' STEPS')]), cs.len, v => { cs.len = +v; saveCs(); });
    const clr = document.createElement('button'); clr.className = 'chd-clear'; clr.textContent = 'CLEAR PATTERN';
    clr.onclick = () => { if (confirm('Clear every note on this track\'s pattern?')) rollEdit(p, rollEvents[p] || [], []); };
    ctl.appendChild(clr);
    wrap.appendChild(ctl);
    // the 7 chord pads
    const pads = document.createElement('div'); pads.className = 'chd-pads';
    for (let d = 0; d < 7; d++) {
      const notes = chordNotes(p, d);
      const b = document.createElement('button');
      b.className = 'chd-pad' + (d === chordPad ? ' on' : '');
      b.style.setProperty('--kc', tk.color);
      b.innerHTML = `<i>CHORD ${d + 1}</i><b>${notes.length ? chordName(notes) : '—'}</b><small>${notes.map(noteName).join(' ')}</small>`;
      b.onclick = () => { chordPad = d; if (notes.length) previewNotes(notes, p, 600); renderSeq(); };
      pads.appendChild(b);
    }
    wrap.appendChild(pads);
    // change the notes of the picked chord (written straight to the SEQTRAK)
    const ed = document.createElement('div'); ed.className = 'chd-edit';
    ed.innerHTML = `<span class="chd-lbl">CHORD ${chordPad + 1} NOTES</span>`;
    set[chordPad].forEach((raw, n) => {
      const box = document.createElement('div'); box.className = 'chd-note' + (raw ? '' : ' off');
      const write = v => {
        set[chordPad][n] = v;
        MIDIManager.send(SEQTRAK.buildParam(SEQTRAK.CHORD_NOTE(p, proj.scale, chordPad, n), v));
        const now = chordNotes(p, chordPad); if (now.length) previewNotes(now, p, 500);
        renderSeq();
      };
      const mk = (t, fn) => { const x = document.createElement('button'); x.textContent = t; x.onclick = fn; box.appendChild(x); return x; };
      mk('−', () => write(Math.max(0x24, (raw || 0x3C) - 1)));
      const nm = document.createElement('b'); nm.textContent = raw ? noteName(Math.min(127, raw + proj.key)) : 'OFF'; box.appendChild(nm);
      mk('+', () => write(Math.min(0x60, (raw || 0x3B) + 1)));
      mk(raw ? 'OFF' : 'ON', () => write(raw ? 0 : 0x3C)).className = 'chd-off';
      ed.appendChild(box);
    });
    wrap.appendChild(ed);
    // timeline
    const tl = document.createElement('div'); tl.className = 'chd-tl';
    tl.style.gridTemplateColumns = `repeat(${seqLen}, 1fr)`;
    for (let s = 0; s < seqLen; s++) {
      const c = document.createElement('button'); c.className = 'chd-cell' + (s % 4 === 0 ? ' beat' : '');
      c.style.gridColumn = `${s + 1}`; c.textContent = s + 1;
      c.onclick = () => { const notes = chordNotes(p, chordPad); if (notes.length) placeChord(s, notes, Math.min(cs.len, seqLen - s)); };
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
  const launchVisible = () => !document.getElementById('page-launch').classList.contains('hidden');
  trackSelHooks.push(p => {
    seqTrack = p; buildSeqChips();
    if (typeof paintLaunchSel === 'function') paintLaunchSel();
    if (launchVisible() && MIDIManager.isConnected()) loadTrack(); else renderSeq();
  });
  seqTrack = selTrack;
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
  // tracks across the top (they are also the track selector for the sequencer underneath), 6 scenes down:
  // scene n = every track on its pattern n
  const sceneOn = n => patSel.every(v => v === n);
  function paintScenes() { launchGrid.querySelectorAll('.lg-scene').forEach(b => b.classList.toggle('on', sceneOn(+b.dataset.scene))); }
  function paintLaunchSel() { launchGrid.querySelectorAll('.lg-track').forEach(c => c.classList.toggle('sel', +c.dataset.track === selTrack)); }
  function renderLaunch() {
    launchGrid.innerHTML = '';
    const head = document.createElement('div'); head.className = 'lg-row lg-head';
    head.innerHTML = '<div class="lg-corner">SCENES</div>';
    SEQTRAK.TRACKS.forEach((tk, p) => {
      const c = document.createElement('div');
      c.className = 'lg-track' + (p === selTrack ? ' sel' : ''); c.dataset.track = p; c.style.setProperty('--kc', tk.color);
      c.innerHTML = `<button class="lg-name"><b>${trackShort(p)}</b><em>${typeName(p)}</em><small>${soundNames[p] || '—'}</small></button>` +
        `<div class="lg-ms"><button class="lr-m${muted[p] ? ' on' : ''}" data-track="${p}">M</button><button class="lr-s${soloPart === p ? ' on' : ''}" data-track="${p}">S</button></div>`;
      c.querySelector('.lg-name').onclick = () => selectTrack(p);
      c.querySelector('.lr-m').onclick = () => setMute(p, !muted[p]);
      c.querySelector('.lr-s').onclick = () => setSolo(p);
      head.appendChild(c);
    });
    launchGrid.appendChild(head);
    for (let n = 0; n < 6; n++) {
      const r = document.createElement('div'); r.className = 'lg-row';
      const sb = document.createElement('button'); sb.className = 'lg-scene' + (sceneOn(n) ? ' on' : ''); sb.dataset.scene = n;
      sb.innerHTML = `▶ <b>${n + 1}</b>`;
      sb.onclick = () => launchScene(n);
      r.appendChild(sb);
      SEQTRAK.TRACKS.forEach((tk, p) => {
        const c = document.createElement('button');
        c.className = 'lr-clip' + (patSel[p] === n ? ' on' : '');
        c.dataset.track = p; c.dataset.pat = n; c.style.setProperty('--kc', tk.color);
        c.innerHTML = `<span>${n + 1}</span>`;
        c.onclick = () => launchClip(p, n);
        r.appendChild(c);
      });
      launchGrid.appendChild(r);
    }
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
    const was = patSel[p];
    if (d && d.length) patSel[p] = d[0];
    paintClips(p);
    if (p === seqTrack && was !== patSel[p]) { steps[p].fill(null); rollEvents[p] = null; loadTrack(); }   // the sequencer shows the pattern now playing
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
  onTracks(renderLaunch);
  document.querySelector('.tab[data-page="launch"]').addEventListener('click', async () => {
    renderLaunch();
    if (!MIDIManager.isConnected()) { renderSeq(); return; }
    MIDIManager.send(SEQTRAK.buildRequest([0x30, 0x40, 0x76]));
    for (let p = 0; p < 11; p++) await confirmPattern(p);
    loadTrack();
  });
  document.getElementById('clips-toggle').onclick = e => { const c = launchGrid.classList.toggle('collapsed'); e.currentTarget.textContent = c ? 'CLIPS ▾' : 'CLIPS ▴'; };
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
      b.onclick = () => { if (p === selTrack) setM1Target(p); else selectTrack(p); };
      m1TargetEl.appendChild(b);
    });
    placeM1Reset();
  }
  function placeM1Reset() {
    document.querySelectorAll('.m1-learn .reset-btn').forEach(b => b.remove());
    document.querySelector('.m1-learn').appendChild(resetButton(m1Target, 'RESET SOUND'));
  }
  function setM1Target(p) {
    if (p === m1Target || trackType[p] !== 2) return;
    m1Target = p;
    m1TargetEl.querySelectorAll('.m1-target-btn').forEach(x => x.classList.toggle('active', +x.dataset.track === p));
    placeM1Reset();
    m1TargetHooks.forEach(fn => fn());
  }
  trackSelHooks.push(p => setM1Target(p));
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
    if (cat === 2) return { type: { kind: 'sx', addr: SEQTRAK.INS_TYPE(p), label: 'TYPE' }, knobs: F.trackP(p) };
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
  document.querySelector('.m1-subtab[data-m1page="lib"]').addEventListener('click', () => { buildM1Fx(0); buildM1Fx(1); });
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
  // The 100 M1 sounds are user sounds with fixed catalogue numbers (4210-4309). They are loaded by number:
  // the app sends the user-bank slot, reads back which number landed (01 1p 33) and corrects itself, so every
  // sound loads without a LEARN pass. One load at a time; a newer pick replaces one still waiting.
  const learnBtn = document.getElementById('m1-learn');
  const learnStatus = document.getElementById('m1-learn-status');
  let loadChain = Promise.resolve(), loadTok = 0;
  function queueLoad(p, c) {
    const tok = ++loadTok;
    const run = async () => {
      if (tok !== loadTok) return null;                      // superseded while waiting
      editsHold = true;
      try { return await loadContent(p, c); } finally { editsHold = false; }
    };
    loadChain = loadChain.then(run, run);
    return loadChain.then(ok => (tok === loadTok ? ok : null));
  }
  learnBtn.textContent = 'CHECK M1';
  learnBtn.addEventListener('click', async () => {
    if (!MIDIManager.isConnected()) { learnStatus.textContent = 'Connect to the SEQTRAK first'; return; }
    const p = m1Target, was = curSound[p];
    learnStatus.textContent = 'Checking the M1 sounds on the SEQTRAK...';
    const first = await queueLoad(p, M1_SOUNDS.getById(0).content);
    const last = await queueLoad(p, M1_SOUNDS.getById(99).content);
    learnStatus.textContent = first && last ? 'All 100 M1 sounds found on the SEQTRAK' : 'The M1 sounds were not found where expected - are they still on this SEQTRAK?';
    if (was != null) await queueLoad(p, was);
    soundLoaded(p);
  });
  learnStatus.textContent = '';

  async function loadM1(sound) {
    m1Loaded = sound.id;
    if (typeof renderPresetGrid === 'function') renderPresetGrid();
    const p = m1Target;
    if (!MIDIManager.isConnected()) { m1LoadedName.textContent = `${sound.name} - connect the SEQTRAK`; return; }
    m1LoadedName.textContent = `${sound.name} → ${trackShort(p)}`;
    const ok = await queueLoad(p, sound.content);
    if (ok === null) return;                                 // a newer pick took over
    if (!ok) m1LoadedName.textContent = `${sound.name}: the SEQTRAK loaded something else - tap CHECK M1`;
    await soundLoaded(p);
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
  // M1 effect -> the nearest SEQTRAK effect [type MSB, LSB] (effect-types table). Reverbs go to the send reverb,
  // delays to the send delay, everything else to the track's own effect (Insertion A).
  const M1REV = { 0: [1, 0x03], 1: [1, 0x00], 2: [1, 0x01], 3: [1, 0x13], 4: [1, 0x10], 5: [1, 0x12], 6: [1, 0x11], 7: [1, 0x11], 8: [1, 0x11] };
  const M1DLY = { 9: [2, 0x40], 10: [2, 0x00] };
  const M1INS = { 11: [3, 0x20], 12: [3, 0x00], 13: [4, 0x10], 14: [4, 0x00], 15: [5, 0x10], 16: [5, 0x00], 17: [6, 0x10], 18: [6, 0x10],
    20: [7, 0x00], 21: [7, 0x20], 23: [3, 0x30], 24: [6, 0x20] };
  const M1DUAL2 = [0, 3, 6, 9, 11, 13, 16, 18];             // second half of Delay/Hall ... Delay/Tremolo
  function applyM1Fx(d, part) {
    const P = SEQTRAK.P, F = SEQTRAK.FX;
    let rev = null, dly = null, ins = null, revSend = 0, dlySend = 0;
    const names = [];
    [0, 1].forEach(k => {
      const t = d.fx.type[k];
      if (t >= 33 || !d.fx.on[k]) return;
      names.push(M1Lib.FX_NAMES[t]);
      const amt = Math.round(d.fx.bal[k] * 0.9);             // M1 balance 0-100 -> send level
      (t >= 25 ? [9, M1DUAL2[t - 25]] : [t]).forEach(u => {
        if (M1REV[u]) { rev = rev || M1REV[u]; revSend = Math.max(revSend, amt); }
        else if (M1DLY[u]) { dly = dly || M1DLY[u]; dlySend = Math.max(dlySend, amt); }
        else if (M1INS[u]) ins = ins || M1INS[u];
      });
    });
    if (rev) MIDIManager.send(SEQTRAK.buildParamData(F.revType.addr, rev));
    if (dly) MIDIManager.send(SEQTRAK.buildParamData(F.dlyType.addr, dly));
    if (ins) MIDIManager.send(SEQTRAK.buildParamData(SEQTRAK.INS_TYPE(part), ins));
    sendDefRaw(P.reverb(part), Math.min(127, revSend));
    sendDefRaw(P.delay(part), Math.min(127, dlySend));
    // show what was set in the two effect panels
    m1FxCat[0] = 0; m1FxCat[1] = ins && !dly ? 2 : 1;
    [0, 1].forEach(panel => document.getElementById(`m1-fx${panel + 1}-cats`).querySelectorAll('.m1-fxcat').forEach((b, i) => b.classList.toggle('active', i === m1FxCat[panel])));
    return names;
  }
  async function applyProgram(bank, k) {
    const p = bank.progs[k], d = M1Lib.describe(p), part = m1Target;
    if (d.mode === 2) { libInfo.textContent = `${d.name}: M1 drum programs aren't supported on the SEQTRAK yet.`; return; }
    const ms = M1_SOUNDS.getById(d.ms1);
    if (!ms) { libInfo.textContent = `${d.name} uses multisound ${d.ms1}, which isn't one of the 100 on the SEQTRAK.`; return; }
    if (!MIDIManager.isConnected()) { libInfo.textContent = 'Connect the SEQTRAK first.'; return; }
    libLoadedKey = bank.name + '#' + k;
    m1LoadedName.textContent = `${d.name} (${bank.name}) → ${trackShort(part)}`;
    renderLib();
    const ok = await queueLoad(part, ms.content);
    if (ok === null) return;
    if (!ok) { libInfo.textContent = `${d.name}: couldn't load "${ms.name}" on the SEQTRAK - tap CHECK M1 on the PLAY tab.`; return; }
    M1Lib.paramsFor(d, part).forEach(([def, v]) => sendDefRaw(def, v));
    const fx = applyM1Fx(d, part);
    await sleep(250);
    fetchName(part);
    refreshKnobs(part);
    buildM1Fx(0); buildM1Fx(1);
    libInfo.textContent = `${d.name}: ${ms.name}${d.mode === 1 ? ' (double program - OSC 1 only for now)' : ''} · FX: ${fx.length ? fx.join(' + ') : 'none'} · cutoff ${d.cutoff}, EG int ${d.egInt}${d.oct1 ? ', octave ' + (d.oct1 > 0 ? '+' : '') + d.oct1 : ''}`;
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
        if (p < 11 && st < 128) { steps[p][st] = d.length >= 6 ? { note: d[0], vel: d[1], gate: (d[4] << 7) | d[5] } : false; paintStep(p, st); }
      }
      if (pc.key === 'sx:011027' && pc.data.length) { if (pc.data[0] !== selTrack) selectTrack(pc.data[0], true); }      // track picked on the unit
      else if (pc.key === 'sx:011007' && pc.data.length) setPlug(pc.data[0]);                                            // headphones / line lead in or out
      else if (pc.key === 'sx:30407e' && pc.data.length && (pc.data[0] & 7) !== proj.scale) { proj.scale = pc.data[0] & 7; if (seqMode === 'chords') renderSeq(); }
      else if (pc.key === 'sx:30407f' && pc.data.length) { const k = Math.max(0, Math.min(11, pc.data[0] - 0x40)); if (k !== proj.key) { proj.key = k; if (seqMode === 'chords') renderSeq(); } }
      if (pc.addr[0] === 0x30 && pc.addr[2] === 0x00 && pc.addr[1] >= 0x41 && pc.addr[1] <= 0x45 && pc.data.length >= 2) {
        setTypeName(pc.key, SEQTRAK.fxTypeName(pc.data[0], pc.data[1]));
      }
      if (pc.data.length) applyIncoming(pc.key, pc.value, pc.data);
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
    const defs = [SEQTRAK.MASTER_VOLUME, SEQTRAK.HP_VOLUME];
    MIDIManager.send(SEQTRAK.buildRequest(SEQTRAK.HP_PLUG));
    MIDIManager.send(SEQTRAK.buildRequest(SEQTRAK.CURRENT_PART));
    SEQTRAK.TRACKS.forEach((t, p) => defs.push(SEQTRAK.P.volume(p), SEQTRAK.P.pan(p)));
    requestDefs(defs.concat(defsIn(sndGrid), defsIn(document.getElementById('page-dx'))));
    MIDIManager.send(SEQTRAK.buildRequest([0x30, 0x40, 0x76]));
    (async () => { await readTypes(); for (let p = 0; p < 11; p++) { await readSoundNo(p); await fetchName(p); paintEdited(p); } if (launchVisible()) loadTrack(); })();
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
