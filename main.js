'use strict';

// ─── IMPORTS ─────────────────────────────────────────────────────────────────
import { SystemConfig }               from './state/system-config.js';
import { pipelineStore }              from './state/pipeline-store.js';
import { SVGRenderer }                from './renderer/svg-renderer.js';
import { ChartRenderer }              from './renderer/chart-renderer.js';
import { FlowAnimator }               from './renderer/flow-animator.js';
import { TooltipManager }             from './renderer/tooltip-manager.js';
import { SimulationEngine, SysState } from './Simulation/SimulationEngine.js';
import { Units }                      from './data/unit-system.js';
import { fluidRegistry }              from './data/fluid-model.js';
import { createComponent }            from './components/base.js';
import { createCatalogManager }       from './catalog-manager.js';

// Component kayıtları (yan etkili import — sıra önemli değil)
import './components/pipe.js';
import './components/transition.js';
import './components/elbow.js';
import './components/valve.js';
import './components/pump.js';
import './components/prv.js';

// ─── DOM ──────────────────────────────────────────────────────────────────────
const DOM = {
  // Layout
  canvasScroll:     document.getElementById('canvas-scroll'),
  colLeft:          document.getElementById('col-left'),
  panelCatalog:     document.getElementById('panel-catalog'),
  panelProps:       document.getElementById('panel-props'),
  panelChart:       document.getElementById('panel-chart'),
  sidebarToggle:    document.getElementById('sidebar-toggle'),

  // Canvas
  svgCanvas:        document.getElementById('svg-canvas'),
  flowCanvas:       document.getElementById('flow-canvas'),
  chartCanvas:      document.getElementById('chart-canvas'),

  // Panel bodies
  catBody:          document.getElementById('cat-body'),
  propBody:         document.getElementById('prop-body'),

  // Topbar — fluid
  selectFluid:      document.getElementById('select-fluid'),
  tempSlider:       document.getElementById('temp-slider'),
  tempLabel:        document.getElementById('temp-label'),

  // Topbar — butonlar
  themeBtn:         document.getElementById('theme-btn'),
  btnUnits:         document.getElementById('btn-units'),
  btnNew:           document.getElementById('btn-new'),       // dropdown item
  btnNewTab:        document.getElementById('btn-new-tab'),   // dropdown item
  btnSave:          document.getElementById('btn-save'),      // dropdown item
  btnLoad:          document.getElementById('btn-load'),      // dropdown item
  btnExportJson:    document.getElementById('btn-export-json'),

  // Dropdown triggers
  ddNew:            document.getElementById('dd-new'),
  ddNewTrigger:     document.getElementById('dd-new-trigger'),
  ddExport:         document.getElementById('dd-export'),
  ddExportTrigger:  document.getElementById('dd-export-trigger'),

  // Tab bar
  tabBar:           document.getElementById('tab-bar'),
  btnTabAdd:        document.getElementById('btn-tab-add'),

  // Canvas toolbar
  btnLabel:         document.getElementById('btn-label'),
  btnFit:           document.getElementById('btn-fit'),
  btnClear:         document.getElementById('btn-clear'),

  // HUD
  hudStartBtn:      document.getElementById('hud-start-btn'),
  hudIcon:          document.getElementById('hud-btn-icon'),
  hudLabel:         document.getElementById('hud-btn-label'),
  hudTime:          document.getElementById('hud-time'),
  hudVol:           document.getElementById('hud-vol'),

  // Bottombar
  statusDot:        document.getElementById('status-dot'),
  statusText:       document.getElementById('status-text'),
  statusComponents: document.getElementById('status-components'),
  statusConfig:     document.getElementById('status-config'),
};

const STORAGE_KEY = 'pf-pipeline-v2';
let _fluidId, _tempC;

// ─── INSTANCES ────────────────────────────────────────────────────────────────
const renderer = new SVGRenderer(DOM.svgCanvas);
const chart    = new ChartRenderer(DOM.chartCanvas);
const engine   = new SimulationEngine(pipelineStore, { rho: 1000, mu: 0.001 });
const animator = new FlowAnimator(DOM.svgCanvas, DOM.flowCanvas);
const tooltip  = new TooltipManager(DOM.svgCanvas, engine, pipelineStore);

