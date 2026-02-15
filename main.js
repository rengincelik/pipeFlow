
'use strict';

// ═══════════════════════════════════
// CATALOG DATA
// ═══════════════════════════════════
const DN_LIST = [
  {dn:'DN15',d:15.8},{dn:'DN20',d:21.3},{dn:'DN25',d:26.9},{dn:'DN32',d:35.4},
  {dn:'DN40',d:41.9},{dn:'DN50',d:53.1},{dn:'DN65',d:68.9},{dn:'DN80',d:82.5},
  {dn:'DN100',d:106.1},{dn:'DN125',d:131.7},{dn:'DN150',d:159.3},{dn:'DN200',d:206.5},
];
const MATERIALS = [
  {id:'steel_new',  name:'Seamless Steel (new)', eps:0.046},
  {id:'steel_old',  name:'Welded Steel (old)',   eps:0.26},
  {id:'cast_iron',  name:'Cast Iron',            eps:0.26},
  {id:'pvc_pe',     name:'PVC / PE',             eps:0.003},
  {id:'copper',     name:'Copper / Brass',       eps:0.0015},
];

const CATALOG_DEF = [
  {
    group:'Pipes', items:[
      {type:'pipe', subtype:'straight', name:'Straight Pipe', desc:'DN selectable', diameter_mm:50, length_m:5, dz_m:0, material:'steel_new', eps:0.046},
      {type:'pipe', subtype:'reducing', name:'Reducer',       desc:'Diameter change', d_in_mm:50, d_out_mm:25, length_m:0.3, material:'steel_new', eps:0.046},
    ]
  },
  {
    group:'Elbows', expandable:true,
    items:[
      {type:'elbow', subtype:'elbow_90s', name:'90° Short R', desc:'r/D≈1.0', K:0.90},
      {type:'elbow', subtype:'elbow_90l', name:'90° Long R',  desc:'r/D≈1.5', K:0.60},
      {type:'elbow', subtype:'elbow_45',  name:'45° Elbow',   desc:'Standard', K:0.40},
      {type:'elbow', subtype:'elbow_180', name:'180° U-Bend', desc:'Return bend', K:1.50},
    ]
  },
  {
    group:'Valves', expandable:true,
    items:[
      {type:'valve', subtype:'gate',       name:'Gate Valve',     desc:'K=0.20', K:0.20},
      {type:'valve', subtype:'ball',       name:'Ball Valve',     desc:'K=0.10', K:0.10},
      {type:'valve', subtype:'butterfly',  name:'Butterfly',      desc:'K=0.80', K:0.80},
      {type:'valve', subtype:'globe',      name:'Globe Valve',    desc:'K=6.00', K:6.00},
      {type:'valve', subtype:'check',      name:'Check Valve',    desc:'K=2.50', K:2.50},
      {type:'valve', subtype:'prv',        name:'PRV',            desc:'P_set',  K:null, special:'prv', P_set_bar:1.0},
      {type:'valve', subtype:'flowmeter',  name:'Flow Meter',     desc:'K=1.50', K:1.50},
    ]
  },
  {
    group:'Pumps', expandable:true,
    items:[
      {type:'pump', subtype:'centrifugal', name:'Centrifugal Pump', desc:'Add head', head_m:20, efficiency:0.75},
    ]
  },
  {
    group:'Instruments', items:[
      {type:'meter', subtype:'meter', name:'Measurement Point', desc:'P/v/Re readout', K:0},
    ]
  },
];

// ═══════════════════════════════════
// STATE
// ═══════════════════════════════════
let line       = [];
let calcRes    = [];
let selected   = null;
let showPG     = false;
let showLabels = true;
let idCtr      = 0;
let dragItem   = null;
let dropIdx    = null;

// Layout constants
const PAD=60, PIPE_MIN=70, PIPE_MAX=170, FIT_W=54, PUMP_W=58, METER_W=38, ROW_Y=160, COMP_H=60;

