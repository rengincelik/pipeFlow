'use strict';

// ═══════════════════════════════════════════════════════════
// MAIN — tüm modülleri birleştirir, UI event'lerini bağlar
// ═══════════════════════════════════════════════════════════

// Core & state
import { SystemConfig }    from './state/system-config.js';
import { pipelineStore }   from './state/pipeline-store.js';

// Renderer
import { SVGRenderer }     from './renderer/svg-renderer.js';
import { ChartRenderer }   from './renderer/chart-renderer.js';

// Components — register edilmeleri için import edilmeli
import './components/pipe.js';
import './components/transition.js';
import './components/elbow.js';
import './components/valve.js';
import './components/pump.js';
import { createComponent } from './components/base.js';

// Catalog
import { CATALOG_DEF, CATALOG_MAP } from './data/catalogs.js';

// ── DOM ─────────────────────────────────────────────────────
const svgCanvas    = document.getElementById('svg-canvas');
const catBody      = document.getElementById('cat-body');
const propBody     = document.getElementById('prop-body');
const emptyHint    = document.getElementById('empty-hint');
const cvInfo       = document.getElementById('cv-info');
const canvasScroll = document.getElementById('canvas-scroll');

// ── RENDERER ─────────────────────────────────────────────────
const renderer = new SVGRenderer(svgCanvas);
renderer.onCompClick = (id) => pipelineStore.select(id);

// ── CHART RENDERER ────────────────────────────────────────────
const chartCanvas = document.getElementById('chart-canvas');
const chartEmpty  = document.getElementById('chart-empty');
const chart       = new ChartRenderer(chartCanvas);
svgCanvas.addEventListener('click', e => {
  if (e.target === svgCanvas || e.target.closest('#layer-spine')) {
    pipelineStore.deselect();
  }
});

// ── STORE SUBSCRIPTIONS ──────────────────────────────────────
let _showLabels = true;

pipelineStore.on('components:change', _redraw);
pipelineStore.on('calc:done', ({ results, P_out_final, status } = {}) => {
  _updateStatusBar(P_out_final, status);
  _drawChart(results);
});
pipelineStore.on('selection:change', () => {
  _redraw();
  _renderProps();
  _drawChart(pipelineStore.lastResults);
});

function _redraw() {
  const layouts = pipelineStore.layout;
  const show    = pipelineStore.length > 0;

  emptyHint?.classList.toggle('hidden', show);

  renderer.render(layouts, {
    selectedId: pipelineStore.selectedId,
    showLabels: _showLabels,
  });

  if (show) {
    const last = pipelineStore.calcResults.at(-1);
    cvInfo.textContent = last
      ? `${pipelineStore.length} components  ·  P_out = ${last.P_out} bar`
      : `${pipelineStore.length} components`;
  } else {
    cvInfo.textContent = 'Drag components from catalog to start';
  }
}

function _updateStatusBar(P_out, status) {
  const el = document.getElementById('status-bar');
  if (!el) return;
  el.dataset.status = status?.code ?? 'ok';
  el.textContent    = status ? `${status.label}  ·  P_out = ${(P_out ?? 0).toFixed(3)} bar` : '';
}

function _drawChart(results) {
  if (!results || results.length === 0) {
    chartEmpty.classList.remove('hidden');
    chart.clear();
    return;
  }
  chartEmpty.classList.add('hidden');

  // Seçili elemanın index'ini bul
  const selId  = pipelineStore.selectedId;
  const comps  = pipelineStore.components;
  const selIdx = selId ? comps.findIndex(c => c.id === selId) : null;

  chart.draw({
    results,
    components: comps,
    selectedIdx: selIdx >= 0 ? selIdx : null,
  });
}

