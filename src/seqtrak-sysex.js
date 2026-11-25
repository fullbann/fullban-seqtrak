/* ============================================
   FULLBAN SEQ-TRAK — SysEx / CC parameter map
   Every address and CC here is from Yamaha's SEQTRAK Data List as compiled in
   jaeggerr/seqtrak-docs (03a/03c/03d/03f, data/cc-map.csv). Rows marked
   'hw' were also read back on a real unit there. No guessed addresses.
   ============================================ */

const SEQTRAK = (() => {

  const YAMAHA_ID = 0x43;
  const MODEL_ID = [0x7F, 0x1C, 0x0C];

  // part p = MIDI channel p+1
  const TRACKS = [
    { id: 'kick',  name: 'KICK',    ch: 0,  group: 'drum',    color: '#e04050' },
    { id: 'snare', name: 'SNARE',   ch: 1,  group: 'drum',    color: '#e07030' },
    { id: 'clap',  name: 'CLAP',    ch: 2,  group: 'drum',    color: '#e0a020' },
    { id: 'hat1',  name: 'HAT 1',   ch: 3,  group: 'drum',    color: '#c0c040' },
    { id: 'hat2',  name: 'HAT 2',   ch: 4,  group: 'drum',    color: '#80c040' },
    { id: 'perc1', name: 'PERC 1',  ch: 5,  group: 'drum',    color: '#40c060' },
    { id: 'perc2', name: 'PERC 2',  ch: 6,  group: 'drum',    color: '#30b0a0' },
    { id: 'syn1',  name: 'SYNTH 1', short: 'SYN 1', ch: 7,  group: 'synth',   color: '#2d8cf0' },
    { id: 'syn2',  name: 'SYNTH 2', short: 'SYN 2', ch: 8,  group: 'synth',   color: '#6060e0' },
    { id: 'dx',    name: 'DX',      ch: 9,  group: 'dx',      color: '#9040d0' },
    { id: 'samp',  name: 'SAMPLER', short: 'SAMP', ch: 10, group: 'sampler', color: '#c040a0' },
  ];

  // ---- value formatters ----
  const fmt = {
    raw: v => String(v),
    bi64: v => { const d = v - 64; return d > 0 ? '+' + d : String(d); },          // 00-7F centre 40
    pan: v => v === 64 ? 'C' : (v < 64 ? 'L' + (64 - v) : 'R' + (v - 64)),
    semi24: v => { const d = v - 64; return (d > 0 ? '+' : '') + d + 'st'; },      // 28-58 centre 40
    db12: v => { const d = Math.round((v - 64) / 2); return (d > 0 ? '+' : '') + d + 'dB'; }, // 40-88 = -12..+12 dB
    peg: v => { const d = v - 64; return (d > 0 ? '+' : '') + d; },                // 10-70 centre 40
    pct: v => Math.round(v / 1.27) + '%',
    list: arr => v => arr[v] !== undefined ? arr[v] : String(v),
  };

  // ---- Parameter definitions ----
  // kind 'sx': SysEx parameter, addr [hi, mid, lo]; mid may contain the part (|p) or operator nibble.
  // kind 'cc': control change on the track channel.
  // bipolar: arc drawn from the centre.

  // Sound general (31 1p xx) - Yamaha Data List, 03d
  function sound(part, lo, label, extra) {
    return Object.assign({ kind: 'sx', addr: [0x31, 0x10 | part, lo], label, min: 0, max: 127, def: 64, bipolar: true, fmt: fmt.bi64 }, extra || {});
  }
  // Project track (30 5p xx) - 03c; 00 volume and 01 pan verified on hardware
  function track(part, lo, label, extra) {
    return Object.assign({ kind: 'sx', addr: [0x30, 0x50 | part, lo], label, min: 0, max: 127, def: 100, fmt: fmt.raw }, extra || {});
  }
  function cc(ch, num, label, extra) {
    return Object.assign({ kind: 'cc', ch, cc: num, label, min: 0, max: 127, def: 0, fmt: fmt.raw }, extra || {});
  }

  // Every knob below writes and reads a documented SysEx address. Where the unit's own knob sends a CC
  // for the same thing, rxcc makes the app's knob follow it. CC <-> address pairs measured on the unit
  // 25 Nov 2026: CC73=31 1p 2C, CC75=31 1p 00, CC91=31 1p 19, CC94=31 1p 1A, CC21=31 1p 48, CC20=31 1p 4D,
  // CC25=31 1p 1C, CC26=31 1p 23, CC27=31 5p 00, CC28=31 5p 14 (0-200 %), CC5=31 1p 1F, CC117-119=31 1p 03-05.
  // CC74/CC71 do NOT move 31 1p 36/37, so cutoff/reso use the address (readable) and only listen to the CC.
  const arp = (p, lo, label, extra) => Object.assign({ kind: 'sx', addr: [0x31, 0x50 | p, lo], label, min: 0, max: 127, def: 0, fmt: fmt.raw }, extra || {});
  const P = {
    volume: p => track(p, 0x00, 'VOLUME', { hw: true, def: 100, rxcc: 7 }),
    pan:    p => track(p, 0x01, 'PAN', { hw: true, min: 1, def: 64, bipolar: true, fmt: fmt.pan, rxcc: 10 }),
    reverb: p => sound(p, 0x19, 'REVERB', { def: 0, bipolar: false, fmt: fmt.raw, rxcc: 91 }),
    delay:  p => sound(p, 0x1A, 'DELAY', { def: 0, bipolar: false, fmt: fmt.raw, rxcc: 94 }),
    eqLow:  p => sound(p, 0x48, 'EQ LOW',  { min: 40, max: 88, fmt: fmt.db12, rxcc: 21 }),
    eqHigh: p => sound(p, 0x4D, 'EQ HIGH', { min: 40, max: 88, fmt: fmt.db12, rxcc: 20 }),
    drumPitch: p => sound(p, 0x1C, 'PITCH', { min: 40, max: 88, fmt: fmt.semi24, rxcc: 25 }),
    cutoff: p => sound(p, 0x36, 'CUTOFF', { rxcc: 74 }),
    reso:   p => sound(p, 0x37, 'RESO', { rxcc: 71 }),
    ampAttack: p => sound(p, 0x2C, 'ATTACK', { rxcc: 73 }),
    ampDecRel: p => sound(p, 0x00, 'DEC/REL', { rxcc: 75 }),
    fegDepth: p => sound(p, 0x34, 'FEG DEPTH'),
    fegA: p => sound(p, 0x30, 'ATTACK'),
    fegD: p => sound(p, 0x31, 'DECAY'),
    fegS: p => sound(p, 0x32, 'SUSTAIN'),
    fegR: p => sound(p, 0x33, 'RELEASE'),
    aegA: p => sound(p, 0x2C, 'ATTACK', { rxcc: 73 }),
    aegD: p => sound(p, 0x2D, 'DECAY'),
    aegS: p => sound(p, 0x2E, 'SUSTAIN'),
    aegR: p => sound(p, 0x2F, 'RELEASE'),
    noteShift: p => sound(p, 0x1C, 'TRANSPOSE', { min: 0x28, max: 0x58, fmt: fmt.semi24, rxcc: 25 }),
    portaTime: p => sound(p, 0x1F, 'PORTA', { bipolar: false, fmt: fmt.raw, rxcc: 5 }),
    velDepth: p => sound(p, 0x12, 'VEL DEPTH', { bipolar: false, fmt: fmt.raw }),
    monoPoly: p => sound(p, 0x23, 'MODE', { min: 0, max: 2, def: 1, bipolar: false, fmt: fmt.list(['MONO', 'POLY', 'CHORD']), steps: true, rxcc: 26 }),
    arpType:  p => arp(p, 0x00, 'ARP', { min: 0, max: 15, fmt: v => v === 0 ? 'OFF' : String(v), steps: true, rxcc: 27 }),
    // gate is two bytes (0-200 %) at 31 5p 14: sent as CC 28, read back from the address
    arpGate:  p => cc(p, 28, 'ARP GATE', { def: 64, fmt: v => Math.round(v / 127 * 200) + '%', rd: [0x31, 0x50 | p, 0x14], rdConv: d => Math.max(0, Math.min(127, Math.round(((d[0] << 7) | d[1]) * 127 / 200))) }),
    fmAlgoCC:  p => ({ kind: 'sx', addr: [0x48, 0x09, 0x00], label: 'ALGO', min: 0, max: 11, def: 0, fmt: v => String(v + 1), steps: true, rxcc: 116, rxch: 9 }),
    fmModCC:   p => sound(p, 0x03, 'MOD AMT', { rxcc: 117 }),
    fmFreqCC:  p => sound(p, 0x04, 'MOD FREQ', { rxcc: 118 }),
    fmFbCC:    p => sound(p, 0x05, 'FEEDBACK', { rxcc: 119 }),
    fmRelease: p => sound(p, 0x00, 'RELEASE', { rxcc: 75 }),
    fmAttack:  p => sound(p, 0x01, 'C.ATTACK'),
    fmDecay:   p => sound(p, 0x02, 'C.DECAY'),
    fmModAmt:  p => sound(p, 0x03, 'MOD AMT', { rxcc: 117 }),
    fmRatio:   p => sound(p, 0x04, 'RATIO', { rxcc: 118 }),
    fmFback:   p => sound(p, 0x05, 'FEEDBACK', { rxcc: 119 }),
  };

  // ---- Element level (03e): absolute values written to all 8 elements of a part at once ----
  // The M1 user sounds are built with a flat amp envelope (decay times 0, levels 7F - read on the unit 25 Nov),
  // so the sound-level OFFSETS (31 1p 2C-2F, 00) have nothing to work on. These write the envelope itself.
  // addr = element 0 (used to read the value back), fan = the same parameter on every element.
  function elem(hi, p, lo, label, extra) {
    const fan = []; for (let e = 0; e < 8; e++) fan.push([hi, (e << 4) | p, lo]);
    return Object.assign({ kind: 'sx', addr: fan[0], fan, label, min: 0, max: 127, def: 0, fmt: fmt.raw }, extra || {});
  }
  // two-byte values (MSB bit 7, LSB bits 6-0)
  const enc8 = x => [(x >> 7) & 1, x & 0x7F];
  const dec8 = d => ((d[0] & 1) << 7) | (d[1] & 0x7F);
  const E = {
    aegAttack:  p => elem(0x41, p, 0x33, 'ATTACK'),
    aegDecay:   p => elem(0x41, p, 0x34, 'DECAY', { def: 64 }),
    aegDecay2:  p => elem(0x41, p, 0x35, 'DECAY 2', { def: 64 }),
    aegRelease: p => elem(0x41, p, 0x37, 'RELEASE', { def: 0x28 }),
    aegAtkLvl:  p => elem(0x41, p, 0x39, 'ATK LVL', { def: 127 }),
    aegD1Lvl:   p => elem(0x41, p, 0x3A, 'BREAK', { def: 127 }),
    aegSustain: p => elem(0x41, p, 0x3B, 'SUSTAIN', { def: 127 }),
    // filter cutoff 0-255 at 42 ep 01 (two bytes); the knob runs 0-127
    cutoff:     p => elem(0x42, p, 0x01, 'CUTOFF', { def: 127, enc: v => enc8(Math.min(255, v * 2 + (v > 0 ? 1 : 0))), dec: d => dec8(d) >> 1 }),
    reso:       p => elem(0x42, p, 0x05, 'RESO'),
    fegAttack:  p => elem(0x42, p, 0x0F, 'F.ATTACK'),
    fegDecay:   p => elem(0x42, p, 0x10, 'F.DECAY', { def: 64 }),
    fegDecay2:  p => elem(0x42, p, 0x11, 'F.DECAY 2', { def: 64 }),
    fegRelease: p => elem(0x42, p, 0x12, 'F.RELEASE', { def: 0x50 }),
    // FEG levels -128..+127 around 128 (two bytes): value here is 0-255
    fegAtkLvl:  p => elem(0x42, p, 0x15, 'F.ATK LVL', { max: 255, def: 255, enc: enc8, dec: dec8 }),
    fegD1Lvl:   p => elem(0x42, p, 0x17, 'F.BREAK', { max: 255, def: 255, enc: enc8, dec: dec8 }),
    fegD2Lvl:   p => elem(0x42, p, 0x19, 'F.SUSTAIN', { max: 255, def: 255, enc: enc8, dec: dec8 }),
    fegRelLvl:  p => elem(0x42, p, 0x1B, 'F.REL LVL', { max: 255, def: 128, enc: enc8, dec: dec8 }),
    fegDepth:   p => elem(0x42, p, 0x1D, 'FILTER EG', { def: 64, bipolar: true, fmt: fmt.bi64 }),
  };
  // project scale notes: 30 4D (scale << 4 | pad), 7 pads per scale (verified on hardware in seqtrak-docs)
  const SCALE_NOTE = (scale, pad) => [0x30, 0x4D, (scale << 4) | pad];

  // Master: speaker master volume 00 00 00 (verified on hardware)
  const MASTER_VOLUME = { kind: 'sx', addr: [0x00, 0x00, 0x00], label: 'SPEAKER', min: 0, max: 127, def: 100, hw: true, fmt: fmt.raw };
  // Headphone/line master 00 00 01 (written + read back on the unit 25 Nov), plug status 01 10 07 (1 = plugged)
  const HP_VOLUME = { kind: 'sx', addr: [0x00, 0x00, 0x01], label: 'PHONES', min: 0, max: 127, def: 20, hw: true, fmt: fmt.raw };
  const HP_PLUG = [0x01, 0x10, 0x07];
  // Selected track on the unit: 01 10 27 (broadcast on every track change; a write selects the track - tested 25 Nov)
  const CURRENT_PART = [0x01, 0x10, 0x27];
  // Current sound number of a part: 01 1p 33, two 7-bit bytes = catalogue number - 1
  const CURRENT_SOUND = p => [0x01, 0x10 | p, 0x33];
  // Project scale (0-7) and key (40-4B = C..B)
  const SCALE = { kind: 'sx', addr: [0x30, 0x40, 0x7E], min: 0, max: 7 };
  const KEY = { kind: 'sx', addr: [0x30, 0x40, 0x7F], min: 0x40, max: 0x4B };
  // The unit's own chords: 7 pads x 4 notes per scale, per track (parts 7-9). Scales 1-4 at 30 6p, 5-8 at 30 7p,
  // offset = (scale % 4) * 20h + pad * 4 + note. Value 0 = no note, else 24h-60h. Read back on the unit 25 Nov.
  const CHORD_NOTE = (p, scale, pad, n) => [0x30, (scale < 4 ? 0x60 : 0x70) | p, (scale % 4) * 0x20 + pad * 4 + n];
  // Insertion A = the track's own effect: type at 31 2p 00 (two bytes, effect-types table)
  const INS_TYPE = p => [0x31, 0x20 | p, 0x00];

  // ---- DX / FM engine (03f) ----
  const LFO_WAVES = ['SIN', 'TRI', 'SAW UP', 'SAW DN', 'SQUARE', 'S&H 8', 'S&H'];
  function dxc(lo, label, extra) {
    return Object.assign({ kind: 'sx', addr: [0x48, 0x09, lo], label, min: 0, max: 127, def: 64, fmt: fmt.raw }, extra || {});
  }
  const DX_COMMON = {
    algorithm: dxc(0x00, 'ALGORITHM', { min: 0, max: 11, def: 0, hw: true, fmt: v => String(v + 1), rxcc: 116, rxch: 9 }),
    pbSens:    dxc(0x02, 'PB RANGE', { min: 0x28, max: 0x58, def: 0x42, bipolar: true, fmt: fmt.semi24 }),
    lfoWave:   dxc(0x04, 'LFO WAVE', { min: 0, max: 6, def: 0, fmt: fmt.list(LFO_WAVES), steps: true }),
    lfoSpeed:  dxc(0x05, 'SPEED', { def: 0x40 }),
    lfoDelay:  dxc(0x06, 'DELAY', { def: 0 }),
    lfoPmd:    dxc(0x07, 'PITCH MOD', { def: 0 }),
    pegR1: dxc(0x0A, 'R1'), pegR2: dxc(0x0B, 'R2'), pegR3: dxc(0x0C, 'R3'), pegR4: dxc(0x0D, 'R4'),
    pegL1: dxc(0x0E, 'L1', { min: 0x10, max: 0x70, bipolar: true, fmt: fmt.peg }),
    pegL2: dxc(0x0F, 'L2', { min: 0x10, max: 0x70, bipolar: true, fmt: fmt.peg }),
    pegL3: dxc(0x10, 'L3', { min: 0x10, max: 0x70, bipolar: true, fmt: fmt.peg }),
    pegL4: dxc(0x11, 'L4', { min: 0x10, max: 0x70, bipolar: true, fmt: fmt.peg }),
  };

  // operator o (0-3): 49 (o<<4|9) lo - whole block read back on hardware for all 4 operators
  function dxo(o, lo, label, extra) {
    return Object.assign({ kind: 'sx', addr: [0x49, (o << 4) | 0x09, lo], label, min: 0, max: 127, def: 0, hw: true, fmt: fmt.raw }, extra || {});
  }
  const CURVES = ['-LIN', '-EXP', '+EXP', '+LIN'];
  const DX_OP = {
    onOff:   o => dxo(o, 0x00, 'ON', { min: 0, max: 1, def: 1 }),
    egR1: o => dxo(o, 0x02, 'R1', { def: 127 }), egR2: o => dxo(o, 0x03, 'R2', { def: 127 }),
    egR3: o => dxo(o, 0x04, 'R3', { def: 127 }), egR4: o => dxo(o, 0x05, 'R4', { def: 100 }),
    egL1: o => dxo(o, 0x06, 'L1', { def: 127 }), egL2: o => dxo(o, 0x07, 'L2', { def: 127 }),
    egL3: o => dxo(o, 0x08, 'L3', { def: 127 }), egL4: o => dxo(o, 0x09, 'L4', { def: 0 }),
    rateScl: o => dxo(o, 0x0A, 'RATE SCL'),
    lvlSclL: o => dxo(o, 0x0C, 'SCL L'),
    lvlSclR: o => dxo(o, 0x0D, 'SCL R'),
    crvL: o => dxo(o, 0x0E, 'CRV L', { min: 0, max: 3, fmt: fmt.list(CURVES), steps: true }),
    crvR: o => dxo(o, 0x0F, 'CRV R', { min: 0, max: 3, def: 3, fmt: fmt.list(CURVES), steps: true }),
    amd:     o => dxo(o, 0x11, 'AMP MOD'),
    velSens: o => dxo(o, 0x12, 'VEL'),
    level:   o => dxo(o, 0x13, 'LEVEL', { def: 100 }),
    fbLevel: o => dxo(o, 0x14, 'FEEDBACK'),
    fbType:  o => dxo(o, 0x15, 'FB TYPE', { min: 0, max: 1, fmt: fmt.list(['SAW', 'SQR']), steps: true }),
    pmdOn:   o => dxo(o, 0x17, 'PMD', { min: 0, max: 1, def: 1 }),
    pegOn:   o => dxo(o, 0x18, 'PEG', { min: 0, max: 1, def: 1 }),
    freqMode: o => dxo(o, 0x19, 'MODE', { min: 0, max: 1, fmt: fmt.list(['RATIO', 'FIXED']) }),
    coarse:  o => dxo(o, 0x1A, 'COARSE', { min: 0, max: 31, def: 1, steps: true }),
    fine:    o => dxo(o, 0x1B, 'FINE', { min: 0, max: 99 }),
    detune:  o => dxo(o, 0x1C, 'DETUNE', { def: 64, bipolar: true, fmt: fmt.bi64 }),
  };

  // ---- message builders ----
  function frame(type, addr, data) {
    return new Uint8Array([0xF0, YAMAHA_ID, type, ...MODEL_ID, ...addr, ...(data || []), 0xF7]);
  }
  const buildParam = (addr, value) => frame(0x10, addr, [value & 0x7F]);
  const buildParamData = (addr, data) => frame(0x10, addr, data.map(b => b & 0x7F));
  const buildRequest = (addr) => frame(0x30, addr);
  const buildCC = (ch, num, v) => new Uint8Array([0xB0 | (ch & 0x0F), num & 0x7F, v & 0x7F]);

  // Send for a param definition: SysEx write, plus its mirror CC where one is documented
  function messagesFor(def, value) {
    if (def.kind === 'cc') return [buildCC(def.ch, def.cc, value)];
    const data = def.enc ? def.enc(value) : [value];
    return (def.fan || [def.addr]).map(a => buildParamData(a, data));
  }

  // Keys used by the sync registry
  const keyOf = def => def.kind === 'cc' ? `cc:${def.ch}:${def.cc}` : 'sx:' + def.addr.map(b => b.toString(16).padStart(2, '0')).join('');

  // Parse an incoming Parameter Change; returns { key, value } or null
  function parseParamChange(d) {
    if (d.length < 10 || d[0] !== 0xF0 || d[1] !== 0x43 || (d[2] & 0xF0) !== 0x10) return null;
    if (d[3] !== 0x7F || d[4] !== 0x1C || d[5] !== 0x0C) return null;
    const addr = [d[6], d[7], d[8]];
    const data = Array.from(d.slice(9, d.length - 1));
    return { addr, data, key: 'sx:' + addr.map(b => b.toString(16).padStart(2, '0')).join(''), value: data[0] };
  }

  // 7-into-8 unpacking (02-sysex-format: header bit 6-k belongs to byte k), then UTF-8 text
  function unpack7(enc) {
    const out = [];
    for (let i = 0; i < enc.length; i += 8) {
      const h = enc[i];
      for (let k = 0; k < 7 && i + 1 + k < enc.length; k++) out.push(enc[i + 1 + k] | (((h >> (6 - k)) & 1) << 7));
    }
    return out;
  }
  function decodeName(data) {
    const raw = unpack7(data);
    let end = raw.indexOf(0); if (end < 0) end = raw.length;
    try { return new TextDecoder().decode(new Uint8Array(raw.slice(0, end))).trim(); }
    catch (e) { return String.fromCharCode(...raw.slice(0, end)).trim(); }
  }
  // 01 1p 35 CurrentSoundName (verified on hardware: answers for presets and user sounds)
  const soundNameAddr = p => [0x01, 0x10 | p, 0x35];

  // Bank select + program change triplet (06-sounds-presets): always send all three
  const loadSound = (ch, msb, lsb, prog) => [buildCC(ch, 0, msb), buildCC(ch, 32, lsb), new Uint8Array([0xC0 | (ch & 0x0F), prog & 0x7F])];

  // ---- Effects (03c + cc-map) ----
  const FX = {
    revType: { kind: 'sx', addr: [0x30, 0x41, 0x00], label: 'TYPE' },
    revReturn: { kind: 'sx', addr: [0x30, 0x41, 0x44], label: 'RETURN', min: 0, max: 127, def: 0x2E, fmt: fmt.raw },
    revPan: { kind: 'sx', addr: [0x30, 0x41, 0x45], label: 'PAN', min: 1, max: 127, def: 64, bipolar: true, fmt: fmt.pan },
    revOn: { kind: 'sx', addr: [0x30, 0x41, 0x46], label: 'ON', min: 0, max: 1, def: 1 },
    revP: [110, 111, 112].map((n, i) => cc(0, n, 'PARAM ' + (i + 1), { def: 64 })),
    dlyType: { kind: 'sx', addr: [0x30, 0x42, 0x00], label: 'TYPE' },
    dlyReturn: { kind: 'sx', addr: [0x30, 0x42, 0x44], label: 'RETURN', min: 0, max: 127, def: 0x60, fmt: fmt.raw },
    dlyPan: { kind: 'sx', addr: [0x30, 0x42, 0x45], label: 'PAN', min: 1, max: 127, def: 64, bipolar: true, fmt: fmt.pan },
    dlyToRev: { kind: 'sx', addr: [0x30, 0x42, 0x46], label: 'TO REVERB', min: 0, max: 127, def: 0, fmt: fmt.raw },
    dlyOn: { kind: 'sx', addr: [0x30, 0x42, 0x47], label: 'ON', min: 0, max: 1, def: 1 },
    dlyP: [113, 114, 115].map((n, i) => cc(0, n, 'PARAM ' + (i + 1), { def: 64 })),
    // master effects: block 30 4n with n = 2 + effect (1-3)
    mType: e => ({ kind: 'sx', addr: [0x30, 0x42 + e, 0x00], label: 'TYPE' }),
    mOn:   e => ({ kind: 'sx', addr: [0x30, 0x42 + e, 0x47], label: 'ON', min: 0, max: 1, def: 1 }),
    mP: e => (e === 1 ? [102, 103, 104] : e === 2 ? [105] : [106]).map((n, i) => cc(0, n, 'PARAM ' + (i + 1), { def: 64 })),
    // single (track) effect, on the track channel
    trackP: p => [107, 108, 109].map((n, i) => cc(p, n, 'PARAM ' + (i + 1), { def: 64 })),
  };
  const fxTypeName = (msb, lsb) => (typeof FX_TYPES !== 'undefined' && FX_TYPES[[msb, lsb].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()]) || ('TYPE ' + msb + '/' + lsb);

  // ---- Step record (04-sequencer-editing, ah = 70; DRUM-type parts only) ----
  const STEP = {
    add: (p, step, note, vel, gate) => buildParamData([0x70, 0x00 | p, 0x00], [step, note & 0x7F, vel & 0x7F, (gate >> 7) & 0x7F, gate & 0x7F]),
    del: (p, step) => buildParamData([0x70, 0x20 | p, 0x00], [step]),
    readAddr: (p, step) => [0x70, 0x40 | p, step],
  };
  // ---- Piano rolls (04-sequencer-editing) ----
  // Synth block 72-75 for parts 7-10, numbered locally (t = part - 7), verified on hardware.
  // Drum block 22-25 for parts 0-6 re-typed to SYNTH, numbered by global part, verified on hardware.
  // Event time = step * 120 + 60 (centre of the step), gate 120 = one 16th.
  function rollBlock(p) { return p >= 7 ? { add: 0x72, del: 0x74, read: 0x75, n: p - 7 } : { add: 0x22, del: 0x24, read: 0x25, n: p }; }
  const ROLL = {
    addNote: (p, time, note, vel, gate) => { const b = rollBlock(p); return buildParamData([b.add, b.n << 4, 0x00],
      [(time >> 7) & 0x7F, time & 0x7F, 0x00, note & 0x7F, vel & 0x7F, 0x00, (gate >> 7) & 0x7F, gate & 0x7F]); },
    del: (p, idx) => { const b = rollBlock(p); return frame(0x10, [b.del, (b.n << 4) | ((idx >> 7) & 0x0F), idx & 0x7F]); },
    readAddr: (p, idx) => { const b = rollBlock(p); return [b.read, (b.n << 4) | ((idx >> 7) & 0x0F), idx & 0x7F]; },
  };
  // Track type, 01 1p 3C PartAwmType (verified on hardware): 1 DRUM, 2 SYNTH, 3 DRUM KIT, 4 DX, 5 SAMPLER
  const TYPE_ADDR = p => [0x01, 0x10 | p, 0x3C];
  const TYPE_NAMES = { 1: 'DRUM', 2: 'SYNTH', 3: 'KIT', 4: 'DX', 5: 'SAMPLER' };
  const DEFAULT_TYPE = p => (p < 7 ? 1 : p < 9 ? 2 : p === 9 ? 4 : 5);
  // Pattern length of pattern n (0-5): 30 5p (16 + 2n), 2 bytes 7-bit, 1-128 steps (verified for pattern 1)
  const PATTERN_STEPS = (p, n) => [0x30, 0x50 | p, 0x16 + 2 * n];
  const PATTERN_MODE = [0x30, 0x40, 0x79];     // 1 = all six patterns reachable (verified)
  const PATTERN_SELECT = p => ({ kind: 'sx', addr: [0x30, 0x50 | p, 0x0F], min: 0, max: 5 });   // verified
  const RECORDING = { kind: 'sx', addr: [0x01, 0x10, 0x21], min: 0, max: 1 };                  // verified: only takes while playing

  // legacy helpers kept for the M-One page
  function buildDxCommonMsg(_dev, key, v) { const d = DX_COMMON[key]; return d ? buildParam(d.addr, v) : null; }
  function buildDxOpMsg(_dev, o, key, v) { const f = DX_OP[key]; return f ? buildParam(f(o).addr, v) : null; }

  return {
    TRACKS, P, E, SCALE_NOTE, MASTER_VOLUME, HP_VOLUME, HP_PLUG, CURRENT_PART, CURRENT_SOUND, SCALE, KEY, CHORD_NOTE, INS_TYPE, DX_COMMON, DX_OP, LFO_WAVES, fmt,
    buildParam, buildParamData, buildRequest, unpack7, decodeName, soundNameAddr, loadSound,
    FX, fxTypeName, STEP, ROLL, TYPE_ADDR, TYPE_NAMES, DEFAULT_TYPE, PATTERN_STEPS, PATTERN_MODE, PATTERN_SELECT, RECORDING, buildCC, messagesFor, keyOf, parseParamChange,
    buildDxCommonMsg, buildDxOpMsg,
  };
})();