// ═══════════════════════════════════
// CATALOG RENDER
// ═══════════════════════════════════
function renderCatalog() {
  let html = '';
  CATALOG_DEF.forEach((grp, gi) => {
    html += `<div class="cat-group"><div class="cat-group-title">${grp.group}</div>`;
    if (grp.expandable) {
      html += `<div class="cat-expand-row" onclick="toggleGroup(${gi})">
        <div class="cat-icon">${getThumb(grp.items[0].type)}</div>
        <div style="flex:1"><div class="cat-name">${grp.group}</div><div class="cat-desc">${grp.items.length} subtypes</div></div>
        <span class="expand-icon" id="ei_${gi}">▶</span>
      </div>
      <div class="subtypes-wrap" id="sw_${gi}">`;
      grp.items.forEach((item,ii) => {
        html += `<div class="cat-subitem" draggable="true" data-gi="${gi}" data-ii="${ii}" ondragstart="onCatDrag(event,this)">
          <span class="cat-subitem-name">${item.name}</span>
          <span class="cat-subitem-k">${item.K!=null?'K='+item.K:item.special||''}</span>
        </div>`;
      });
      html += `</div>`;
    } else {
      grp.items.forEach((item,ii) => {
        html += `<div class="cat-item" draggable="true" data-gi="${gi}" data-ii="${ii}" ondragstart="onCatDrag(event,this)">
          <div class="cat-icon">${getThumb(item.type)}</div>
          <div><div class="cat-name">${item.name}</div><div class="cat-desc">${item.desc}</div></div>
        </div>`;
      });
    }
    html += `</div>`;
  });
  document.getElementById('cat-body').innerHTML = html;
}

function toggleGroup(gi) {
  const sw = document.getElementById('sw_'+gi);
  const ei = document.getElementById('ei_'+gi);
  sw.classList.toggle('open');
  ei.classList.toggle('open');
}

function getThumb(type) {
  const s = {
    pipe: `<svg width="34" height="22"><line x1="0" y1="8" x2="34" y2="8" stroke="#3d9ef5" stroke-width="1.5"/><line x1="0" y1="14" x2="34" y2="14" stroke="#3d9ef5" stroke-width="1.5"/><line x1="0" y1="8" x2="0" y2="14" stroke="#3d9ef5" stroke-width="1.5"/><line x1="34" y1="8" x2="34" y2="14" stroke="#3d9ef5" stroke-width="1.5"/></svg>`,
    elbow:`<svg width="34" height="22"><path d="M0,11 L14,11 Q20,11 20,17 L20,22" fill="none" stroke="#f0a500" stroke-width="1.5"/></svg>`,
    valve:`<svg width="34" height="22"><line x1="0" y1="11" x2="9" y2="11" stroke="#e05c00" stroke-width="1.5"/><polygon points="9,5 23,11 9,17" fill="none" stroke="#e05c00" stroke-width="1.2"/><polygon points="23,5 9,11 23,17" fill="none" stroke="#e05c00" stroke-width="1.2"/><line x1="23" y1="11" x2="34" y2="11" stroke="#e05c00" stroke-width="1.5"/></svg>`,
    pump: `<svg width="34" height="22"><circle cx="17" cy="11" r="8" fill="none" stroke="#2ecc71" stroke-width="1.5"/><line x1="0" y1="11" x2="9" y2="11" stroke="#2ecc71" stroke-width="1.5"/><line x1="25" y1="11" x2="34" y2="11" stroke="#2ecc71" stroke-width="1.5"/><path d="M17,11 L14,7 L21,9" fill="#2ecc71" opacity="0.7"/></svg>`,
    meter:`<svg width="34" height="22"><line x1="0" y1="11" x2="34" y2="11" stroke="#606878" stroke-width="1" stroke-dasharray="3,2"/><circle cx="17" cy="11" r="6" fill="none" stroke="#f0a500" stroke-width="1.5"/><line x1="17" y1="5" x2="17" y2="1" stroke="#f0a500" stroke-width="1"/></svg>`,
  };
  return s[type] || '<svg width="34" height="22"></svg>';
}

// ═══════════════════════════════════
// DRAG & DROP
// ═══════════════════════════════════
function onCatDrag(evt, el) {
  const gi = parseInt(el.dataset.gi);
  const ii = parseInt(el.dataset.ii);
  dragItem = JSON.parse(JSON.stringify(CATALOG_DEF[gi].items[ii]));
  evt.dataTransfer.effectAllowed = 'copy';
  evt.dataTransfer.setData('text/plain', JSON.stringify(dragItem));
}

function onDragOver(evt) {
  evt.preventDefault();
  evt.dataTransfer.dropEffect = 'copy';
  document.getElementById('canvas-scroll').classList.add('drag-over');
  if (dragItem) {
    const rect = document.getElementById('canvas-scroll').getBoundingClientRect();
    dropIdx = calcDropIdx(evt.clientX - rect.left + document.getElementById('canvas-scroll').scrollLeft);
    renderSVG();
  }
}

function onDragLeave() {
  document.getElementById('canvas-scroll').classList.remove('drag-over');
  dropIdx = null;
  renderSVG();
}

