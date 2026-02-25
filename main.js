'use strict';

// ── IMPORTS ──────────────────────────────────────────────────
import { SystemConfig }    from './state/system-config.js';
import { pipelineStore }   from './state/pipeline-store.js';
import { SVGRenderer }     from './renderer/svg-renderer.js';
import { ChartRenderer }   from './renderer/chart-renderer.js';
import { createComponent } from './components/base.js';
import { CATALOG_DEF}     from './data/catalogs.js';

// Bileşenleri register et (Yan etkili importlar)
import './components/pipe.js';
import './components/transition.js';
import './components/elbow.js';
import './components/valve.js';
import './components/pump.js';

// ── DOM ELEMENTS ─────────────────────────────────────────────
const DOM = {
  canvasScroll: document.getElementById('canvas-scroll'),
  svgCanvas:    document.getElementById('svg-canvas'),
  catBody:      document.getElementById('cat-body'),
  propBody:     document.getElementById('prop-body'),
  emptyHint:    document.getElementById('empty-hint'),
  chartCanvas:  document.getElementById('chart-canvas'),
  chartEmpty:   document.getElementById('chart-empty'),
  colLeft:      document.getElementById('col-left'),
  panelCatalog: document.getElementById('panel-catalog'),
  panelProps:   document.getElementById('panel-props'),
  panelChart:   document.getElementById('panel-chart')
};

// ── INITIALIZE RENDERERS ─────────────────────────────────────
const renderer = new SVGRenderer(DOM.svgCanvas);
const chart    = new ChartRenderer(DOM.chartCanvas);