// ── CATALOG RENDER ──────────────────────────────────────────
function renderCatalog() {
  catBody.innerHTML = CATALOG_DEF.map((grp, gi) => {
    const single = grp.items.length === 1;
    const item   = grp.items[0];

    // Chip görünümü (elbow)
    if (grp.display === 'chips') {
      return `
        <div class="cat-chip-group">
          <div class="cat-chip-label">${grp.group}</div>
          <div class="cat-chips">
            ${grp.items.map((it, ii) => `
              <div class="cat-chip" draggable="true"
                   data-gi="${gi}" data-ii="${ii}"
                   ondragstart="onCatDrag(event,this)"
                   title="${it.desc ?? it.name}">
                ${it.name}
              </div>
            `).join('')}
          </div>
        </div>`;
    }

    // Tek eleman — direkt sürüklenebilir kart
    if (single) {
      return `
        <div class="cat-direct" draggable="true"
             data-gi="${gi}" data-ii="0"
             ondragstart="onCatDrag(event,this)">
          <div class="cat-icon">${_catIcon(item)}</div>
          <div style="flex:1">
            <div class="cat-name">${grp.group}</div>
            <div class="cat-desc">${item.desc ?? ''}</div>
          </div>
        </div>`;
    }

  }).join('');
}

function _catIcon(item) {
  // Basit metin ikonu, tam SVG thumbnail isteğe bağlı
  const icons = { pipe:'▬', elbow:'↵', valve:'⊘', pump:'◉' };
  return `<span style="font-size:16px">${icons[item.type] ?? '?'}</span>`;
}

window.toggleGroup = (gi) => {
  document.getElementById(`sw_${gi}`)?.classList.toggle('open');
  document.getElementById(`ei_${gi}`)?.classList.toggle('open');
};

// ── DRAG & DROP ─────────────────────────────────────────────
let _dragTemplate = null;
let _dropIdx      = null;

window.onCatDrag = (evt, el) => {
  const gi   = parseInt(el.dataset.gi);
  const ii   = parseInt(el.dataset.ii);
  _dragTemplate = CATALOG_DEF[gi].items[ii];
  evt.dataTransfer.effectAllowed = 'copy';
  evt.dataTransfer.setData('text/plain', JSON.stringify(_dragTemplate));
};

function _calcDropIdx(svgX, svgY) {
  const layouts = pipelineStore.layout;
  if (!layouts.length) return 0;

  let bestIdx  = layouts.length;
  let bestDist = Infinity;

  const points = [
    ...layouts.map((l, i) => ({ idx: i, x: l.ix, y: l.iy })),
    { idx: layouts.length, x: layouts.at(-1).ox, y: layouts.at(-1).oy },
  ];

  for (const { idx, x, y } of points) {
    const d = Math.hypot(svgX - x, svgY - y);
    if (d < bestDist) { bestDist = d; bestIdx = idx; }
  }

  return bestIdx;
}

function _makeComp(template) {
  const comp = createComponent(template.type, template.subtype);
  comp.name  = template.name ?? comp.name;

  // Varsayılan override'ları uygula
  if (template.defaultOverrides) {
    Object.entries(template.defaultOverrides).forEach(([k, v]) => comp.override(k, v));
  }

  // Çap mirası: hat sonundaki komponentten al
  const last = pipelineStore.components.at(-1);
  if (last && comp.type !== 'pipe' && !comp.hasOverride('diameter_mm')) {
    comp.override('diameter_mm', last.outDiameter_mm);
  }

  return comp;
}

