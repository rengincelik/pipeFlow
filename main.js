'use strict';

// --- IMPORTS ---
import { SystemConfig }               from './state/system-config.js';
import { pipelineStore }              from './state/pipeline-store.js';
import { SVGRenderer }                from './renderer/svg-renderer.js';
import { ChartRenderer }              from './renderer/chart-renderer.js';
import { FlowAnimator }               from './renderer/flow-animator.js';
import { TooltipManager }             from './renderer/tooltip-manager.js';
import { createComponent }            from './components/base.js';
import { CATALOG_DEF }                from './data/catalogs.js';
import { fluidRegistry }              from './data/fluid-model.js';
import { SimulationEngine, SysState } from './Simulation/SimulationEngine.js';
import { Units } from './data/unit-system.js';

import './components/pipe.js';
import './components/transition.js';
import './components/elbow.js';
import './components/valve.js';
import './components/pump.js';

// --- 1. GLOBAL STATE & INSTANCES ---
const DOM = {
  canvasScroll: document.getElementById('canvas-scroll'),
  colLeft:      document.getElementById('col-left'),
  panelCatalog: document.getElementById('panel-catalog'),
  panelProps:   document.getElementById('panel-props'),
  panelChart:   document.getElementById('panel-chart'),
  svgCanvas:    document.getElementById('svg-canvas'),
  flowCanvas:   document.getElementById('flow-canvas'),
  chartCanvas:  document.getElementById('chart-canvas'),
  catBody:      document.getElementById('cat-body'),
  propBody:     document.getElementById('prop-body'),
  themeBtn:     document.getElementById('theme-btn'),
  btnUnits: document.getElementById('btn-units'),
  btnLabel:     document.getElementById('btn-label'),
  btnFit:       document.getElementById('btn-fit'),
  btnClear:     document.getElementById('btn-clear'),
  selectFluid:  document.getElementById('select-fluid'),
  tempSlider:   document.getElementById('temp-slider'),
  tempLabel:    document.getElementById('temp-label'),
  hudStartBtn:  document.getElementById('hud-start-btn'),
  hudIcon:      document.getElementById('hud-btn-icon'),
  hudLabel:     document.getElementById('hud-btn-label'),
  hudTime:      document.getElementById('hud-time'),
  hudVol:       document.getElementById('hud-vol'),
};

const renderer = new SVGRenderer(DOM.svgCanvas);
const chart    = new ChartRenderer(DOM.chartCanvas);
const engine   = new SimulationEngine(pipelineStore, { rho: 1000, mu: 0.001 });
const animator = new FlowAnimator(DOM.svgCanvas, DOM.flowCanvas);
const tooltip  = new TooltipManager(DOM.svgCanvas, engine, pipelineStore);

let _fluidId, _tempC;