// ─── ACTIONS ──────────────────────────────────────────────────────────────────
const Actions = {
  updateFluid() {
    const model = fluidRegistry.get(_fluidId);
    if (!model) return;
    const props = model.getProps(_tempC);
    engine.setFluid({ rho: props.rho, mu: props.mu_mPas / 1000 });
    SystemConfig.set('T_in_C',   _tempC);
    SystemConfig.set('fluid_id', _fluidId);
    UI.updateStatusBar();
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
    const kind        = handle.dataset.resize;
    const startX      = e.clientX, startY = e.clientY;
    const startColW   = DOM.colLeft.offsetWidth;
    const startChartH = DOM.panelChart.offsetHeight;
    const startPropH  = DOM.panelProps.offsetHeight;
    const onMove = (me) => {
      if      (kind === 'vertical') DOM.colLeft.style.width     = Math.min(380, Math.max(160, startColW   + (me.clientX - startX))) + 'px';
      else if (kind === 'left')     DOM.panelProps.style.height = Math.min(500, Math.max(80,  startPropH  - (me.clientY - startY))) + 'px';
      else if (kind === 'right')    DOM.panelChart.style.height = Math.min(500, Math.max(80,  startChartH - (me.clientY - startY))) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',  onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  },

  deleteComponent() {
    pipelineStore.remove(pipelineStore.selectedId);
    UI.renderProps();
  },

  zoomToFit() {
    const bbox = DOM.svgCanvas.getBBox();
    if (!bbox.width || !bbox.height) return;
    const pad = 40;
    DOM.svgCanvas.setAttribute('viewBox',
        `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
  },

  saveProject(silent = false) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pipelineStore.serialize()));
      if (!silent) UI.showBlockToast('Saved');
    } catch (e) { UI.showBlockToast('Save failed: ' + e.message); }
  },

  loadProject() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { UI.showBlockToast('No saved project found'); return; }
    try {
      const data = JSON.parse(raw);
      if (engine.sysState !== SysState.IDLE) {
        engine.stop(); animator.stop(); UI.updateControlPanel(false);
      }
      pipelineStore.deserialize(data, (type, subtype) => createComponent(type, subtype));
      _fluidId = SystemConfig.get('fluid_id') ?? 'water';
      _tempC   = SystemConfig.get('T_in_C')   ?? 20;
      DOM.selectFluid.value     = _fluidId;
      DOM.tempSlider.value      = _tempC;
      DOM.tempLabel.textContent = `${_tempC}°C`;
      Actions.updateFluid();
      UI.refreshCanvas();
      UI.renderProps();
      tooltip.rebind(DOM.svgCanvas);
      UI.showBlockToast('Loaded');
    } catch (e) {
      UI.showBlockToast('Load failed: ' + e.message);
      console.error('[Load]', e);
    }
  },

  newProject() {
    if (engine.sysState !== SysState.IDLE) {
      engine.stop(); animator.stop(); UI.updateControlPanel(false);
    }
    pipelineStore.clear();
    SystemConfig.reset();
    _fluidId = SystemConfig.get('fluid_id') ?? 'water';
    _tempC   = SystemConfig.get('T_in_C')   ?? 20;
    DOM.selectFluid.value     = _fluidId;
    DOM.tempSlider.value      = _tempC;
    DOM.tempLabel.textContent = `${_tempC}°C`;
    setupInitialState();
    Actions.updateFluid();
    UI.refreshCanvas();
    UI.renderProps();
    tooltip.rebind(DOM.svgCanvas);
  },

  exportJSON() {
    try {
      const data = JSON.stringify(pipelineStore.serialize(), null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `pipeflow-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { UI.showBlockToast('Export failed: ' + e.message); }
  },

  toggleSidebar() {
    const collapsed = DOM.colLeft.classList.toggle('collapsed');
    DOM.sidebarToggle.textContent = collapsed ? '›' : '‹';
    DOM.sidebarToggle.title = collapsed ? 'Show sidebar' : 'Hide sidebar';
  },
};

// ─── UI ───────────────────────────────────────────────────────────────────────
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
      DOM.propBody.innerHTML = `
        <div id="prop-empty">
          <div class="prop-empty-icon">◈</div>
          <div class="prop-empty-text">SELECT A COMPONENT</div>
        </div>`;
      return;
    }
    const isPump = comp.type === 'pump';
    DOM.propBody.innerHTML = `
      <div class="prop-section"><div class="section-title">${comp.name}</div></div>
      <div class="prop-section"><div class="section-title">Parameters</div>${comp.renderPropsHTML()}</div>
      ${isPump ? '' : '<button class="btn-delete" id="del-btn">Remove</button>'}`;
    if (!isPump) DOM.propBody.querySelector('#del-btn').onclick = Actions.deleteComponent;
    this.bindPropInputs(comp);
  },

  bindPropInputs(comp) {
    DOM.propBody.querySelectorAll('[data-prop]').forEach(el => {
      const eventName = el.tagName === 'SELECT' ? 'onchange' : 'oninput';
      el[eventName] = () => {
        const prop = el.dataset.prop;
        const raw  = el.value;
        if (el.type === 'range') {
          const label = el.nextElementSibling;
          if (label) label.textContent = raw + '%';
        }
        if (prop === 'transition_pair') {
          const [d_in, d_out] = raw.split('|').map(Number);
          comp.override('d_in_mm',  d_in,  true);
          comp.override('d_out_mm', d_out, true);
          pipelineStore._propagateDiameter(pipelineStore.components.indexOf(comp));
          this.renderProps();
        } else if (prop === 'opening_pct') {
          const val = parseInt(raw);
          const tag = DOM.propBody.querySelector('.valve-status-tag');
          if (tag) {
            tag.textContent  = val > 0 ? 'OPEN' : 'CLOSED';
            tag.className    = `valve-status-tag ${val > 0 ? 'on' : 'off'}`;
          }
          comp.opening_pct = val;
          comp.open        = val > 0;
          engine.setComponentProp(comp.id, 'opening', val / 100);
        } else if (prop === 'efficiency') {
          comp.override('efficiency', parseInt(raw) / 100, true);
        } else {
          const num = parseFloat(raw);
          comp.override(prop, isNaN(num) ? raw : num, true);
          if (['diameter_mm', 'd_out_mm'].includes(prop))
            pipelineStore._propagateDiameter(pipelineStore.components.indexOf(comp));
        }
        pipelineStore.emit('components:change');
      };
    });
  },

  updateHUD(snapshot) {
    const t = snapshot.t;
    DOM.hudTime.textContent =
        `${String(Math.floor(t / 3600)).padStart(2, '0')}:` +
        `${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:` +
        `${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const vol = snapshot.totalVolume_m3 * 1000;
    DOM.hudVol.textContent = vol < 1000 ? `${vol.toFixed(1)} L` : `${(vol / 1000).toFixed(2)} m³`;

    const pumpNode = snapshot.nodes.find(n => n.type === 'pump');
    DOM.propBody.querySelectorAll('[data-live="P_shaft"]').forEach(el => {
      el.textContent = isFinite(pumpNode?.P_shaft) ? `${Math.round(pumpNode.P_shaft)} W` : '—';
    });

    snapshot.nodes.filter(n => n.subtype === 'prv').forEach(n => {
      const isActive = n.prvState === 'active';
      const ratio    = (isFinite(n.P_in) && n.P_set_Pa > 0) ? Math.min(1, n.P_in / n.P_set_Pa) : 0;
      const fill = !isFinite(n.P_in) ? 'var(--text-dim)'
          : ratio < 0.8 ? 'var(--green)'
              : ratio < 1.0 ? 'var(--accent)'
                  : 'var(--red)';
      DOM.svgCanvas.querySelector(`[data-prv-circle="${n.id}"]`)?.setAttribute('fill', fill);
      DOM.propBody.querySelectorAll('[data-live="prv_status"]').forEach(el => {
        el.textContent = isActive ? 'ACTIVE' : 'INACTIVE';
        el.style.color = isActive ? 'var(--red)' : '';
      });
      DOM.propBody.querySelectorAll('[data-live="prv_p_in"]').forEach(el => {
        el.textContent = isFinite(n.P_in) ? Units.pressure(n.P_in / 1e5) : '—';
      });
    });
  },

  updateControlPanel(isRunning) {
    DOM.hudIcon.textContent  = isRunning ? '■' : '▶';
    DOM.hudLabel.textContent = isRunning ? 'STOP' : 'START';
    DOM.hudStartBtn.classList.toggle('running', isRunning);
    if (!isRunning) {
      DOM.hudStartBtn.classList.remove('alarm', 'shake');
      DOM.statusDot.className  = 'status-dot ok';
      DOM.statusText.textContent = 'Ready';
    } else {
      DOM.statusDot.className  = 'status-dot ok';
      DOM.statusText.textContent = 'Running';
    }
  },

  updateStatusBar() {
    const n = pipelineStore.components.length;
    DOM.statusComponents.textContent = `${n} component${n !== 1 ? 's' : ''}`;
    const fluidName = DOM.selectFluid.options[DOM.selectFluid.selectedIndex]?.text ?? '—';
    DOM.statusConfig.textContent = `${fluidName} · ${_tempC}°C`;
  },

  showBlockToast(msg) {
    let t = document.getElementById('block-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'block-toast';
      t.className = 'toast-alert';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(() => t.style.opacity = '0', 3000);
  },
};

// ─── EVENT BINDINGS ───────────────────────────────────────────────────────────
function bindEvents() {
  bindToolbar();
  bindDropdowns();
  bindSidebar();
  bindFluidControls();
  bindResizeHandlers();
  bindDragDrop();
  bindStoreSubscriptions();
  bindEngineCallbacks();
  bindKeyboard();
  renderer.onCompClick = (id) => pipelineStore.select(id);
}

function bindToolbar() {
  DOM.themeBtn.onclick = () => {
    const isLight = document.documentElement.dataset.theme === 'light';
    document.documentElement.dataset.theme = isLight ? '' : 'light';
    localStorage.setItem('pf-theme', isLight ? '' : 'light');
  };
  DOM.btnUnits.onclick    = () => { Units.toggle(); DOM.btnUnits.textContent = Units.isMetric ? 'SI' : 'IMP'; };
  DOM.btnClear.onclick    = () => { pipelineStore.clear?.(); setupInitialState(); UI.refreshCanvas(); };
  DOM.btnFit.onclick      = Actions.zoomToFit;
  DOM.hudStartBtn.onclick = Actions.toggleSimulation;

  // Dropdown item bağlantıları
  DOM.btnNew.onclick        = () => { closeAllDropdowns(); Actions.newProject(); };
  DOM.btnSave.onclick       = () => { closeAllDropdowns(); Actions.saveProject(); };
  DOM.btnLoad.onclick       = () => { closeAllDropdowns(); Actions.loadProject(); };
  DOM.btnExportJson.onclick = () => { closeAllDropdowns(); Actions.exportJSON(); };

  // Tab bar
  DOM.btnTabAdd.onclick = () => UI.showBlockToast('Multi-tab coming soon');
}

function bindDropdowns() {
  DOM.ddNewTrigger.onclick    = (e) => { e.stopPropagation(); toggleDropdown('dd-new'); };
  DOM.ddExportTrigger.onclick = (e) => { e.stopPropagation(); toggleDropdown('dd-export'); };
  document.addEventListener('click', closeAllDropdowns);
}

function toggleDropdown(id) {
  const dd = document.getElementById(id);
  const wasOpen = dd.classList.contains('open');
  closeAllDropdowns();
  if (!wasOpen) dd.classList.add('open');
}

function closeAllDropdowns() {
  document.querySelectorAll('.tb-dropdown.open').forEach(d => d.classList.remove('open'));
}

function bindSidebar() {
  DOM.sidebarToggle.onclick = Actions.toggleSidebar;
}

function bindFluidControls() {
  DOM.selectFluid.onchange = (e) => {
    _fluidId = e.target.value;
    const range = fluidRegistry.get(_fluidId)?.meta.valid_range;
    if (range) {
      DOM.tempSlider.min = range.T_min_C;
      DOM.tempSlider.max = range.T_max_C;
      _tempC = Math.max(range.T_min_C, Math.min(_tempC, range.T_max_C));
      DOM.tempSlider.value      = _tempC;
      DOM.tempLabel.textContent = `${_tempC}°C`;
    }
    Actions.updateFluid();
  };
  DOM.tempSlider.oninput = (e) => {
    _tempC = parseInt(e.target.value);
    DOM.tempLabel.textContent = `${_tempC}°C`;
    Actions.updateFluid();
  };
}

function bindResizeHandlers() {
  document.querySelectorAll('.resize-handler').forEach(h =>
      h.onmousedown = (e) => Actions.handleComponentResize(e, h)
  );
}

function bindDragDrop() {
  DOM.canvasScroll.ondragover = (e) => {
    e.preventDefault();
    const svgPt = Interactions.clientToSVG(e.clientX, e.clientY);
    Interactions.dropIdx = Interactions.calcDropIdx(svgPt.x, svgPt.y);
    renderer.render(pipelineStore.layout, {
      selectedId: pipelineStore.selectedId,
      dropIdx:    Interactions.dropIdx,
    });
  };
  DOM.canvasScroll.ondrop = (e) => {
    e.preventDefault();
    const template = JSON.parse(e.dataTransfer.getData('text/plain'));
    pipelineStore.insert(CatalogManager.makeComp(template), Interactions.dropIdx);
  };
}

function bindStoreSubscriptions() {
  pipelineStore.on('components:change', () => {
    UI.refreshCanvas();
    UI.updateStatusBar();
    tooltip.rebind(DOM.svgCanvas);
    if (engine.sysState === SysState.RUNNING) animator.reset();
    if (engine.sysState === SysState.IDLE)    Actions.saveProject(true);
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
}

function bindEngineCallbacks() {
  engine.onTick((snap) => {
    animator.update(pipelineStore.layout, snap);
    chart.draw({
      results: snap.nodes.map(n => ({
        P_in:      n.P_in  / 1e5,
        P_out:     n.P_out / 1e5,
        v:         n.v,
        dP_major:  n.dP_major / 1e5,
        dP_minor:  n.dP_minor / 1e5,
      })),
      components:  pipelineStore.components,
      selectedIdx: pipelineStore.selectedId
          ? pipelineStore.components.findIndex(c => c.id === pipelineStore.selectedId)
          : null,
    });
    UI.updateHUD(snap);
  });

  engine.onAlarm((alarms) => {
    const significant = alarms.filter(a => a.level !== 'info');
    if (!significant.length) return;
    DOM.hudStartBtn.classList.add('alarm');
    DOM.hudStartBtn.classList.remove('shake');
    void DOM.hudStartBtn.offsetWidth; // reflow — animasyonu sıfırla
    DOM.hudStartBtn.classList.add('shake');
    DOM.statusDot.className   = 'status-dot err';
    DOM.statusText.textContent = 'Alarm';
    const top = significant.find(a => a.level === 'critical') ?? significant[0];
    UI.showBlockToast(top.message);
  });
}

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    const active   = document.activeElement;
    const inExpand = active?.closest('.cat-chip-expand');
    if (inExpand) { _handleExpandKey(e, inExpand); return; }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(active?.tagName)) return;
    _handleCatalogKey(e);
  });
}

function _handleExpandKey(e, inExpand) {
  const focusables = Array.from(
      inExpand.querySelectorAll('input:not([disabled]), select:not([disabled])')
  );
  const idx = focusables.indexOf(document.activeElement);
  switch (e.key) {
    case 'Tab':        if (!e.shiftKey) { e.preventDefault(); focusables[idx + 1]?.focus(); } break;
    case 'ArrowDown':  e.preventDefault(); focusables[idx + 1]?.focus(); break;
    case 'ArrowUp':    e.preventDefault(); focusables[idx - 1]?.focus(); break;
    case 'ArrowRight': e.preventDefault(); _stepInput(document.activeElement,  1); break;
    case 'ArrowLeft':  e.preventDefault(); _stepInput(document.activeElement, -1); break;
    case 'Enter':      e.preventDefault(); inExpand.querySelector('.cat-expand-add')?.click(); break;
    case 'Escape':     e.preventDefault(); CatalogManager.closeExpanded(); break;
  }
}

function _handleCatalogKey(e) {
  switch (e.key) {
    case 'ArrowUp':    e.preventDefault(); CatalogManager.navigateUp();          break;
    case 'ArrowDown':  e.preventDefault(); CatalogManager.navigateDown();        break;
    case 'Enter':      e.preventDefault(); CatalogManager.toggleExpandFocused(); break;
    case ' ':          e.preventDefault(); CatalogManager.addDirect();           break;
    case 'ArrowLeft': {
      e.preventDefault();
      const comps = pipelineStore.components; if (!comps.length) break;
      const cur   = comps.findIndex(c => c.id === pipelineStore.selectedId);
      pipelineStore.select(comps[cur <= 0 ? comps.length - 1 : cur - 1].id);
      break;
    }
    case 'ArrowRight': {
      e.preventDefault();
      const comps = pipelineStore.components; if (!comps.length) break;
      const cur   = comps.findIndex(c => c.id === pipelineStore.selectedId);
      pipelineStore.select(comps[(cur === -1 || cur === comps.length - 1) ? 0 : cur + 1].id);
      break;
    }
    case 'Delete':
    case 'Backspace':
      if (pipelineStore.selectedComp?.type !== 'pump') Actions.deleteComponent();
      break;
    case 'Escape':
      if (!CatalogManager.closeExpanded()) pipelineStore.select(null);
      break;
  }
}

function _stepInput(el, dir) {
  if (!el) return;
  if (el.tagName === 'SELECT') {
    const idx = el.selectedIndex;
    if (dir > 0 && idx < el.options.length - 1) el.selectedIndex = idx + 1;
    if (dir < 0 && idx > 0)                     el.selectedIndex = idx - 1;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (el.type === 'number' || el.type === 'range') {
    const prop = el.dataset.prop;
    const gi   = CatalogManager._focusedGi;
    const ii   = CatalogManager._focusedIi;
    let step   = parseFloat(el.step) || 1;
    if (prop) {
      try {
        const t = CatalogManager._getTemplate(gi, ii);
        const constraint = createComponent(t.type, t.subtype).getConstraint(prop);
        if (constraint?.step) step = constraint.step;
      } catch (_) {}
    }
    const min = el.min !== '' ? parseFloat(el.min) : -Infinity;
    const max = el.max !== '' ? parseFloat(el.max) :  Infinity;
    el.value  = Math.min(max, Math.max(min, +(parseFloat(el.value || 0) + dir * step).toFixed(10)));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────
const Interactions = {
  dropIdx: null,
  clientToSVG(clientX, clientY) {
    const pt = DOM.svgCanvas.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(DOM.svgCanvas.getScreenCTM().inverse());
  },
  calcDropIdx(x, y) {
    const layouts = pipelineStore.layout;
    if (!layouts.length) return 0;
    const points = [
      ...layouts.map((l, i) => ({ idx: i, x: l.ix, y: l.iy })),
      { idx: layouts.length, x: layouts.at(-1).ox, y: layouts.at(-1).oy },
    ];
    return Math.max(1, points.reduce((prev, curr) =>
        Math.hypot(x - curr.x, y - curr.y) < Math.hypot(x - prev.x, y - prev.y) ? curr : prev
    ).idx);
  },
};

// ─── INIT ─────────────────────────────────────────────────────────────────────
function setupInitialState() {
  _fluidId = SystemConfig.get('fluid_id') ?? 'water';
  _tempC   = SystemConfig.get('T_in_C')   ?? 20;
  DOM.selectFluid.value     = _fluidId;
  DOM.tempSlider.value      = _tempC;
  DOM.tempLabel.textContent = `${_tempC}°C`;
  if (pipelineStore.components.length === 0) {
    pipelineStore.insert(CatalogManager.makeComp({
      type: 'pump', subtype: 'centrifugal', name: 'Main Supply Pump',
    }), 0);
  }
}

const CatalogManager = createCatalogManager({
  catBody:   DOM.catBody,
  showToast: (msg) => UI.showBlockToast(msg),
});

(function init() {
  if (localStorage.getItem('pf-theme') === 'light')
    document.documentElement.dataset.theme = 'light';
  CatalogManager.render();
  bindEvents();
  if (localStorage.getItem(STORAGE_KEY)) Actions.loadProject();
  else { setupInitialState(); Actions.updateFluid(); }
  UI.updateStatusBar();
  tooltip.rebind(DOM.svgCanvas);
})();