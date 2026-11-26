/* ============================================
   FULLBAN SEQ-TRAK — Web MIDI Manager
   Bridge-first: tries localhost Python bridge,
   falls back to WebMIDI.
   ============================================ */

const MIDIManager = (() => {

  let midiAccess = null;
  let selectedInput = null;
  let selectedOutput = null;
  let deviceNum = 0;
  let onConnect = null;
  let onDisconnect = null;
  let onMidiMessage = null;

  // --- Bridge state ---
  let bridgeMode = false;
  // Bridge candidates: the page's own server (when opened from a bridge), the XL, then a PC bridge
  // (an https page can't reach an http bridge, so standalone/hosted copies skip the bridge)
  const bridgeCandidates = [];
  // The hosted (https) copy may still talk to a bridge on THIS computer: browsers allow an https page to
  // reach http://127.0.0.1. So the GitHub page on the PC gets USB MIDI and the local M1 banks too.
  // (The XL bridge is plain http on the LAN, which an https page can't reach.)
  const noBridge = /[?&]direct\b/.test(location.search);
  if (!noBridge) {
    if (location.protocol === 'http:') bridgeCandidates.push(location.origin, 'http://192.168.1.72:8788');
    bridgeCandidates.push('http://127.0.0.1:8787');
  }
  let bridgeURL = bridgeCandidates[0];
  let bridgeStatus = null;
  let bridgeSSE = null;
  let bridgeConnected = false;

  // --- Bridge functions ---
  async function tryBridge() {
    for (const url of bridgeCandidates) {
      try {
        const r = await fetch(url + '/midi/status', { signal: AbortSignal.timeout(1500) });
        if (!r.ok) continue;
        const st = await r.json();
        if (!('connected' in st)) continue;
        console.log('[MIDI] Bridge found at', url, st);
        bridgeURL = url; bridgeMode = true; bridgeConnected = st.connected; bridgeStatus = st;
        setInterval(async () => {
          try { bridgeStatus = await (await fetch(bridgeURL + '/midi/status')).json(); bridgeConnected = bridgeStatus.connected; }
          catch (e) { bridgeStatus = null; }
        }, 1000);
        return true;
      } catch (e) { console.log('[MIDI] No bridge at', url); }
    }
    return false;
  }

  async function bridgeConnect() {
    try {
      const r = await fetch(bridgeURL + '/midi/connect', { method: 'POST' });
      const j = await r.json();
      bridgeConnected = j.ok;
      if (j.ok && onConnect) onConnect({ name: 'SEQTRAK (bridge)' }, { name: 'SEQTRAK (bridge)' });
      return j.ok;
    } catch (e) {
      console.error('[MIDI] Bridge connect failed:', e);
      return false;
    }
  }

  function bridgeStartSSE() {
    if (bridgeSSE) { bridgeSSE.close(); bridgeSSE = null; }
    bridgeSSE = new EventSource(bridgeURL + '/midi/stream');
    bridgeSSE.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'midi' && onMidiMessage) {
          // Convert hex string to byte array
          const hex = msg.hex;
          const bytes = [];
          for (let i = 0; i < hex.length; i += 2) {
            bytes.push(parseInt(hex.substr(i, 2), 16));
          }
          onMidiMessage(bytes);
        }
      } catch (e) {}
    };
    bridgeSSE.onerror = () => {
      console.warn('[MIDI] SSE error');
    };
  }

  // Send queue: one request in flight; a newer message for the same parameter
  // (same SysEx address, or same CC on the same channel) replaces the queued one.
  const sendQueue = [];
  let sending = false;
  const isSeqAddr = ah => (ah >= 0x20 && ah <= 0x2F) || (ah >= 0x70 && ah <= 0x7F);
  function msgKey(d) {
    // only single-value Parameter Changes may replace an older queued one. Sequencer edits (add/delete note: 2x, 7x)
    // and requests share an address but are separate events - every one must go out.
    if (d[0] === 0xF0 && d.length >= 11 && d.length <= 13 && (d[2] & 0xF0) === 0x10 && !isSeqAddr(d[6])) return 'sx' + d[2] + ':' + d[6] + ':' + d[7] + ':' + d[8];
    if ((d[0] & 0xF0) === 0xB0 && d.length <= 3) return 'cc' + d[0] + ':' + d[1];
    return null;
  }
  function bridgeSend(data) {
    const bytes = Array.from(data);
    const k = msgKey(bytes);
    if (k) {
      const i = sendQueue.findIndex(q => q.k === k);
      if (i >= 0) { sendQueue[i].bytes = bytes; return true; }
    }
    sendQueue.push({ k, bytes });
    pump();
    return true;
  }
  async function pump() {
    if (sending) return;
    sending = true;
    while (sendQueue.length) {
      // batch everything queued into one request
      const batch = sendQueue.splice(0, sendQueue.length);
      const hex = batch.map(q => q.bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('')).join('');
      try {
        const r = await fetch(bridgeURL + '/midi/send', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: hex });
        const j = await r.json();
        if (!j.ok) console.warn('[MIDI] Bridge send error:', j.error);
      } catch (e) { console.error('[MIDI] Bridge send failed:', e); }
    }
    sending = false;
  }

  function bridgeDiag() {
    const st = bridgeStatus;
    if (!st) return 'BRIDGE ' + bridgeURL + ' | offline';
    return 'BRIDGE ' + bridgeURL + ' | ' + (st.connected ? 'SEQTRAK ' + (st.target || 'connected') : 'SEQTRAK not found') +
      ' | in: ' + st.in_count + ' | out: ' + st.out_count + (st.error ? ' | ' + st.error : '');
  }

  // --- Init: try bridge first, then WebMIDI ---
  async function init() {
    // Try bridge first
    if (await tryBridge()) {
      console.log('[MIDI] Using bridge mode');
      return true;
    }
    // Fall back to WebMIDI
    console.log('[MIDI] Falling back to WebMIDI');
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI not supported');
      return false;
    }
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: true });
      midiAccess.onstatechange = handleStateChange;
      return true;
    } catch (e) {
      console.warn('SysEx denied, trying basic MIDI...');
      try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        midiAccess.onstatechange = handleStateChange;
        return true;
      } catch (e2) {
        console.error('MIDI access denied:', e2);
        return false;
      }
    }
  }

  function getDevices() {
    if (bridgeMode) {
      // In bridge mode, the bridge handles device selection
      return {
        inputs: [{ id: 'bridge-in', name: 'SEQTRAK (bridge)', port: null }],
        outputs: [{ id: 'bridge-out', name: 'SEQTRAK (bridge)', port: null }],
      };
    }
    if (!midiAccess) return { inputs: [], outputs: [] };
    const inputs = [];
    const outputs = [];
    midiAccess.inputs.forEach(input => {
      inputs.push({ id: input.id, name: input.name, port: input });
    });
    midiAccess.outputs.forEach(output => {
      outputs.push({ id: output.id, name: output.name, port: output });
    });
    return { inputs, outputs };
  }

  function findSeqtrak() {
    if (bridgeMode) {
      return {
        input: { id: 'bridge-in', name: 'SEQTRAK (bridge)', port: null },
        output: { id: 'bridge-out', name: 'SEQTRAK (bridge)', port: null },
      };
    }
    const devices = getDevices();
    const input = devices.inputs.find(d =>
      d.name && d.name.toLowerCase().includes('seqtrak')
    );
    const output = devices.outputs.find(d =>
      d.name && d.name.toLowerCase().includes('seqtrak')
    );
    return { input, output };
  }

  function connect(inputDevice, outputDevice) {
    if (bridgeMode) {
      bridgeConnect().then(ok => {
        if (ok) bridgeStartSSE();
      });
      return true;
    }

    if (selectedInput) {
      selectedInput.port.onmidimessage = null;
    }

    selectedInput = inputDevice;
    selectedOutput = outputDevice;

    if (selectedInput) {
      selectedInput.port.onmidimessage = handleMessage;
      selectedInput.port.open().catch(e => { lastError = 'IN open failed: ' + e.message; });
    }
    if (selectedOutput) {
      selectedOutput.port.open().catch(e => { lastError = 'OUT open failed: ' + e.message; });
    }

    if (onConnect) onConnect(selectedInput, selectedOutput);
    return true;
  }

  let lastError = '';
  let inCount = 0;
  function diag() {
    if (bleOn) return BLEMidi.diag();
    if (bridgeMode) return bridgeDiag();
    const o = selectedOutput && selectedOutput.port, i = selectedInput && selectedInput.port;
    return 'SysEx: ' + (midiAccess && midiAccess.sysexEnabled ? 'yes' : 'NO') + ' | OUT: ' + (o ? o.name + ' [' + o.state + '/' + o.connection + ']' : 'none') +
      ' | IN: ' + (i ? i.name + ' [' + i.state + '/' + i.connection + ']' : 'none') +
      ' | received: ' + inCount + (lastError ? ' | ' + lastError : '');
  }

  function autoConnect() {
    if (bridgeMode) {
      bridgeConnect().then(ok => {
        if (ok) bridgeStartSSE();
      });
      return true;
    }
    const sq = findSeqtrak();
    if (sq.input && sq.output) {
      connect(sq.input, sq.output);
      return true;
    }
    return false;
  }

  function disconnect() {
    if (bridgeMode) {
      if (bridgeSSE) { bridgeSSE.close(); bridgeSSE = null; }
      fetch(bridgeURL + '/midi/disconnect', { method: 'POST' }).catch(() => {});
      bridgeConnected = false;
      if (onDisconnect) onDisconnect();
      return;
    }
    if (selectedInput) {
      selectedInput.port.onmidimessage = null;
    }
    selectedInput = null;
    selectedOutput = null;
    if (onDisconnect) onDisconnect();
  }

  // ---- Bluetooth (BLE-MIDI) ----
  let bleOn = false;
  let onBleState = null;
  function wireBLE() {
    BLEMidi.onMessage = (m) => { inCount++; if (onMidiMessage) onMidiMessage(m); };
    BLEMidi.onState = (st) => {
      const was = bleOn;
      bleOn = st === 'connected';
      if (onBleState) onBleState(st);
      if (bleOn && !was && onConnect) onConnect({ name: BLEMidi.name() }, { name: BLEMidi.name() });
      if (!bleOn && was && st !== 'reconnecting' && onDisconnect) onDisconnect();
    };
  }
  async function connectBLE() {
    wireBLE();
    const name = await BLEMidi.connect();
    bleOn = true;
    return name;
  }
  async function autoBLE() {
    if (typeof BLEMidi === 'undefined') return null;
    wireBLE();
    return BLEMidi.reconnectRemembered();
  }

  function isConnected() {
    if (bleOn) return true;
    if (bridgeMode) return bridgeConnected;
    return selectedOutput !== null;
  }

  function getConnectionName() {
    if (bleOn) return BLEMidi.name();
    if (bridgeMode) return bridgeConnected ? 'SEQTRAK (bridge)' : null;
    return selectedOutput ? selectedOutput.name : null;
  }

  function send(data) {
    if (bleOn) return BLEMidi.send(data);
    if (bridgeMode) {
      bridgeSend(data);
      return true;
    }
    if (!selectedOutput) return false;
    try { selectedOutput.port.send(data); } catch (e) { lastError = 'SEND failed: ' + e.message; return false; }
    return true;
  }

  function sendCC(channel, cc, value) {
    return send(SEQTRAK.buildCC(channel, cc, value));
  }

  function sendDxCommon(paramKey, value) {
    const msg = SEQTRAK.buildDxCommonMsg(deviceNum, paramKey, value);
    if (msg) return send(msg);
    return false;
  }

  function sendDxOp(opIndex, paramKey, value) {
    const msg = SEQTRAK.buildDxOpMsg(deviceNum, opIndex, paramKey, value);
    if (msg) return send(msg);
    return false;
  }

  function handleMessage(event) {
    inCount++;
    if (onMidiMessage) onMidiMessage(event.data);
  }

  function handleStateChange(event) {
    const port = event.port;
    if (port.state === 'disconnected') {
      if (selectedInput && selectedInput.id === port.id) {
        disconnect();
      }
      if (selectedOutput && selectedOutput.id === port.id) {
        disconnect();
      }
    }
  }

  return {
    init,
    getDevices,
    findSeqtrak,
    connect,
    autoConnect,
    disconnect,
    isConnected,
    getConnectionName,
    bridgeURL: () => (bridgeMode ? bridgeURL : null),
    send,
    sendCC,
    sendDxCommon,
    sendDxOp,
    diag,
    connectBLE, autoBLE,
    set onBleState(fn) { onBleState = fn; },
    bleSupported: () => (typeof BLEMidi !== 'undefined') && BLEMidi.supported(),
    inject: (d) => { if (onMidiMessage) onMidiMessage(d); },   // test hook: feed a message as if it came from the unit
    get bridgeMode() { return bridgeMode; },
    set onConnect(fn) { onConnect = fn; },
    set onDisconnect(fn) { onDisconnect = fn; },
    set onMidiMessage(fn) { onMidiMessage = fn; },
  };

})();