function onDrop(evt) {
  evt.preventDefault();
  document.getElementById('canvas-scroll').classList.remove('drag-over');
  const raw = evt.dataTransfer.getData('text/plain');
  if (!raw) return;
  const template = JSON.parse(raw);
  const comp = makeComp(template);
  const idx  = dropIdx !== null ? dropIdx : line.length;
  line.splice(idx, 0, comp);
  dropIdx = null; dragItem = null;
  runCalc();
  renderSVG();
  selectComp(idx);
  updateStatus();
}

function calcDropIdx(mouseX) {
  if (!line.length) return 0;
  const lyt = layout();
  for (let i = 0; i < lyt.length; i++) {
    if (mouseX < lyt[i].x + lyt[i].w / 2) return i;
  }
  return line.length;
}

function makeComp(tpl) {
  const c = {...tpl, _id: ++idCtr};
  const prev = line.length > 0 ? line[line.length-1] : null;
  const prevD = prev ? (prev.d_out_mm || prev.diameter_mm || 50) : 50;
  if (c.type !== 'pipe') c.diameter_mm = prevD;
  if (c.type === 'pipe' && c.subtype === 'reducing') {
    c.d_in_mm  = prevD;
    c.d_out_mm = Math.max(15, Math.floor(prevD/2));
  } else if (c.type === 'pipe') {
    c.diameter_mm = c.diameter_mm || prevD;
  }
  return c;
}

// ═══════════════════════════════════
// LAYOUT
// ═══════════════════════════════════
function compW(comp) {
  if (comp.type==='pipe') return Math.min(PIPE_MAX, Math.max(PIPE_MIN, (comp.length_m||5)*15));
  if (comp.type==='meter') return METER_W;
  if (comp.type==='pump')  return PUMP_W;
  return FIT_W;
}

function layout() {
  let x = PAD + 28;
  return line.map(comp => {
    const w = compW(comp);
    const r = {x, w};
    x += w + 4;
    return r;
  });
}

function yPositions(lyt) {
  let cumDz = 0;
  return lyt.map((l,i) => {
    const comp = line[i];
    const y = ROW_Y - cumDz * 20;
    if (comp.type==='pipe') cumDz += (comp.dz_m || 0);
    return y;
  });
}

// ═══════════════════════════════════
// SVG RENDER
// ═══════════════════════════════════
function renderSVG() {
  const svgEl = document.getElementById('svg-canvas');
  const hint  = document.getElementById('empty-hint');

  if (!line.length && !dragItem) {
    svgEl.innerHTML = '';
    svgEl.setAttribute('width','100%');
    svgEl.setAttribute('height','100%');
    hint.classList.remove('hidden');
    document.getElementById('cv-info').textContent = 'Drag components from catalog to start';
    return;
  }
  hint.classList.add('hidden');

  const lyt = layout();
  const yp  = yPositions(lyt);

  const totalW = lyt.length
    ? lyt[lyt.length-1].x + lyt[lyt.length-1].w + PAD + 40
    : 600;
  const minY   = Math.min(...yp, ROW_Y) - 80;
  const maxY   = Math.max(...yp, ROW_Y) + 100;
  const totalH = Math.max(320, maxY - minY);

  svgEl.setAttribute('width', totalW);
  svgEl.setAttribute('height', totalH);
  svgEl.setAttribute('viewBox', `0 ${minY} ${totalW} ${totalH}`);

  let out = '';

  // Spine
  out += buildSpine(lyt, yp);

  // Drop indicator
  if (dropIdx !== null) {
    const ix = dropIdx < lyt.length
      ? lyt[dropIdx].x - 5
      : (lyt.length ? lyt[lyt.length-1].x + lyt[lyt.length-1].w + 5 : PAD+28);
    const iy = yp[Math.min(dropIdx, yp.length-1)] || ROW_Y;
    out += `<line x1="${ix}" y1="${iy-30}" x2="${ix}" y2="${iy+30}" stroke="#f0a500" stroke-width="2" stroke-dasharray="4,3" opacity="0.8"/>`;
  }

  // Inlet node
  out += node(PAD, yp[0]||ROW_Y, 'A', '#2ecc71');

  // Components
  lyt.forEach((l,i) => {
    out += compSVG(line[i], l.x, yp[i], l.w, selected===i, calcRes[i]||null);
  });

  // Outlet node
  if (lyt.length) {
    const last = lyt[lyt.length-1];
    out += node(last.x+last.w+8, yp[yp.length-1], 'B', '#e74c3c');
  }

  // Pressure gradient
  if (showPG && calcRes.length) out += pressureGradient(lyt, yp);

  svgEl.innerHTML = out;

  // Click handlers
  lyt.forEach((_,i) => {
    const g = svgEl.querySelector(`#c${line[i]._id}`);
    if (g) g.addEventListener('click', e => { e.stopPropagation(); selectComp(i); });
  });

  svgEl.addEventListener('click', e => { if (e.target===svgEl) deselect(); });

  // Update info
  if (line.length) {
    const lastRes = calcRes[calcRes.length-1];
    document.getElementById('cv-info').textContent =
      lastRes ? `${line.length} components  ·  P_out = ${lastRes.P_out} bar` : `${line.length} components`;
  }
}

