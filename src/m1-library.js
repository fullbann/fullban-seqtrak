/* ============================================
   FULLBAN SEQ-TRAK — M1 program library
   Reads Korg M1 program banks (.syx all-data / program dumps, M-One .m1b,
   or a combined .m1lib) that the USER imports from their own files; the
   library is kept in this browser (IndexedDB) and never leaves the device.
   A program is applied live to a SEQTRAK synth track: the M1 multisound's
   user sound is loaded, then the program's VDF/VDA/octave settings are
   written as the sound's documented offset parameters (31 1p xx).
   Byte layout: M1 owner's manual table 1, as used by M-One's engine.
   ============================================ */

const M1Lib = (() => {
  const PLEN = 143;
  const O1 = 63;                                   // OSC 1 block
  const s8 = v => (v > 127 ? v - 256 : v);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Korg 7-bit unpacking: header bit j belongs to byte j (LSB first)
  function unpack7(b) {
    const out = [];
    for (let i = 0; i < b.length; i += 8) {
      const m = b[i];
      for (let j = 0; j < 7 && i + 1 + j < b.length; j++) out.push(b[i + 1 + j] | (((m >> j) & 1) << 7));
    }
    return out;
  }
  function* messages(d) {
    let i = 0;
    while (true) {
      const s = d.indexOf(0xF0, i); if (s < 0) return;
      const e = d.indexOf(0xF7, s); if (e < 0) return;
      yield d.subarray(s, e); i = e + 1;
    }
  }
  const progName = p => String.fromCharCode(...p.slice(0, 10)).replace(/[^\x20-\x7e]/g, ' ').trim() || '(init)';

  // -> array of 143-byte programs, or null
  function parseBytes(u8, fname) {
    if (u8[0] === 0x4D && u8[1] === 0x31 && u8[2] === 0x42 && u8[3] === 0x31) {          // "M1B1"
      const out = [];
      for (let k = 0; k < 100; k++) out.push(Array.from(u8.subarray(8 + k * PLEN, 8 + (k + 1) * PLEN)));
      return out;
    }
    let progs = null;
    for (const m of messages(u8)) {
      if (m.length < 6 || m[1] !== 0x42 || (m[2] & 0xF0) !== 0x30 || m[3] !== 0x19) continue;
      const fn = m[4];
      if (fn === 0x4C) progs = unpack7(m.subarray(6));
      else if (fn === 0x50) {
        const u = unpack7(m.subarray(8));
        if (u.length >= 13261 + PLEN * 100) progs = u.slice(13261, 13261 + PLEN * 100);
      }
    }
    if (!progs) return null;
    const out = [];
    for (let k = 0; k + PLEN <= progs.length && k < 100 * PLEN; k += PLEN) out.push(progs.slice(k, k + PLEN));
    return out.length ? out : null;
  }

  // Combined library: "M1LB" + u32 count + per bank: u16 nameLen, name (utf8), u16 nprog, nprog*143
  function parseLib(u8) {
    const td = new TextDecoder();
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let o = 8; const n = dv.getUint32(4, true); const banks = [];
    for (let b = 0; b < n; b++) {
      const nl = dv.getUint16(o, true); o += 2;
      const name = td.decode(u8.subarray(o, o + nl)); o += nl;
      const np = dv.getUint16(o, true); o += 2;
      const progs = [];
      for (let k = 0; k < np; k++) { progs.push(Array.from(u8.subarray(o, o + PLEN))); o += PLEN; }
      banks.push({ name, progs });
    }
    return banks;
  }

  // ---- storage (IndexedDB, this browser only) ----
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('fb-m1lib', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('banks', { keyPath: 'name' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function putBanks(banks) {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction('banks', 'readwrite');
      banks.forEach(b => tx.objectStore('banks').put({ name: b.name, progs: b.progs.map(p => Uint8Array.from(p)) }));
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
  async function allBanks() {
    const d = await db();
    return new Promise((res, rej) => {
      const r = d.transaction('banks').objectStore('banks').getAll();
      r.onsuccess = () => res(r.result.sort((a, b) => a.name.localeCompare(b.name)));
      r.onerror = () => rej(r.error);
    });
  }
  async function clearAll() {
    const d = await db();
    return new Promise(res => { const tx = d.transaction('banks', 'readwrite'); tx.objectStore('banks').clear(); tx.oncomplete = res; });
  }

  async function importFiles(fileList, onProgress) {
    const banks = []; let skipped = 0;
    const files = Array.from(fileList);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const u8 = new Uint8Array(await f.arrayBuffer());
      if (u8[0] === 0x4D && u8[1] === 0x31 && u8[2] === 0x4C && u8[3] === 0x42) { banks.push(...parseLib(u8)); continue; }   // "M1LB"
      const progs = parseBytes(u8, f.name);
      if (!progs) { skipped++; continue; }
      const path = (f.webkitRelativePath || f.name).replace(/\.(syx|m1b)$/i, '');
      banks.push({ name: path.split('/').slice(-2).join(' / '), progs });
      if (onProgress) onProgress(i + 1, files.length);
    }
    await putBanks(banks);
    return { banks: banks.length, skipped };
  }

  // ---- program -> SEQTRAK messages ----
  function describe(p) {
    const mode = p[10];
    return {
      name: progName(p), mode,                     // 0 single, 1 double, 2 drums
      ms1: p[12], oct1: s8(p[13]), ms2: p[14], mono: !!(p[11] & 1),
      cutoff: p[O1 + 8], egInt: p[O1 + 11],
      vdf: { at: p[O1 + 15], al: s8(p[O1 + 16]), dt: p[O1 + 17], bp: s8(p[O1 + 18]), st: p[O1 + 19], sl: s8(p[O1 + 20]), rt: p[O1 + 21], rl: s8(p[O1 + 22]) },
      level: p[O1 + 23],
      vda: { at: p[O1 + 29], al: p[O1 + 30], dt: p[O1 + 31], bp: p[O1 + 32], st: p[O1 + 33], sl: p[O1 + 34], rt: p[O1 + 35] },
      // effect block at byte 38 (as M-One reads it): types, FX1 L/R + FX2 L/R balance, switches in byte 8
      fx: { type: [p[38], p[39]], bal: [Math.round((p[40] + p[41]) / 2), Math.round((p[42] + p[43]) / 2)], on: [!!(p[46] & 0x03), !!(p[46] & 0x0C)] },
    };
  }
  // The M1 program's filter and amp envelopes are written to the SEQTRAK elements themselves (03e: 41 ep / 42 ep),
  // not as offsets: the M1 user sounds are stored with a flat envelope, so offsets had nothing to work on.
  // M1 times and levels run 0-99 (EG levels -99..+99); Yamaha times 0-127 (bigger = longer), levels 0-127,
  // filter EG levels -128..+127 around 128. Curves are straight scalings - tune by ear.
  const T = t => clamp(Math.round(t * 1.28), 0, 127);
  const L = v => clamp(Math.round(v * 1.283), 0, 127);
  const FL = v => clamp(128 + Math.round(v * 1.28), 0, 255);
  function paramsFor(d, part) {
    const P = SEQTRAK.P, E = SEQTRAK.E;
    const out = [];
    const put = (def, v) => out.push([def, clamp(Math.round(v), def.min ?? 0, def.max ?? 127)]);
    put(E.cutoff(part), d.cutoff * 1.28);
    put(E.fegDepth(part), 64 + d.egInt * 0.63);
    put(E.fegAttack(part), T(d.vdf.at)); put(E.fegAtkLvl(part), FL(d.vdf.al));
    put(E.fegDecay(part), T(d.vdf.dt));  put(E.fegD1Lvl(part), FL(d.vdf.bp));
    put(E.fegDecay2(part), T(d.vdf.st)); put(E.fegD2Lvl(part), FL(d.vdf.sl));
    put(E.fegRelease(part), T(d.vdf.rt)); put(E.fegRelLvl(part), FL(d.vdf.rl));
    put(E.aegAttack(part), T(d.vda.at)); put(E.aegAtkLvl(part), L(d.vda.al));
    put(E.aegDecay(part), T(d.vda.dt));  put(E.aegD1Lvl(part), L(d.vda.bp));
    put(E.aegDecay2(part), T(d.vda.st)); put(E.aegSustain(part), L(d.vda.sl));
    put(E.aegRelease(part), T(d.vda.rt));
    put(P.noteShift(part), 64 + 12 * clamp(d.oct1, -2, 2));
    put(P.monoPoly(part), d.mono ? 0 : 1);
    return out;
  }

  const FX_NAMES = ['Hall', 'Ensemble Hall', 'Concert Hall', 'Room', 'Large Room', 'Live Stage', 'Early Ref 1', 'Early Ref 2', 'Early Ref 3',
    'Stereo Delay', 'Cross Delay', 'Chorus 1', 'Chorus 2', 'Flanger 1', 'Cross Flanger', 'Stereo Phaser', 'Phaser', 'Stereo Tremolo', 'Tremolo',
    'Equalizer', 'Overdrive', 'Distortion', 'Exciter', 'Symphonic Ens', 'Rotary Speaker', 'Delay/Hall', 'Delay/Room', 'Delay/Early Ref',
    'Delay/Delay', 'Delay/Chorus', 'Delay/Flanger', 'Delay/Phaser', 'Delay/Tremolo', 'No Effect'];
  return { importFiles, allBanks, clearAll, describe, paramsFor, parseBytes, progName, FX_NAMES };
})();