// --- 2. CORE ACTIONS (İş Mantığı) ---
const Actions = {
  updateFluid() {
    const model = fluidRegistry.get(_fluidId);
    if (!model) return;
    const props = model.getProps(_tempC);

    engine.setFluid({
      rho: props.rho,
      mu:  props.mu_mPas / 1000,
    });

    SystemConfig.set('T_in_C',   _tempC);
    SystemConfig.set('fluid_id', _fluidId);
  },

  toggleSimulation() {
    if (engine.sysState === SysState.IDLE) {
      const warnings = pipelineStore.getWarnings();
      if (warnings.length > 0) {
        UI.showBlockToast(`Cannot start: ${warnings[0].message}`);
        return;
      }
      engine.start();
      animator.start();
      UI.updateControlPanel(true);
    } else {
      engine.stop();
      animator.stop();
      UI.updateControlPanel(false);
    }
  },

  handleComponentResize(e, handle) {
    const kind = handle.dataset.resize;
    const startX = e.clientX, startY = e.clientY;
    const startColW = DOM.colLeft.offsetWidth;
    const startChartH = DOM.panelChart.offsetHeight;
    const startPropH = DOM.panelProps.offsetHeight;

    const onMove = (me) => {
      if (kind === 'vertical') DOM.colLeft.style.width = Math.min(380, Math.max(160, startColW + (me.clientX - startX))) + 'px';
      else if (kind === 'left') DOM.panelProps.style.height = Math.min(500, Math.max(80, startPropH - (me.clientY - startY))) + 'px';
      else if (kind === 'right') DOM.panelChart.style.height = Math.min(500, Math.max(80, startChartH - (me.clientY - startY))) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  },

  deleteComponent() {
    pipelineStore.remove(pipelineStore.selectedId);
    UI.renderProps();
  },

  zoomToFit() {
    const bbox = DOM.svgCanvas.getBBox();
    if (!bbox.width || !bbox.height) return;
    const pad = 40;
    DOM.svgCanvas.setAttribute('viewBox', `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
  }
};

// --- 3. UI RENDERERS (Arayüz Güncellemeleri) ---
const UI = {
  refreshCanvas() {
    renderer.render(pipelineStore.layout, {
      selectedId: pipelineStore.selectedId,
      warnings:   pipelineStore.getWarnings(),
    });
  },

  renderProps() {
    const comp = pipelineStore.selectedComp;
    if (!comp) {
      DOM.propBody.innerHTML = '<div id="prop-empty">SELECT A COMPONENT</div>';
      return;
    }
    const isPump = comp.type === 'pump';
    DOM.propBody.innerHTML = `
      <div class="prop-section"><div class="section-title">Component: ${comp.name}</div></div>
      <div class="prop-section"><div class="section-title">Parameters</div>${comp.renderPropsHTML()}</div>
      ${isPump ? '' : '<button class="btn-delete" id="del-btn">✕ Remove</button>'}`;

    if (!isPump) DOM.propBody.querySelector('#del-btn').onclick = Actions.deleteComponent;
    this.bindPropInputs(comp);
  },

  bindPropInputs(comp) {
    DOM.propBody.querySelectorAll('[data-prop]').forEach(el => {
      const eventName = (el.tagName === 'SELECT') ? 'onchange' : 'oninput';

      el[eventName] = () => {
        const prop = el.dataset.prop;
        const raw = el.value;

        // --- 1. SLIDER GÖRSEL GÜNCELLEME (Ortak Kısım) ---
        // Eğer eleman bir slider ise yanındaki % yazısını her zaman güncelle
        if (el.type === 'range') {
          const label = el.nextElementSibling;
          if (label) label.textContent = raw + '%';
        }

        // --- 2. ÖZEL MANTIKLAR ---
        if (prop === 'transition_pair') {
          const [d_in, d_out] = raw.split('|').map(Number);
          comp.override('d_in_mm', d_in, true);
          comp.override('d_out_mm', d_out, true);
          pipelineStore._propagateDiameter(pipelineStore.components.indexOf(comp));
          this.renderProps();

        } else if (prop === 'opening_pct') {
          const val = parseInt(raw);
          // Vana özel: Status tag ve Engine güncelleme
          const statusTag = DOM.propBody.querySelector('.valve-status-tag'); // Senin yeni class ismin
          if (statusTag) {
            statusTag.textContent = val > 0 ? 'OPEN' : 'CLOSED';
            statusTag.className = `valve-status-tag ${val > 0 ? 'on' : 'off'}`;
          }
          comp.opening_pct = val;
          comp.open = val > 0;
          engine.setComponentProp(comp.id, 'opening', val / 100);

        } else if (prop === 'efficiency_pct') {
          const val = parseInt(raw);
          // Pompa özel: efficiency değerini 0-1 arasına çevirip kaydet
          comp.efficiency_pct = val;
          engine.setComponentProp(comp.id, 'efficiency', val / 100);

        } else {
          // Genel inputlar (Diameter, Length, P_set vb.)
          const num = parseFloat(raw);
          comp.override(prop, isNaN(num) ? raw : num, true);
          if (['diameter_mm', 'd_out_mm'].includes(prop)){
            pipelineStore._propagateDiameter(pipelineStore.components.indexOf(comp));
          }
        }

        pipelineStore.emit('components:change');
      };
    });
  },


  updateHUD(snapshot) {
    const t = snapshot.t;
    DOM.hudTime.textContent = `${String(Math.floor(t/3600)).padStart(2,'0')}:${String(Math.floor((t%3600)/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
    const vol = snapshot.totalVolume_m3 * 1000;
    DOM.hudVol.textContent = vol < 1000 ? `${vol.toFixed(1)} L` : `${(vol / 1000).toFixed(2)} m³`;
  },

  updateControlPanel(isRunning) {
    DOM.hudIcon.textContent = isRunning ? '⏹' : '▶';
    DOM.hudLabel.textContent = isRunning ? 'STOP' : 'START';
    DOM.hudStartBtn.classList.toggle('running', isRunning);
  },

  showBlockToast(msg) {
    let t = document.getElementById('block-toast') || document.createElement('div');
    if(!t.id) { t.id = 'block-toast'; t.className = 'toast-alert'; document.body.appendChild(t); }
    t.textContent = msg; t.style.opacity = '1';
    setTimeout(() => t.style.opacity = '0', 3000);
  }
};

// --- 4. EVENT BINDINGS (Olay Dinleyiciler) ---
function bindEvents() {
  // Global & Toolbar
  DOM.themeBtn.onclick = () => {
    const isLight = document.documentElement.dataset.theme === 'light';
    document.documentElement.dataset.theme = isLight ? '' : 'light';
    localStorage.setItem('pf-theme', isLight ? '' : 'light');
  };
  DOM.btnUnits.onclick = () => {
    Units.toggle();
    DOM.btnUnits.textContent = Units.isMetric ? 'SI' : 'IMP';
  };

  DOM.btnFit.onclick = Actions.zoomToFit;
  DOM.btnClear.onclick = () => { pipelineStore.clear?.(); setupInitialState(); UI.refreshCanvas(); };
  DOM.hudStartBtn.onclick = Actions.toggleSimulation;

  // Fluid & Temp
  DOM.selectFluid.onchange = (e) => {
    _fluidId = e.target.value;
    const range = fluidRegistry.get(_fluidId)?.meta.valid_range;
    if(range) {
      DOM.tempSlider.min = range.T_min_C;
      DOM.tempSlider.max = range.T_max_C;
      _tempC = Math.max(range.T_min_C, Math.min(_tempC, range.T_max_C));
      DOM.tempSlider.value = _tempC; DOM.tempLabel.textContent = `${_tempC}°C`;
    }
    Actions.updateFluid();
  };
  DOM.tempSlider.oninput = (e) => { _tempC = parseInt(e.target.value); DOM.tempLabel.textContent = `${_tempC}°C`; Actions.updateFluid(); };

  // Resize Handlers
  document.querySelectorAll('.resize-handler').forEach(h => h.onmousedown = (e) => Actions.handleComponentResize(e, h));

  // Drag & Drop
  DOM.canvasScroll.ondragover = (e) => {
    e.preventDefault();
    const svgPt = Interactions.clientToSVG(e.clientX, e.clientY);
    Interactions.dropIdx = Interactions.calcDropIdx(svgPt.x, svgPt.y);
    renderer.render(pipelineStore.layout, { selectedId: pipelineStore.selectedId, dropIdx: Interactions.dropIdx });
  };
  DOM.canvasScroll.ondrop = (e) => {
    e.preventDefault();
    const template = JSON.parse(e.dataTransfer.getData('text/plain'));
    pipelineStore.insert(CatalogManager.makeComp(template), Interactions.dropIdx);
  };

  // Store & Engine Subscriptions
  pipelineStore.on('components:change', () => {
    UI.refreshCanvas();
    tooltip.rebind(DOM.svgCanvas);
    if (engine.sysState === SysState.RUNNING) animator.reset();
  });
  pipelineStore.on('selection:change', () => {
    UI.refreshCanvas();
    UI.renderProps();
  });
  Units.onChange(() => {
    UI.refreshCanvas();
    UI.renderProps();
    if (chart._lastData) chart.draw(chart._lastData);
    DOM.tempLabel.textContent = Units.temp(_tempC);
  });
  engine.onTick((snap) => {
    animator.update(pipelineStore.layout, snap);
    chart.draw({
      results: snap.nodes.map(n => ({
        P_in: n.P_in/1e5,
        P_out: n.P_out/1e5,
        v: n.v,
        dP_major: n.dP_major/1e5,
        dP_minor: n.dP_minor/1e5
      })),
      components: pipelineStore.components,
      selectedIdx: pipelineStore.selectedId
      ? pipelineStore.components.findIndex(c => c.id === pipelineStore.selectedId)
      : null
    });
    UI.updateHUD(snap);
  });

  renderer.onCompClick = (id) => pipelineStore.select(id);
}

// --- 5. INITIALIZATION (Açılış) ---
function setupInitialState() {
  _fluidId = SystemConfig.get('fluid_id') ?? 'water';
  _tempC   = SystemConfig.get('T_in_C')  ?? 20;
  DOM.selectFluid.value = _fluidId;
  DOM.tempSlider.value = _tempC;
  DOM.tempLabel.textContent = `${_tempC}°C`;

  if (pipelineStore.components.length === 0) {
    pipelineStore.insert(CatalogManager.makeComp({
      type: 'pump',
      subtype: 'centrifugal',
      name: 'Main Supply Pump'
    }), 0);
  }
}

// BOOT
const Interactions = {
  dropIdx: null,

  // Ekran koordinatlarını SVG koordinat sistemine çevirir
  clientToSVG(clientX, clientY) {
    const pt = DOM.svgCanvas.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = DOM.svgCanvas.getScreenCTM();
    return pt.matrixTransform(ctm.inverse());
  },

  // Elemanın boru hattında hangi sıraya (index) gireceğini hesaplar
  calcDropIdx(x, y) {
    const layouts = pipelineStore.layout;
    if (!layouts.length) return 0;

    const points = [
      ...layouts.map((l, i) => ({ idx: i, x: l.ix, y: l.iy })),
      { idx: layouts.length, x: layouts.at(-1).ox, y: layouts.at(-1).oy },
    ];

    const closest = points.reduce((prev, curr) =>
      Math.hypot(x - curr.x, y - curr.y) < Math.hypot(x - prev.x, y - prev.y) ? curr : prev
    );

    // Pompa (index 0) her zaman sabit kalmalı, o yüzden en az 1 döner
    return Math.max(1, closest.idx);
  }
};

const CatalogManager = {
  // Sol paneldeki "chip"leri (sürüklenebilir elemanlar) ekrana basar
  render() {
    DOM.catBody.innerHTML = CATALOG_DEF.map((grp, gi) => {
      const validItems = grp.items.filter(it => it.type !== 'pump'); // Pompa katalogda görünmez
      if (!validItems.length) return '';

      return `
        <div class="cat-chip-group">
          <div class="cat-chip-label">${grp.group}</div>
          <div class="cat-chips">
            ${validItems.map((it, ii) => `
              <div class="cat-chip" draggable="true" data-gi="${gi}" data-ii="${ii}">
                ${it.icon}
              </div>`).join('')}
          </div>
        </div>`;
    }).join('');

    this.bindCatalogEvents();
  },

  // Katalogdaki elemanlara sürükleme yeteneği kazandırır
  bindCatalogEvents() {
    DOM.catBody.querySelectorAll('.cat-chip').forEach(el => {
      el.ondragstart = (e) => {
        const gi = parseInt(el.dataset.gi);
        const ii = parseInt(el.dataset.ii);
        const template = CATALOG_DEF[gi].items[ii];
        e.dataTransfer.setData('text/plain', JSON.stringify(template));
      };
    });
  },

  // Verilen şablondan gerçek bir Component nesnesi türetir
  makeComp(template) {
    const comp = createComponent(template.type, template.subtype);
    comp.name = template.name ?? comp.name;

    if (template.defaultOverrides) {
      Object.entries(template.defaultOverrides).forEach(([k, v]) => comp.override(k, v));
    }

    // Çap sürekliliği: Yeni eleman, bir önceki elemanın çıkış çapını devralır
    const last = pipelineStore.components.at(-1);
    if (last && comp.type !== 'pipe' && !comp.hasOverride('diameter_mm')) {
      comp.override('diameter_mm', last.outDiameter_mm);
    }

    return comp;
  }
};

(function init() {
  if (localStorage.getItem('pf-theme') === 'light'){
    document.documentElement.dataset.theme = 'light';
  }
  CatalogManager.render();
  bindEvents();
  setupInitialState();
  Actions.updateFluid();
  tooltip.rebind(DOM.svgCanvas);
})();