function buildSpine(lyt, yp) {
  if (!lyt.length) return '';
  let d = `M ${PAD+10} ${yp[0]||ROW_Y}`;
  lyt.forEach((l,i) => {
    const y = yp[i];
    d += ` L ${l.x} ${y} L ${l.x+l.w} ${y}`;
    if (i < lyt.length-1 && yp[i+1] !== y) {
      d += ` L ${l.x+l.w+2} ${y} L ${l.x+l.w+2} ${yp[i+1]}`;
    }
  });
  const last = lyt[lyt.length-1];
  d += ` L ${last.x+last.w+20} ${yp[yp.length-1]}`;
  return `<path d="${d}" fill="none" stroke="#2a2f3a" stroke-width="1.5"/>`;
}

function node(x, y, label, color) {
  return `<circle cx="${x}" cy="${y}" r="5" fill="${color}" opacity="0.85"/>
    <text x="${x}" y="${y-12}" text-anchor="middle" font-family="IBM Plex Mono" font-size="11" font-weight="700" fill="${color}">${label}</text>`;
}

function pressureGradient(lyt, yp) {
  if (!calcRes.length) return '';
  const maxP  = calcRes[0].P_in || 2;
  const scale = 45 / maxP;
  let d = '';
  lyt.forEach((l,i) => {
    const res = calcRes[i]; if (!res) return;
    const cx = l.x + l.w/2;
    const cy = yp[i] - res.P_in * scale - 22;
    d += `${i===0?'M':'L'} ${cx} ${cy} `;
  });
  return `<path d="${d}" fill="none" stroke="rgba(61,158,245,0.5)" stroke-width="1.5" stroke-dasharray="5,3"/>
    <text x="${lyt[0].x}" y="${yp[0] - calcRes[0].P_in*scale - 30}" font-family="IBM Plex Mono" font-size="8" fill="rgba(61,158,245,0.6)">P (bar)</text>`;
}

// ─── COMPONENT SVG ──────────────────────────────────────
function compSVG(comp, x, y, w, isSel, res) {
  const sel    = isSel ? 'sel' : '';
  const stroke = isSel ? `stroke="#f0a500" stroke-width="2"` : `stroke="#252830" stroke-width="1"`;
  let body = '';

  if (comp.type==='pipe')   body = pipeSVG(comp,x,y,w,stroke,res);
  if (comp.type==='elbow')  body = elbowSVG(comp,x,y,w,stroke);
  if (comp.type==='valve')  body = valveSVG(comp,x,y,w,stroke);
  if (comp.type==='pump')   body = pumpSVG(comp,x,y,w,stroke,res);
  if (comp.type==='meter')  body = meterSVG(comp,x,y,w,stroke,res);

  // Warning dot
  const warns = getWarns(comp, res);
  let warnDot = '';
  if (warns.length) {
    const wc = warns.some(w=>w.lvl==='err') ? '#e74c3c' : '#f1c40f';
    warnDot = `<circle cx="${x+w-5}" cy="${y-20}" r="5" fill="${wc}" opacity="0.9"/>
      <text x="${x+w-5}" y="${y-17}" text-anchor="middle" font-family="IBM Plex Mono" font-size="7" fill="#000" font-weight="700">!</text>`;
  }

  return `<g id="c${comp._id}" class="c-group ${sel}">${body}${warnDot}</g>`;
}

