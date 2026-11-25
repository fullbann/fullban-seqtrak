/* ============================================
   FULLBAN SEQ-TRAK — Knob v3 (hardware style)
   Metal cap with knurled edge, lit tick ring, glowing value arc
   (bipolar arcs start at the centre), value readout.
   Drag up/down (Shift = fine), mouse wheel, double-click = default.
   ============================================ */

const Knob = (() => {
  const A0 = -135, A1 = 135;              // sweep in degrees, 0 = up
  const NS = 'http://www.w3.org/2000/svg';
  let uidN = 0;

  const pt = (r, a) => { const t = (a - 90) * Math.PI / 180; return [50 + r * Math.cos(t), 50 + r * Math.sin(t)]; };
  function arc(r, a, b) {
    if (b < a) [a, b] = [b, a];
    if (b - a < 0.01) b = a + 0.01;
    const [x1, y1] = pt(r, a), [x2, y2] = pt(r, b);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function cssColor(c) {
    if (!c) return '#2d8cf0';
    const m = String(c).match(/var\(--([^)]+)\)/);
    return m ? (getComputedStyle(document.documentElement).getPropertyValue('--' + m[1]).trim() || '#2d8cf0') : c;
  }

  function create(opts) {
    const min = opts.min ?? 0, max = opts.max ?? 127, def = opts.def ?? min;
    const col = cssColor(opts.color);
    const fmt = opts.fmt || (v => String(v));
    const size = opts.size || 'md';
    const centre = opts.bipolar ? (opts.centre ?? Math.round((min + max + 1) / 2)) : min;
    let value = def;
    const id = 'k' + (++uidN);

    const wrap = document.createElement('div');
    wrap.className = 'knob-wrap knob-' + size;
    wrap.style.setProperty('--kc', col);

    const label = document.createElement('div');
    label.className = 'knob-label';
    label.textContent = opts.label || '';

    const svg = el('svg', { viewBox: '0 0 100 100', class: 'knob-svg' });
    const defs = el('defs', {}, svg);
    defs.innerHTML = `
      <radialGradient id="${id}f" cx="42%" cy="35%" r="70%">
        <stop offset="0" stop-color="#4a5566"/><stop offset=".45" stop-color="#252d3a"/><stop offset="1" stop-color="#11161e"/>
      </radialGradient>
      <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8a96a8"/><stop offset=".5" stop-color="#2c3440"/><stop offset="1" stop-color="#080b10"/>
      </linearGradient>
      <radialGradient id="${id}s" cx="50%" cy="50%" r="50%">
        <stop offset=".7" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
      </radialGradient>
      <filter id="${id}g" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>`;

    // tick ring
    const NT = 25, ticks = [];
    for (let i = 0; i < NT; i++) {
      const a = A0 + (A1 - A0) * i / (NT - 1);
      const [x1, y1] = pt(45, a), [x2, y2] = pt(i % 6 === 0 ? 49.5 : 48, a);
      ticks.push(el('line', { x1, y1, x2, y2, class: 'knob-tick', 'stroke-width': i % 6 === 0 ? 1.6 : 1.1 }, svg));
    }
    el('path', { d: arc(40, A0, A1), class: 'knob-track' }, svg);
    const valArc = el('path', { class: 'knob-arc', stroke: col, filter: `url(#${id}g)` }, svg);
    el('circle', { cx: 50, cy: 53, r: 36, fill: `url(#${id}s)` }, svg);            // drop shadow
    el('circle', { cx: 50, cy: 50, r: 33, fill: `url(#${id}b)` }, svg);            // bevel
    const knurl = el('g', { class: 'knob-knurl' }, svg);
    for (let i = 0; i < 36; i++) {
      const a = i * 10, [x1, y1] = pt(29.5, a), [x2, y2] = pt(32.5, a);
      el('line', { x1, y1, x2, y2 }, knurl);
    }
    el('circle', { cx: 50, cy: 50, r: 28.5, fill: `url(#${id}f)`, stroke: '#0a0d12', 'stroke-width': 1 }, svg); // face
    el('ellipse', { cx: 46, cy: 38, rx: 15, ry: 8, fill: 'rgba(255,255,255,.07)' }, svg);   // shine
    const rot = el('g', {}, svg);
    el('line', { x1: 50, y1: 25, x2: 50, y2: 38, class: 'knob-pointer', stroke: col, filter: `url(#${id}g)` }, rot);
    el('circle', { cx: 50, cy: 25.5, r: 2.2, fill: '#fff' }, rot);

    const val = document.createElement('div');
    val.className = 'knob-val';

    wrap.append(label, svg, val);

    const angleOf = v => A0 + (A1 - A0) * (v - min) / ((max - min) || 1);

    function draw() {
      const a = angleOf(value), ac = angleOf(centre);
      valArc.setAttribute('d', arc(40, Math.min(a, ac), Math.max(a, ac)));
      rot.setAttribute('transform', `rotate(${a.toFixed(2)} 50 50)`);
      const lo = Math.min(a, ac) - 0.5, hi = Math.max(a, ac) + 0.5;
      ticks.forEach((t, i) => {
        const ta = A0 + (A1 - A0) * i / (NT - 1);
        t.classList.toggle('lit', ta >= lo && ta <= hi);
      });
      val.textContent = fmt(value);
    }

    function set(v, fromUser) {
      v = Math.round(Math.min(max, Math.max(min, v)));
      if (v === value) return;
      value = v; draw();
      if (fromUser && opts.onChange) opts.onChange(value, opts);
    }

    // interaction
    let drag = null;
    svg.addEventListener('pointerdown', e => {
      drag = { y: e.clientY, v: value, acc: 0 };
      svg.setPointerCapture(e.pointerId);
      wrap.classList.add('active');
      e.preventDefault();
    });
    svg.addEventListener('pointermove', e => {
      if (!drag) return;
      const range = max - min;
      const px = e.shiftKey ? 600 : (range <= 12 ? 140 : 220);       // pixels for full travel
      set(drag.v + (drag.y - e.clientY) / px * range, true);
    });
    const end = () => { drag = null; wrap.classList.remove('active'); };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('dblclick', () => set(def, true));
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const step = (max - min) <= 31 ? 1 : (e.shiftKey ? 1 : 3);
      set(value + (e.deltaY < 0 ? step : -step), true);
    }, { passive: false });

    draw();

    wrap.setValue = (v) => {                                // from the unit: no send, brief glow
      const before = value;
      set(v, false);
      if (value !== before) { wrap.classList.remove('synced'); void wrap.offsetWidth; wrap.classList.add('synced'); }
    };
    wrap.getValue = () => value;
    wrap.opts = opts;
    return wrap;
  }

  function buildRow(params, onChange) {
    const row = document.createElement('div');
    row.className = 'knob-row';
    params.forEach(p => row.appendChild(create(Object.assign({}, p, { onChange: p.onChange || onChange }))));
    return row;
  }

  // Small on/off pill
  function toggle(label, on, onChange) {
    const b = document.createElement('button');
    b.className = 'fb-toggle' + (on ? ' on' : '');
    b.innerHTML = `<span class="fb-toggle-led"></span>${label}`;
    b.addEventListener('click', () => { b.classList.toggle('on'); onChange && onChange(b.classList.contains('on')); });
    b.setOn = v => b.classList.toggle('on', !!v);
    return b;
  }

  // Segmented selector
  function segment(labels, idx, onChange) {
    const w = document.createElement('div');
    w.className = 'fb-seg';
    const btns = labels.map((t, i) => {
      const b = document.createElement('button');
      b.textContent = t;
      if (i === idx) b.classList.add('on');
      b.addEventListener('click', () => { w.setIndex(i); onChange && onChange(i); });
      w.appendChild(b);
      return b;
    });
    w.setIndex = i => btns.forEach((b, k) => b.classList.toggle('on', k === i));
    return w;
  }

  return { create, buildRow, toggle, segment };
})();
