/* ============================================
   FULLBAN SEQ-TRAK — Bluetooth MIDI (BLE-MIDI over Web Bluetooth)
   Standard MIDI-over-Bluetooth-LE service. Works in Chrome on Android
   (https page). On the SEQTRAK: hold ALL and press SWING, then Connect.
   Do NOT pair the SEQTRAK in Android's Bluetooth settings.
   ============================================ */

const BLEMidi = (() => {
  const SVC = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
  const CHR = '7772e5db-3868-4112-a1a9-f2669d106bf3';
  const PKT = 20;                      // safe packet size (default MTU 23 - 3)

  let device = null, chr = null;
  let onMessage = null, onState = null;
  let rxCount = 0, txCount = 0, lastErr = '';

  const supported = () => !!(navigator.bluetooth && window.isSecureContext);

  // ---------- timestamps ----------
  function ts() {
    const t = Math.floor(performance.now()) & 0x1FFF;     // 13-bit ms
    return [0x80 | ((t >> 7) & 0x3F), 0x80 | (t & 0x7F)];  // [header, timestamp-low]
  }

  // ---------- encode: raw MIDI bytes -> BLE packets ----------
  function encode(bytes) {
    const packets = [];
    const [hdr, tlo] = ts();
    let cur = [hdr];
    const flush = () => { if (cur.length > 1) packets.push(Uint8Array.from(cur)); cur = [hdr]; };
    let i = 0;
    while (i < bytes.length) {
      const st = bytes[i];
      if (st === 0xF0) {                                   // SysEx, split across packets
        let j = i; while (j < bytes.length && bytes[j] !== 0xF7) j++;
        const body = bytes.slice(i, j);                    // F0 .. data (without F7)
        if (cur.length + 2 > PKT) flush();
        cur.push(tlo);
        for (const b of body) {
          if (cur.length >= PKT) { flush(); }             // continuation packet: header + data
          cur.push(b);
        }
        if (cur.length + 2 > PKT) flush();
        cur.push(tlo, 0xF7);
        i = j + 1;
        continue;
      }
      if (st < 0x80) { i++; continue; }
      const n = (st >= 0xF8) ? 1 : ((st & 0xF0) === 0xC0 || (st & 0xF0) === 0xD0) ? 2 : (st >= 0xF0 ? 1 : 3);
      const msg = bytes.slice(i, i + n);
      if (cur.length + 1 + msg.length > PKT) flush();
      cur.push(tlo, ...msg);
      i += n;
    }
    flush();
    return packets;
  }

  // ---------- decode: BLE packet -> MIDI messages ----------
  let sysex = null, running = 0;
  const dataLen = st => (st >= 0xF0) ? 0 : ((st & 0xF0) === 0xC0 || (st & 0xF0) === 0xD0) ? 1 : 2;
  function emit(m) { rxCount++; if (onMessage) onMessage(m); }

  function decode(p) {
    if (p.length < 2 || !(p[0] & 0x80)) return;
    let i = 1;
    while (i < p.length) {
      let b = p[i];
      if (sysex) {
        if (b < 0x80) { sysex.push(b); i++; continue; }
        // timestamp byte inside sysex; next is F7 (end) or a real-time message
        i++; if (i >= p.length) break;
        b = p[i];
        if (b === 0xF7) { sysex.push(0xF7); emit(sysex); sysex = null; i++; continue; }
        if (b >= 0xF8) { emit([b]); i++; continue; }
        sysex = null; i--; continue;                        // other status: drop sysex, re-read from its timestamp
      }
      if (b & 0x80) {                                       // timestamp
        i++; if (i >= p.length) break;
        b = p[i];
      }
      if (b & 0x80) {                                       // status byte
        if (b === 0xF0) { sysex = [0xF0]; i++; continue; }
        if (b >= 0xF8) { emit([b]); i++; continue; }
        if (b >= 0xF1) { running = 0; i++; continue; }
        running = b;
        const n = dataLen(b);
        emit([b, ...p.slice(i + 1, i + 1 + n)]);
        i += 1 + n;
      } else if (running) {                                 // running status
        const n = dataLen(running);
        emit([running, ...p.slice(i, i + n)]);
        i += n;
      } else i++;
    }
  }

  // ---------- write queue ----------
  const q = [];
  let writing = false;
  async function pump() {
    if (writing) return;
    writing = true;
    while (q.length && chr) {
      const m = q.shift();                                  // one MIDI message at a time, encoded when it goes out
      for (const pkt of encode(m.bytes)) {
        try {
          if (chr.writeValueWithoutResponse) await chr.writeValueWithoutResponse(pkt);
          else await chr.writeValue(pkt);
          txCount++;
        } catch (e) { lastErr = 'write: ' + e.message; }
      }
    }
    writing = false;
  }
  // a newer value for the same parameter replaces one still waiting, so moving a knob never builds a backlog
  function keyOf(d) {
    // single-value Parameter Changes only; sequencer edits (add/delete note, 2x / 7x) must all go out
    if (d[0] === 0xF0 && d.length === 11 && (d[2] & 0xF0) === 0x10 && !((d[6] >= 0x20 && d[6] <= 0x2F) || (d[6] >= 0x70 && d[6] <= 0x7F))) return 'sx' + d[2] + ':' + d[6] + ':' + d[7] + ':' + d[8];
    if ((d[0] & 0xF0) === 0xB0) return 'cc' + d[0] + ':' + d[1];
    if ((d[0] & 0xF0) === 0xE0) return 'pb' + d[0];
    return null;
  }
  function send(bytes) {
    if (!chr) return false;
    const b = Array.from(bytes), k = keyOf(b);
    if (k) { const i = q.findIndex(m => m.k === k); if (i >= 0) { q[i].bytes = b; return true; } }
    q.push({ k, bytes: b });
    pump();
    return true;
  }

  // ---------- connect / auto-reconnect ----------
  let wanted = false, retryTimer = null, tries = 0;
  const setState = st => { if (onState) onState(st); };           // 'connected' | 'reconnecting' | 'lost' | 'off'
  async function attach() {
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(SVC);
    chr = await svc.getCharacteristic(CHR);
    chr.addEventListener('characteristicvaluechanged', e => decode(new Uint8Array(e.target.value.buffer)));
    await chr.startNotifications();
    sysex = null; running = 0; q.length = 0;
    tries = 0;
    setState('connected');
  }
  function onDrop() {
    chr = null;
    if (!wanted) { setState('off'); return; }
    scheduleRetry();
  }
  function scheduleRetry() {
    clearTimeout(retryTimer);
    if (tries >= 12) { setState('lost'); return; }      // ~1 minute of trying, then give up
    setState('reconnecting');
    const wait = Math.min(8000, 500 * Math.pow(2, tries++));
    retryTimer = setTimeout(async () => {
      try { await attach(); } catch (e) { lastErr = 'reconnect: ' + e.message; scheduleRetry(); }
    }, wait);
  }
  function useDevice(d) {
    if (device && device !== d) device.removeEventListener('gattserverdisconnected', onDrop);
    device = d;
    device.addEventListener('gattserverdisconnected', onDrop);
    try { localStorage.setItem('fbSeqtrakBleName', device.name || ''); } catch (e) {}
  }
  async function connect() {
    if (!supported()) throw new Error('Bluetooth needs Chrome on Android/PC and a secure (https) page');
    lastErr = '';
    const d = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SVC] }, { namePrefix: 'SEQTRAK' }],
      optionalServices: [SVC],
    });
    useDevice(d);
    wanted = true; tries = 0;
    await attach();
    return device.name || 'SEQTRAK (Bluetooth)';
  }
  // after the app restarts: reconnect to the SEQTRAK picked last time, where Chrome allows it
  async function reconnectRemembered() {
    if (!supported() || !navigator.bluetooth.getDevices) return null;
    try {
      const want = localStorage.getItem('fbSeqtrakBleName');
      const list = await navigator.bluetooth.getDevices();
      const d = list.find(x => want ? x.name === want : /SEQTRAK/i.test(x.name || ''));
      if (!d) return null;
      useDevice(d);
      wanted = true; tries = 0;
      await attach();
      return device.name;
    } catch (e) { lastErr = 'auto: ' + e.message; return null; }
  }
  function retryNow() { if (device && wanted) { tries = 0; scheduleRetry(); } }
  function disconnect() { wanted = false; clearTimeout(retryTimer); try { device && device.gatt.connected && device.gatt.disconnect(); } catch (e) {} chr = null; setState('off'); }

  return {
    supported, connect, disconnect, send, reconnectRemembered, retryNow,
    isConnected: () => !!chr,
    name: () => (device && device.name) || 'SEQTRAK (Bluetooth)',
    diag: () => `BLUETOOTH ${chr ? 'connected to ' + (device && device.name) : (wanted ? 'reconnecting' : 'not connected')} | in: ${rxCount} | out pkts: ${txCount}${lastErr ? ' | ' + lastErr : ''}`,
    set onMessage(f) { onMessage = f; },
    set onState(f) { onState = f; },
    _encode: encode, _decode: decode,   // for tests
  };
})();