function pipeSVG(comp, x, y, w, stroke, res) {
  const isRed = comp.subtype==='reducing';
  const color = isRed ? '#9b59b6' : '#3d9ef5';
  const label = isRed ? `${comp.d_in_mm||50}→${comp.d_out_mm||25}mm` : `⌀${comp.diameter_mm||50}mm`;
  const val   = isRed ? '' : `${comp.length_m||5}m`;
  return `
    <rect x="${x}" y="${y-9}" width="${w}" height="18" fill="#0e0f12" ${stroke} class="c-bg c-outline" rx="1"/>
    ${isRed
      ? `<polygon points="${x},${y-8} ${x+w},${y-5} ${x+w},${y+5} ${x},${y+8}" fill="rgba(155,89,182,0.12)" stroke="${color}" stroke-width="1"/>`
      : `<line x1="${x+2}" y1="${y}" x2="${x+w-2}" y2="${y}" stroke="${color}" stroke-width="1" opacity="0.4"/>`
    }
    ${showLabels ? `<text x="${x+w/2}" y="${y-14}" text-anchor="middle" font-family="IBM Plex Mono" font-size="8" fill="#5a6070">${label}</text>
      <text x="${x+w/2}" y="${y+22}" text-anchor="middle" font-family="IBM Plex Mono" font-size="8" fill="#5a6070">${val}</text>
      ${res ? `<text x="${x+w/2}" y="${y+32}" text-anchor="middle" font-family="IBM Plex Mono" font-size="8" fill="#3d9ef5">v=${res.v}m/s</text>` : ''}` : ''}
  `;
}

function elbowSVG(comp, x, y, w, stroke) {
  const cx = x+w/2, color = '#f0a500';
  const angle = comp.subtype==='elbow_45' ? '45°' : comp.subtype==='elbow_180' ? '180°' : '90°';
  return `
    <rect x="${x}" y="${y-22}" width="${w}" height="44" fill="rgba(240,165,0,0.04)" ${stroke} class="c-bg c-outline" rx="1"/>
    <path d="M ${x} ${y} Q ${cx} ${y} ${cx} ${y+18}" fill="none" stroke="${color}" stroke-width="2"/>
    ${showLabels ? `<text x="${cx}" y="${y-26}" text-anchor="middle" font-family="IBM Plex Mono" font-size="8" fill="#5a6070">${angle}</text>
      <text x="${cx}" y="${y+34}" text-anchor="middle" font-family="IBM Plex Mono" font-size="8" fill="#6a7480">K=${comp.K}</text>` : ''}
  `;
}

function valveSVG(comp, x, y, w, stroke) {
  const cx = x+w/2, cy = y;
  const isPRV = comp.special==='prv';
  const isChk = comp.subtype==='check';
  const color = isPRV ? '#e74c3c' : '#e05c00';
  return `
    <rect x="${x}" y="${cy-22}" width="${w}" height="44" fill="rgba(224,92,0,0.04)" ${stroke} class="c-bg c-outline" rx="1"/>
    <line x1="${x}" y1="${cy}" x2="${cx-11}" y2="${cy}" stroke="${color}" stroke-width="1.5"/>
    <polygon points="${cx-11},${cy-9} ${cx+11},${cy} ${cx-11},${cy+9}" fill="none" stroke="${color}" stroke-width="1.2"/>
    ${isChk
      ? `<polygon points="${cx+11},${cy-9} ${cx-3},${cy} ${cx+11},${cy+9}" fill="rgba(224,92,0,0.15)" stroke="${color}" stroke-width="1.2"/>`
      : `<polygon points="${cx+11},${cy-9} ${cx-11},${cy} ${cx+11},${cy+9}" fill="none" stroke="${color}" stroke-width="1.2"/>`
    }
    <line x1="${cx+11}" y1="${cy}" x2="${x+w}" y2="${cy}" stroke="${color}" stroke-width="1.5"/>
    ${isPRV ? `<line x1="${cx}" y1="${cy-11}" x2="${cx}" y2="${cy-20}" stroke="${color}" stroke-width="1"/>
      <path d="M${cx-5},${cy-20} Q${cx},${cy-27} ${cx+5},${cy-20}" fill="none" stroke="${color}" stroke-width="1"/>` : ''}
    ${showLabels ? `<text x="${cx}" y="${cy-26}" text-anchor="middle" font-family="IBM Plex Mono" font-size="7" fill="#5a6070">${comp.name}</text>
      ${comp.K!=null ? `<text x="${cx}" y="${cy+34}" text-anchor="middle" font-family="IBM Plex Mono" font-size="8" fill="#6a7480">K=${comp.K}</text>` : ''}` : ''}
  `;
}