// ── PROPS PANEL ─────────────────────────────────────────────
function _renderProps() {
  const comp = pipelineStore.selectedComp;
  if (!comp) {
    propBody.innerHTML = `<div id="prop-empty">
      <div style="font-size:24px;opacity:0.2">◈</div>
      <div>SELECT A COMPONENT</div>
    </div>`;
    document.getElementById('btn-del-side')?.style.setProperty('display', 'none');
    return;
  }

  document.getElementById('btn-del-side')?.style.setProperty('display', 'block');

  const res = comp.result;
  const warnings = _getWarnings(comp);

  propBody.innerHTML = `
    <div class="ps">
      <div class="ps-title">Component</div>
      <div class="pr"><span class="pl">Type</span><span class="pv">${comp.name}</span></div>
      ${comp.subtype ? `<div class="pr"><span class="pl">Subtype</span><span class="pv">${comp.subtype}</span></div>` : ''}
    </div>

    <div class="ps">
      ${warnings.length === 0
        ? '<div class="badge ok">✓ No issues</div>'
        : warnings.map(w => `<div class="badge ${w.lvl}">⚠ ${w.msg}</div>`).join('')}
    </div>

    <div class="ps">
      <div class="ps-title">Parameters</div>
      ${comp.renderPropsHTML()}
    </div>

    ${res ? `
    <div class="ps">
      <div class="ps-title">Live Readings</div>
      ${res.blocked ? '<div class="badge err">⛔ Flow blocked</div>' : ''}
      <div class="reading-card">
        <div class="r-row"><span class="r-lbl">P inlet</span>
          <span><span class="r-val">${res.P_in?.toFixed(4)}</span> <span class="r-unit">bar</span></span></div>
        <div class="r-row"><span class="r-lbl">P outlet</span>
          <span><span class="r-val" style="${(res.P_out??1)<0.3?'color:var(--red)':''}">${res.P_out?.toFixed(4)}</span> <span class="r-unit">bar</span></span></div>
        <div class="r-row"><span class="r-lbl">ΔP</span>
          <span><span class="r-val" style="color:var(--accent)">${res.dP_bar?.toFixed(5)}</span> <span class="r-unit">bar</span></span></div>
        <div class="r-row"><span class="r-lbl">Velocity</span>
          <span><span class="r-val" style="color:var(--blue)">${res.v?.toFixed(3)}</span> <span class="r-unit">m/s</span></span></div>
        <div class="r-row"><span class="r-lbl">Reynolds</span>
          <span><span class="r-val dim">${res.Re?.toLocaleString()}</span></span></div>
      </div>
    </div>` : ''}

    <button class="del-btn" onclick="window.deleteSelected()">✕ Remove Component</button>
  `;

  // Prop değişim listener'ları
  propBody.querySelectorAll('[data-prop]').forEach(el => {
    el.addEventListener('change', () => {
      const key = el.dataset.prop;
      const val = el.type === 'number' ? +el.value : el.value;
      comp.override(key, val);
    });
  });

  // Valf toggle
  propBody.querySelector('[data-action="toggle-valve"]')?.addEventListener('click', () => {
    comp.open = !comp.open;
    pipelineStore.recalc();
    _redraw();
    _renderProps();
  });

  // Valf tip değişimi
  propBody.querySelector('[data-action="change-valve-type"]')?.addEventListener('change', (e) => {
    const VALVE_DEFS = {
      gate:      { name: 'Gate Valve',  K: 0.20 },
      ball:      { name: 'Ball Valve',  K: 0.10 },
      butterfly: { name: 'Butterfly',   K: 0.80 },
      globe:     { name: 'Globe Valve', K: 6.00 },
      check:     { name: 'Check Valve', K: 2.50 },
    };
    const newSubtype = e.target.value;
    if (newSubtype === comp.subtype) return;

    const idx = pipelineStore.components.indexOf(comp);
    if (idx === -1) return;

    if (newSubtype === 'prv') {
      // PRV ayrı sınıf — yeni component yarat, çapı aktar
      const prv = createComponent('valve', 'prv');
      prv.override('diameter_mm', comp.diameter_mm);
      prv.open = comp.open;
      pipelineStore.components.splice(idx, 1, prv);
      pipelineStore.selectedId = prv.id;
    } else {
      // Aynı sınıf — sadece subtype/name/K güncelle
      const def = VALVE_DEFS[newSubtype];
      if (!def) return;
      comp.subtype = newSubtype;
      comp.name    = def.name;
      comp.K       = def.K;
    }

    pipelineStore.recalc();
    _redraw();
    _renderProps();
  });
}