// 1. LAYOUT & RESIZE MANAGER (Sayfa Boyutlandırma)
const LayoutManager = {
  init() {
    this.bindResizers();
    this.initTheme();
  },

  bindResizers() {
    document.querySelectorAll('.resize-handler').forEach(handle => {
      handle.addEventListener('mousedown', e => this.startResize(e, handle));
    });
  },

  startResize(e, handle) {
    e.preventDefault();
    const kind = handle.dataset.resize;
    const startX = e.clientX, startY = e.clientY;
    const startColW = DOM.colLeft.offsetWidth;
    const startChartH = DOM.panelChart.offsetHeight;
    const startPropH = DOM.panelProps.offsetHeight;

    const onMove = (me) => {
      if (kind === 'vertical') {
        DOM.colLeft.style.width = Math.min(380, Math.max(160, startColW + (me.clientX - startX))) + 'px';
      } else if (kind === 'left') {
        DOM.panelProps.style.height = Math.min(500, Math.max(80, startPropH - (me.clientY - startY))) + 'px';
      } else if (kind === 'right') {
        DOM.panelChart.style.height = Math.min(500, Math.max(80, startChartH - (me.clientY - startY))) + 'px';
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  },

  initTheme() {
    const saved = localStorage.getItem('pf-theme');
    if (saved === 'light') document.documentElement.dataset.theme = 'light';
  }
};

// 2. INTERACTION MANAGER (Drag & Drop, Mouse)
const Interactions = {
  dragTemplate: null,
  dropIdx: null,

  clientToSVG(clientX, clientY) {
    const pt = DOM.svgCanvas.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(DOM.svgCanvas.getScreenCTM().inverse());
  },

  calcDropIdx(x, y) {
  const layouts = pipelineStore.layout;
  if (!layouts.length) return 0;
  const points = [...layouts.map((l, i) => ({ idx: i, x: l.ix, y: l.iy })),
                  { idx: layouts.length, x: layouts.at(-1).ox, y: layouts.at(-1).oy }];
  const closest = points.reduce((prev, curr) =>
    Math.hypot(x - curr.x, y - curr.y) < Math.hypot(x - prev.x, y - prev.y) ? curr : prev
  );

  // BUG FIX: Eğer 0 (pompa öncesi) seçilirse, 1'e (pompa sonrası) zorla
  return Math.max(1, closest.idx);
}


};

// 3. CATALOG & COMPONENT MANAGER
const CatalogManager = {
  render() {
    DOM.catBody.innerHTML = CATALOG_DEF.map((grp, gi) => `
      <div class="cat-chip-group">
        <div class="cat-chip-label">${grp.group}</div>
        <div class="cat-chips">
          ${grp.items.map((it, ii) => `
            <div class="cat-chip" draggable="true" data-gi="${gi}" data-ii="${ii}" ondragstart="onCatDrag(event,this)">
              ${it.icon}
            </div>`).join('')}
        </div>
      </div>`).join('');
  },

  makeComp(template) {
    const comp = createComponent(template.type, template.subtype);
    comp.name = template.name ?? comp.name;
    if (template.defaultOverrides) Object.entries(template.defaultOverrides).forEach(([k, v]) => comp.override(k, v));
    const last = pipelineStore.components.at(-1);
    if (last && comp.type !== 'pipe' && !comp.hasOverride('diameter_mm')) comp.override('diameter_mm', last.outDiameter_mm);
    return comp;
  }

};


// 4. UI STATE & REDRAW

function _redraw() {
  renderer.render(pipelineStore.layout, {
    selectedId: pipelineStore.selectedId,
  });
}

function _renderProps() {
  const comp = pipelineStore.selectedComp;
  if (!comp) {
    DOM.propBody.innerHTML = '<div id="prop-empty">SELECT A COMPONENT</div>';
    return;
  }
  DOM.propBody.innerHTML = `
    <div class="ps"><div class="ps-title">Component: ${comp.name}</div></div>
    <div class="ps"><div class="ps-title">Parameters</div>${comp.renderPropsHTML()}</div>
    <button class="del-btn" onclick="window.deleteSelected()">✕ Remove</button>`;
}

// ── GLOBAL WINDOW BINDINGS (HTML Access) ─────────────────────
window.onCatDrag = (evt, el) => {
  const gi = parseInt(el.dataset.gi), ii = parseInt(el.dataset.ii);
  Interactions.dragTemplate = CATALOG_DEF[gi].items[ii];
  evt.dataTransfer.setData('text/plain', JSON.stringify(Interactions.dragTemplate));
};

window.onDragOver = (evt) => {
  evt.preventDefault();
  const svgPt = Interactions.clientToSVG(evt.clientX, evt.clientY);
  Interactions.dropIdx = Interactions.calcDropIdx(svgPt.x, svgPt.y);
  renderer.render(pipelineStore.layout, { selectedId: pipelineStore.selectedId, dropIdx: Interactions.dropIdx });
};

window.onDrop = (evt) => {
  evt.preventDefault();
  const template = JSON.parse(evt.dataTransfer.getData('text/plain'));
  const comp = CatalogManager.makeComp(template);
  pipelineStore.insert(comp, Interactions.dropIdx);
  pipelineStore.select(comp.id);
};

window.deleteSelected = () => {
  pipelineStore.remove(pipelineStore.selectedId);
  _renderProps();
};

// ── APP START ────────────────────────────────────────────────
pipelineStore.on('components:change', _redraw);
pipelineStore.on('selection:change', () => {
  _redraw();
  _renderProps();
});

renderer.onCompClick = (id) => pipelineStore.select(id);

//muhtemelen buraya ilk eleman olarak pompayı ekleyecek birşey yaz

LayoutManager.init();
CatalogManager.render();


// 🚀 VARSAYILAN POMPAYI EKLEME
function setupInitialState() {
  // Eğer sahne zaten boş değilse (mesela bir yerden yüklenmişse) ekleme yapma
  if (pipelineStore.components.length === 0) {

    // 1. Pompa şablonu oluştur (Katalogdaki yapıya uygun)
    const pumpTemplate = {
      type: 'pump',
      subtype: 'centrifugal', // Sürüklerken kullandığın subtype ile aynı olmalı
      name: 'Main Supply Pump'
    };

    // 2. Senin CatalogManager'daki makeComp fonksiyonunu kullanıyoruz
    // Bu sayede pompa tüm varsayılan değerleriyle (head_m, efficiency vb.) oluşur.
    const initialPump = CatalogManager.makeComp(pumpTemplate);

    // 3. Store'a ilk eleman (index 0) olarak ekle
    pipelineStore.insert(initialPump, 0);

    // 4. İsteğe bağlı: Pompayı başlangıçta seçili yap
    pipelineStore.select(initialPump.id);
  }
}

// Fonksiyonu çalıştır
setupInitialState();

// Son olarak ilk çizimi yap
_redraw();