function pumpSVG(comp, x, y, w, stroke, res) {
  const cx=x+w/2, cy=y, r=16;
  return `
    <rect x="${x}" y="${cy-26}" width="${w}" height="52" fill="rgba(46,204,113,0.04)" ${stroke} class="c-bg c-outline" rx="1"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(46,204,113,0.07)" stroke="#2ecc71" stroke-width="1.5"/>
    <line x1="${x}" y1="${cy}" x2="${cx-r}" y2="${cy}" stroke="#2ecc71" stroke-width="1.5"/>
    <line x1="${cx+r}" y1="${cy}" x2="${x+w}" y2="${cy}" stroke="#2ecc71" stroke-width="1.5"/>
    <path d="M${cx},${cy} L${cx-5},${cy-7} L${cx+7},${cy-3} Z" fill="#2ecc71" opacity="0.7"/>
    ${showLabels ? `<text x="${cx}" y="${cy-30}" text-anchor="middle" font-family="IBM Plex Mono" font-size="8" fill="#2ecc71">PUMP</text>
      <text x="${cx}" y="${cy+30}" text-anchor="middle" font-family="IBM Plex Mono" font-size="9" fill="#2ecc71">+${comp.head_m||20}m</text>` : ''}
  `;
}

function meterSVG(comp, x, y, w, stroke, res) {
  const cx=x+w/2, cy=y;
  return `
    <line x1="${x}" y1="${cy}" x2="${x+w}" y2="${cy}" stroke="#2a2f3a" stroke-width="1" stroke-dasharray="3,2"/>
    <circle cx="${cx}" cy="${cy}" r="11" fill="rgba(240,165,0,0.06)" stroke="#f0a500" stroke-width="1.5" class="c-bg c-outline"/>
    <line x1="${cx}" y1="${cy-11}" x2="${cx}" y2="${cy-20}" stroke="#f0a500" stroke-width="1"/>
    ${showLabels ? `<text x="${cx}" y="${cy-24}" text-anchor="middle" font-family="IBM Plex Mono" font-size="8" fill="#f0a500">${comp.id||'M'}</text>` : ''}
    ${res ? `<text x="${cx}" y="${cy+26}" text-anchor="middle" font-family="IBM Plex Mono" font-size="8" fill="#f0a500">${res.P_out}bar</text>` : ''}
  `;
}

// ═══════════════════════════════════
// SELECT / PROPS
// ═══════════════════════════════════
function selectComp(idx) {
  selected = idx;
  renderSVG();
  renderProps();
  document.getElementById('btn-del').style.display = 'block';
}

function deselect() {
  selected = null;
  renderSVG();
  document.getElementById('prop-body').innerHTML = '<div id="prop-empty"><div style="font-size:24px;opacity:0.2">◈</div><div>SELECT A COMPONENT</div></div>';
  document.getElementById('btn-del').style.display = 'none';
}