function _getWarnings(comp) {
  const w = [];
  const res = comp.result;
  if (!res) return w;
  if (res.P_out < 0)            w.push({ lvl:'err', msg:'Negative pressure' });
  if (res.P_out < 0.3 && res.P_out >= 0) w.push({ lvl:'wrn', msg:'Low outlet pressure' });
  const comps = pipelineStore.components;
  const idx   = comps.indexOf(comp);
  if (idx > 0) {
    const prev  = comps[idx - 1];
    const prevD = prev.outDiameter_mm;
    const thisD = comp.diameter_mm;
    if (prevD && thisD && Math.abs(prevD - thisD) > 2)
      w.push({ lvl:'wrn', msg:`Diameter mismatch ${prevD}→${thisD}mm` });
  }
  return w;
}

// ── TOOLBAR ACTIONS ─────────────────────────────────────────
window.deleteSelected = () => {
  const id = pipelineStore.selectedId;
  if (id == null) return;
  pipelineStore.remove(id);
  _renderProps();
};

window.clearLine = () => {
  pipelineStore.clear();
  _renderProps();
};

window.toggleLabels = () => {
  _showLabels = !_showLabels;
  document.getElementById('btn-lbl')?.classList.toggle('active', _showLabels);
  _redraw();
};

window.setSysConfig = (key, val) => {
  SystemConfig.set(key, val);
  // recalc store listener'ı tetikler
};

