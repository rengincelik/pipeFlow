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
  panelChart:   document.getElementById('panel-chart'),
    // Butonlar
  themeBtn:     document.getElementById('theme-btn'),
  selectFluid:  document.getElementById('select-fluid'),
  btnLabel:     document.getElementById('btn-label'),
  btnPressure:  document.getElementById('btn-pressure'),
  btnFit:       document.getElementById('btn-fit'),
  btnClear:     document.getElementById('btn-clear'),
  btnExport:    document.getElementById('btn-export'),
  hudStartBtn:  document.getElementById('hud-start-btn'),

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
  },


  onDragOver(evt) {
    evt.preventDefault();
    const svgPt = this.clientToSVG(evt.clientX, evt.clientY);
    this.dropIdx = this.calcDropIdx(svgPt.x, svgPt.y);
    renderer.render(pipelineStore.layout, { selectedId: pipelineStore.selectedId, dropIdx: this.dropIdx });
  },

  onDrop(evt) {
    evt.preventDefault();
    const template = JSON.parse(evt.dataTransfer.getData('text/plain'));
    const comp = CatalogManager.makeComp(template);
    pipelineStore.insert(comp, this.dropIdx);
    pipelineStore.deselect();
  },

  onDragLeave(evt) {
    // TODO: implement (drop highlight temizleme)
  }
};

// 3. CATALOG & COMPONENT MANAGER
const CatalogManager = {
  render() {
    DOM.catBody.innerHTML = CATALOG_DEF
      .map((grp, gi) => {
        // Önce bu gruptaki pump olmayan elemanları ayıklayalım
        const validItems = grp.items.filter(it => it.type !== 'pump');

        // Eğer grubun içinde hiç eleman kalmadıysa boş string dön (böylece başlık da çizilmez)
        if (validItems.length === 0) return '';

        return `
          <div class="cat-chip-group">
            <div class="cat-chip-label">${grp.group}</div>
            <div class="cat-chips">
              ${validItems.map((it, ii) => `
                <div class="cat-chip" draggable="true" data-gi="${gi}" data-ii="${ii}"  >
                  ${it.icon}
                </div>`).join('')}
            </div>
          </div>`;
      }).join('');
          // Drag eventlerini üretilen elementlere bağla
    DOM.catBody.querySelectorAll('.cat-chip').forEach(el => {
      el.addEventListener('dragstart', (e) => {
        const gi = parseInt(el.dataset.gi);
        const ii = parseInt(el.dataset.ii);
        Interactions.dragTemplate = CATALOG_DEF[gi].items[ii];
        e.dataTransfer.setData('text/plain', JSON.stringify(Interactions.dragTemplate));
      });
    });

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


// ── 4. TOOLBAR ACTIONS ───────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const isLight = html.dataset.theme === 'light';
  html.dataset.theme = isLight ? '' : 'light';
  localStorage.setItem('pf-theme', isLight ? '' : 'light');
}

function zoomFit() {
  const bbox = DOM.svgCanvas.getBBox();
  if (!bbox.width || !bbox.height) return;
  const pad = 40;
  DOM.svgCanvas.setAttribute('viewBox',
    `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`
  );
}

function clearLine() {
  pipelineStore.clear?.();
  setupInitialState();
  _redraw();
}

// ── STUBS (TODO: implement or remove) ────────────────────────
function setSysConfig(key, value) { /* TODO */ }
function toggleLabels()           { /* TODO */ }
function togglePump()             { /* TODO */ }

// 4. UI STATE & REDRAW

function _redraw() {

  renderer.render(pipelineStore.layout, {
    selectedId: pipelineStore.selectedId
  });
}

function _renderProps() {
  const comp = pipelineStore.selectedComp;
  if (!comp) {
    DOM.propBody.innerHTML = '<div id="prop-empty">SELECT A COMPONENT</div>';
    return;
  }
  const isPump = comp.type === 'pump';
  DOM.propBody.innerHTML = `
    <div class="prop-section"><div class="section-title">Component: ${comp.name}</div></div>
    <div class="prop-section"><div class="section-title">Parameters</div>${comp.renderPropsHTML()}</div>
    ${isPump ? '' : '<button class="btn-delete" id="del-btn" >✕ Remove</button>'}`;

  if(!isPump) {
    DOM.propBody.querySelector('#del-btn').addEventListener('click', () => {
    pipelineStore.remove(pipelineStore.selectedId);
    _renderProps();
  });}
}


// ── 6. EVENT BINDINGS ────────────────────────────────────────
function bindEvents() {
  // Topbar
  DOM.themeBtn.addEventListener('click', toggleTheme);
  DOM.selectFluid.addEventListener('change', (e) => setSysConfig('fluid_id', e.target.value));

  // Canvas bar
  DOM.btnLabel.addEventListener('click', toggleLabels);
  DOM.btnFit.addEventListener('click', zoomFit);
  DOM.btnClear.addEventListener('click', clearLine);

  // HUD
  DOM.hudStartBtn.addEventListener('click', togglePump);

  // Canvas drag & drop
  DOM.canvasScroll.addEventListener('dragover',   (e) => Interactions.onDragOver(e));
  DOM.canvasScroll.addEventListener('drop',       (e) => Interactions.onDrop(e));
  DOM.canvasScroll.addEventListener('dragleave',  (e) => Interactions.onDragLeave(e));
}

// ── APP START ────────────────────────────────────────────────
pipelineStore.on('components:change', _redraw);
pipelineStore.on('selection:change', () => {
  _redraw();
  _renderProps();
});

renderer.onCompClick = (id) => pipelineStore.select(id);

//muhtemelen buraya ilk eleman olarak pompayı ekleyecek birşey yaz




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

  }
}


LayoutManager.init();
CatalogManager.render();

bindEvents();
setupInitialState();