function renderProps() {
  if (selected === null) return;
  const comp = line[selected];
  const res  = calcRes[selected] || null;
  let h = '';

  h += `<div class="ps"><div class="ps-title">Component</div>
    <div class="pr"><span class="pl">Type</span><span class="pv">${comp.name||comp.type}</span></div>
    ${comp.subtype ? `<div class="pr"><span class="pl">Subtype</span><span class="pv">${comp.subtype.replace(/_/g,' ')}</span></div>` : ''}
  </div>`;

  const warns = getWarns(comp, res);
  h += `<div class="ps">`;
  if (!warns.length) h += `<div class="badge ok">✓ No issues</div>`;
  warns.forEach(w => h += `<div class="badge ${w.lvl}">⚠ ${w.msg}</div>`);
  h += `</div>`;

  h += `<div class="ps"><div class="ps-title">Parameters</div>`;

  if (comp.type==='pipe') {
    if (comp.subtype !== 'reducing') {
      h += `<div class="pr"><span class="pl">Diameter</span>
        <select class="p-select" onchange="upd(${selected},'diameter_mm',parseFloat(this.value))">
          ${DN_LIST.map(d=>`<option value="${d.d}" ${Math.abs(d.d-(comp.diameter_mm||50))<1?'selected':''}>${d.dn} (${d.d}mm)</option>`).join('')}
        </select></div>`;
      h += `<div class="pr"><span class="pl">Length</span>
        <input class="p-input" type="number" value="${comp.length_m||5}" step="0.5" min="0.1" onchange="upd(${selected},'length_m',+this.value)">
        <span class="pu">m</span></div>`;
      h += `<div class="pr"><span class="pl">Δz</span>
        <input class="p-input" type="number" value="${comp.dz_m||0}" step="0.5" onchange="upd(${selected},'dz_m',+this.value)">
        <span class="pu">m</span></div>`;
    } else {
      h += `<div class="pr"><span class="pl">D in</span><input class="p-input" type="number" value="${comp.d_in_mm||50}" onchange="upd(${selected},'d_in_mm',+this.value)"><span class="pu">mm</span></div>`;
      h += `<div class="pr"><span class="pl">D out</span><input class="p-input" type="number" value="${comp.d_out_mm||25}" onchange="upd(${selected},'d_out_mm',+this.value)"><span class="pu">mm</span></div>`;
      h += `<div class="pr"><span class="pl">Length</span><input class="p-input" type="number" value="${comp.length_m||0.3}" step="0.05" onchange="upd(${selected},'length_m',+this.value)"><span class="pu">m</span></div>`;
    }
    h += `<div class="pr"><span class="pl">Material</span>
      <select class="p-select" onchange="updMat(${selected},this.value)">
        ${MATERIALS.map(m=>`<option value="${m.id}" ${comp.material===m.id?'selected':''}>${m.name}</option>`).join('')}
      </select></div>`;
    h += `<div class="pr"><span class="pl">Roughness</span><span class="pv" id="eps-display">${comp.eps||0.046}</span><span class="pu">mm</span></div>`;
  }

  if (comp.type==='elbow') {
    h += `<div class="pr"><span class="pl">K value</span><span class="pv">${comp.K}</span></div>`;
    h += `<div class="pr"><span class="pl">Diameter</span><span class="pv">${comp.diameter_mm||'—'} mm</span></div>`;
  }

  if (comp.type==='valve') {
    h += `<div class="pr"><span class="pl">Diameter</span><span class="pv">${comp.diameter_mm||'—'} mm</span></div>`;
    if (comp.special==='prv') {
      h += `<div class="pr"><span class="pl">P set</span>
        <input class="p-input" type="number" value="${comp.P_set_bar||1.0}" step="0.1" min="0" onchange="upd(${selected},'P_set_bar',+this.value)">
        <span class="pu">bar</span></div>`;
    } else {
      h += `<div class="pr"><span class="pl">K value</span><span class="pv">${comp.K}</span></div>`;
    }
  }

  if (comp.type==='pump') {
    h += `<div class="pr"><span class="pl">Head</span>
      <input class="p-input" type="number" value="${comp.head_m||20}" step="1" onchange="upd(${selected},'head_m',+this.value)">
      <span class="pu">m</span></div>`;
    h += `<div class="pr"><span class="pl">Efficiency</span>
      <input class="p-input" type="number" value="${comp.efficiency||0.75}" step="0.01" min="0.1" max="1" onchange="upd(${selected},'efficiency',+this.value)"></div>`;
  }

  if (comp.type==='meter') {
    h += `<div class="pr"><span class="pl">ID</span>
      <input class="p-input" type="text" value="${comp.id||'M1'}" onchange="upd(${selected},'id',this.value)"></div>`;
  }

  h += `</div>`;

  if (res) {
    h += `<div class="ps"><div class="ps-title">Live Readings</div>
      <div class="reading-card">
        <div class="r-row"><span class="r-lbl">P inlet</span><span><span class="r-val">${res.P_in}</span> <span class="r-unit">bar</span></span></div>
        <div class="r-row"><span class="r-lbl">P outlet</span><span><span class="r-val" style="${res.P_out<0.3?'color:var(--red)':''}">${res.P_out}</span> <span class="r-unit">bar</span></span></div>
        <div class="r-row"><span class="r-lbl">ΔP</span><span><span class="r-val" style="color:var(--accent)">${res.dP}</span> <span class="r-unit">bar</span></span></div>
        <div class="r-row"><span class="r-lbl">Velocity</span><span><span class="r-val" style="color:var(--blue)">${res.v}</span> <span class="r-unit">m/s</span></span></div>
        <div class="r-row"><span class="r-lbl">Reynolds</span><span><span class="r-val" style="color:var(--text-mid);font-size:13px">${res.Re.toLocaleString()}</span></span></div>
      </div>
    </div>`;
  }

  h += `<button class="del-btn" onclick="deleteSelected()">✕ Remove Component</button>`;
  document.getElementById('prop-body').innerHTML = h;
}

function upd(idx, key, val) {
  if (!line[idx]) return;
  line[idx][key] = val;
  runCalc(); renderSVG(); renderProps();
}
function updMat(idx, matId) {
  const m = MATERIALS.find(x=>x.id===matId);
  if (m && line[idx]) { line[idx].material=matId; line[idx].eps=m.eps; }
  const el = document.getElementById('eps-display');
  if (el) el.textContent = m?.eps || '';
  runCalc(); renderSVG();
}