window.exportJSON = () => {
  const blob = new Blob(
    [JSON.stringify(pipelineStore.serialize(), null, 2)],
    { type: 'application/json' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pipeline.json';
  a.click();
};

// Mouse client koordinatını SVG koordinat sistemine çevirir
function _clientToSVG(clientX, clientY) {
  const svg = renderer.svg;
  const pt  = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

// ── DRAG HANDLERS (HTML attribute'lardan çağrılır) ───────────
window.onDragOver = (evt) => {
  evt.preventDefault();
  evt.dataTransfer.dropEffect = 'copy';
  canvasScroll.classList.add('drag-over');

  if (_dragTemplate) {
    const svgPt = _clientToSVG(evt.clientX, evt.clientY);
    _dropIdx = _calcDropIdx(svgPt.x, svgPt.y);
    renderer.render(pipelineStore.layout, {
      selectedId: pipelineStore.selectedId,
      showLabels: _showLabels,
      dropIdx:    _dropIdx,
    });
  }
};

window.onDragLeave = () => {
  canvasScroll.classList.remove('drag-over');
  _dropIdx = null;
  _redraw();
};

window.onDrop = (evt) => {
  evt.preventDefault();
  canvasScroll.classList.remove('drag-over');

  const raw = evt.dataTransfer.getData('text/plain');
  if (!raw) return;

  const template = JSON.parse(raw);
  const comp = _makeComp(template);
  const idx  = _dropIdx ?? pipelineStore.length;

  pipelineStore.insert(comp, idx);
  pipelineStore.select(comp.id);
  _dropIdx = null; _dragTemplate = null;
};

window.zoomFit = () => {
  // SVG'yi scroll container'ın merkezine kaydır
  const sw = canvasScroll.scrollWidth;
  const sh = canvasScroll.scrollHeight;
  const cw = canvasScroll.clientWidth;
  const ch = canvasScroll.clientHeight;
  canvasScroll.scrollTo((sw - cw) / 2, (sh - ch) / 2);
};

let _pgOn = false;
window.togglePG = () => {
  _pgOn = !_pgOn;
  document.getElementById('btn-pg')?.classList.toggle('active', _pgOn);
  svgCanvas.classList.toggle('pg-on', _pgOn);
};

// ── RESIZE HANDLERS ──────────────────────────────────────────
(function initResize() {
  const colLeft      = document.getElementById('col-left');
  const panelCatalog = document.getElementById('panel-catalog');
  const panelProps   = document.getElementById('panel-props');
  const panelChart   = document.getElementById('panel-chart');
  const layout       = document.getElementById('layout');

  document.querySelectorAll('.resize-handler').forEach(handle => {
    const kind = handle.dataset.resize;  // 'col' | 'left' | 'right'

    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      handle.classList.add('active');
      document.body.style.userSelect = 'none';

      const startX = e.clientX;
      const startY = e.clientY;

      // Başlangıç boyutları
      const startColW      = colLeft.getBoundingClientRect().width;
      const startCatH      = panelCatalog.getBoundingClientRect().height;
      const startChartH    = panelChart.getBoundingClientRect().height;
      const leftColH       = colLeft.getBoundingClientRect().height;

      function onMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (kind === 'col') {
          // Sol kolonun genişliği
          const newW = Math.min(380, Math.max(160, startColW + dx));
          colLeft.style.width = newW + 'px';

        } else if (kind === 'left') {
          // Catalog / Props dikey bölünmesi
          const newCatH = Math.max(60, startCatH + dy);
          const newPropsH = Math.max(60, leftColH - newCatH - 3); // 3 = handle height
          if (newPropsH >= 60) {
            panelCatalog.style.flex = 'none';
            panelCatalog.style.height = newCatH + 'px';
            panelProps.style.flex = '1';
          }

        } else if (kind === 'right') {
          // Chart panel yüksekliği (yukarı sürükleme → büyür)
          const newChartH = Math.min(500, Math.max(80, startChartH - dy));
          panelChart.style.height = newChartH + 'px';
        }
      }

      function onUp() {
        handle.classList.remove('active');
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
})();

// ── THEME ─────────────────────────────────────────────────────
window.toggleTheme = () => {
  // Geçiş sırasında transition'ları kapat — flash önleme
  document.documentElement.classList.add('no-transition');

  const isLight = document.documentElement.dataset.theme === 'light';
  if (isLight) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('pf-theme', 'dark');
    document.getElementById('theme-btn').title = 'Switch to Light';
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('pf-theme', 'light');
    document.getElementById('theme-btn').title = 'Switch to Dark';
  }

  // Bir sonraki frame'de transition'ları geri aç
  requestAnimationFrame(() => {
    document.documentElement.classList.remove('no-transition');
  });
};

// Kayıtlı temayı uygula
(function initTheme() {
  const saved = localStorage.getItem('pf-theme');
  if (saved === 'light') {
    document.documentElement.dataset.theme = 'light';
    document.getElementById('theme-btn').title = 'Switch to Dark';
  }
})();

// ── TOPBAR YÜKSEKLİĞİ ────────────────────────────────────────
// ResizeObserver kullanıyoruz ama loop'u engellemek için
// --topbar-h'yi CSS'den kaldırıp layout'u JS ile set ediyoruz.
const _topbarEl = document.getElementById('topbar');
const _layoutEl = document.getElementById('layout');
let   _lastTopbarH = 0;

function _applyTopbarHeight(h) {
  if (h === _lastTopbarH || h === 0) return;
  _lastTopbarH = h;
  // CSS variable yerine direkt style — layout observer'ı tetiklemez
  _layoutEl.style.top = h + 'px';
}

new ResizeObserver(entries => {
  // borderBoxSize daha güvenilir
  const h = entries[0].borderBoxSize?.[0]?.blockSize
         ?? entries[0].contentRect.height
         ?? _topbarEl.offsetHeight;
  _applyTopbarHeight(Math.round(h));
}).observe(_topbarEl);

_applyTopbarHeight(_topbarEl.offsetHeight);

// ── INIT ─────────────────────────────────────────────────────
renderCatalog();
_redraw();