// ═══════════════════════════════════
// MOCK CALC (hydraulics engine)
// ═══════════════════════════════════
function runCalc() {
  let P = 2.0;
  calcRes = line.map(comp => {
    const v  = +(0.40 + Math.random()*0.04).toFixed(3);
    const Re = Math.floor(20000 + Math.random()*3000);
    let dP = 0;
    if (comp.type==='pipe')  dP = 0.0015*(comp.length_m||5)*(( comp.diameter_mm||50) < 40 ? 2 : 1);
    if (comp.type==='elbow') dP = 0.004*(comp.K||0.75);
    if (comp.type==='valve') {
      if (comp.special==='prv') dP = Math.max(0, P-(comp.P_set_bar||1.0));
      else dP = 0.005*(comp.K||1);
    }
    if (comp.type==='pump')  dP = -(comp.head_m||20)*998.2*9.81/1e5;
    if (comp.type==='meter') dP = 0;
    const P_out = +(P - dP).toFixed(4);
    const res = {P_in:+P.toFixed(4), P_out, dP:+dP.toFixed(5), v, Re};
    P = P_out;
    return res;
  });
}

// ─── WARNINGS ───────────────────────────────────────────
function getWarns(comp, res) {
  const w = [];
  if (!res) return w;
  if (res.P_out < 0)   w.push({lvl:'err', msg:'Negative pressure'});
  if (res.P_out < 0.3 && res.P_out >= 0) w.push({lvl:'wrn', msg:'Low outlet pressure'});
  const idx = line.indexOf(comp);
  if (idx > 0) {
    const prev  = line[idx-1];
    const prevD = prev.d_out_mm || prev.diameter_mm;
    const thisD = comp.d_in_mm  || comp.diameter_mm;
    if (prevD && thisD && Math.abs(prevD-thisD) > 2)
      w.push({lvl:'wrn', msg:`Diameter mismatch ${prevD}→${thisD}mm`});
  }
  return w;
}

// ═══════════════════════════════════
// ACTIONS
// ═══════════════════════════════════
function deleteSelected() {
  if (selected===null) return;
  line.splice(selected,1);
  selected=null; runCalc(); renderSVG();
  document.getElementById('prop-body').innerHTML = '<div id="prop-empty"><div style="font-size:24px;opacity:0.2">◈</div><div>SELECT A COMPONENT</div></div>';
  document.getElementById('btn-del').style.display='none';
  updateStatus();
}
function clearLine() {
  line=[]; calcRes=[]; selected=null;
  renderSVG();
  document.getElementById('prop-body').innerHTML='<div id="prop-empty"><div style="font-size:24px;opacity:0.2">◈</div><div>SELECT A COMPONENT</div></div>';
  document.getElementById('btn-del').style.display='none';
  updateStatus();
}
function togglePG() {
  showPG=!showPG;
  document.getElementById('btn-pg').classList.toggle('active',showPG);
  renderSVG();
}
function toggleLabels() {
  showLabels=!showLabels;
  document.getElementById('btn-lbl').classList.toggle('active',showLabels);
  renderSVG();
}
function toggleAnalyze() {
  document.getElementById('btn-analyze').classList.toggle('active');
}
function zoomFit() {
  const s=document.getElementById('canvas-scroll');
  s.scrollLeft=0; s.scrollTop=0;
}
function exportJSON() {
  const blob=new Blob([JSON.stringify({line,calcRes},null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='pipeline.json'; a.click();
}
function updateStatus() {
  const dot=document.getElementById('sdot');
  const txt=document.getElementById('stext');
  if (!line.length) { dot.className='status-dot ok'; txt.textContent='READY'; return; }
  const hasErr = calcRes.some(r=>r.P_out<0);
  const hasWrn = calcRes.some(r=>r.P_out<0.3&&r.P_out>=0);
  if (hasErr)      { dot.className='status-dot err'; txt.textContent='PRESSURE FAULT'; }
  else if (hasWrn) { dot.className='status-dot warn'; txt.textContent='WARNING'; }
  else             { dot.className='status-dot ok';   txt.textContent=`${line.length} COMP`; }
}

// ═══════════════════════════════════
// RESIZE HANDLE
// ═══════════════════════════════════
const handle   = document.getElementById('resize-handle');
const bottomBar = document.getElementById('bottom-bar');
let isResizing = false;
let startY, startH;

handle.addEventListener('mousedown', e => {
  isResizing = true;
  startY = e.clientY;
  startH = bottomBar.offsetHeight;
  handle.classList.add('active');
  document.body.style.cursor = 'ns-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', e => {
  if (!isResizing) return;
  const delta = startY - e.clientY;
  const newH  = Math.min(500, Math.max(80, startH + delta));
  bottomBar.style.height = newH + 'px';
});

document.addEventListener('mouseup', () => {
  if (!isResizing) return;
  isResizing = false;
  handle.classList.remove('active');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

// ═══════════════════════════════════
// INIT
// ═══════════════════════════════════
renderCatalog();
renderSVG();
