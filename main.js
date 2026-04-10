'use strict';
// <editor-fold desc="IMPORTS">
import {
	SystemConfig,
	pipelineStore,
	SVGRenderer,
	ChartRenderer,
	FlowAnimator,
	TooltipManager,
	SimulationEngine,
	SysState,
	Units,
	fluidRegistry,
	createComponent,
	createCatalogManager
} from './imports.js';

import { MATERIALS }                   from './data/catalogs.js';
import { VALVE_DEFS }                  from './components/valve.js';
import { createKeyboardController }    from './input/keyboard-controller.js';
import { createProjectIO }             from './state/project-io.js';
import { createDropdownManager }       from './ui/dropdown-manager.js';
import { createHudUpdater }            from './ui/hud-updater.js';
import { createZoomController }        from './ui/zoom-controller.js';

import { createTabManager } from './state/tab-manager.js';
// </editor-fold>

// <editor-fold desc="DOM">
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

	// Topbar — buttons
	themeBtn:         document.getElementById('theme-btn'),
	btnUnits:         document.getElementById('btn-units'),
	btnExportJson:    document.getElementById('btn-export-json'),
	btnImportJson:    document.getElementById('btn-import-json'),
	btnTabAdd:        document.getElementById('btn-tab-add'),
	btnTabClose:     document.getElementById('btn-tab-close'),

	// Dropdown triggers
	ddExport:         document.getElementById('dd-export'),
	ddExportTrigger:  document.getElementById('dd-export-trigger'),

	// Tab bar
	tabBar:           document.getElementById('tab-bar'),

	// Canvas toolbar
	btnFit:           document.getElementById('btn-fit'),
	btnClear:         document.getElementById('btn-clear'),

	// HUD
	hudStartBtn:      document.getElementById('hud-start-btn'),
	hudIcon:          document.getElementById('hud-btn-icon'),
	hudLabel:         document.getElementById('hud-btn-label'),
	hudTime:          document.getElementById('hud-time'),
	hudVol:           document.getElementById('hud-vol'),

	// Bottom bar
	statusDot:        document.getElementById('status-dot'),
	statusText:       document.getElementById('status-text'),
	statusComponents: document.getElementById('status-components'),
	statusConfig:     document.getElementById('status-config'),
};

// </editor-fold>

// <editor-fold desc="INSTANCES">
const renderer   = new SVGRenderer(DOM.svgCanvas);
const chart      = new ChartRenderer(DOM.chartCanvas);
const engine     = new SimulationEngine(pipelineStore, { rho: 1000, mu: 0.001 });
const animator = new FlowAnimator(
	/** @type {SVGSVGElement} */ (DOM.svgCanvas),
	/** @type {HTMLCanvasElement} */ (DOM.flowCanvas)
);
const tooltip    = new TooltipManager(DOM.svgCanvas, engine, pipelineStore);
const zoom       = createZoomController(DOM.svgCanvas, DOM.flowCanvas);

const hudUpdater = createHudUpdater({ DOM, Units, pipelineStore });

// IO and keyboard — CatalogManager and Actions not yet defined,
// they will be linked in init() below.
let IO, keyboard, ddManager, tabManager;

// </editor-fold>

// <editor-fold desc="ACTIONS">
const Actions = {
	updateFluid() {
		const fluidId = SystemConfig.get('fluid_id');
		const tempC   = SystemConfig.get('T_in_C');
		const model   = fluidRegistry.get(fluidId);
		if (!model) return;
		const props = model.getProps(tempC);
		engine.setFluid({ rho: props.rho, mu: props.mu_mPas / 1000 });
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
		zoom.reset();
	},

	// IO delegates — available after init()
	saveProject(silent = false) { IO.saveProject(silent); },
//	loadProject()               { IO.loadProject(); },
//	newProject()                { IO.newProject(); },
	exportJSON()                { IO.exportJSON(); },
	importJSON()                { IO.importJSON(); },

	//todo: bunu kontrol et
	toggleSidebar() {
		const collapsed = DOM.colLeft.classList.toggle('collapsed');
		DOM.sidebarToggle.textContent = collapsed ? '›' : '‹';
		DOM.sidebarToggle.title = collapsed ? 'Show sidebar' : 'Hide sidebar';
	},
};

// </editor-fold>

// <editor-fold desc="UI">
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

	populateFluidSelect() {
	DOM.selectFluid.innerHTML = '';
	for (const [id, model] of fluidRegistry) {
		const opt = document.createElement('option');
		opt.value = String(id);
		opt.textContent = model.name;
		DOM.selectFluid.appendChild(opt);
	}
},

	bindPropInputs(comp) {
		DOM.propBody.querySelectorAll('[data-prop]').forEach(el => {
			const eventName = el.tagName === 'SELECT' ? 'onchange' : 'oninput';
			el[eventName] = () => {
				const prop = el.dataset.prop;
				const raw  = el.value;

				// Update slider label (for opening_pct and efficiency)
				if (el.type === 'range') {
					const label = el.nextElementSibling;
					if (label) label.textContent = raw + '%';
				}

				if (prop === 'transition_pair') {
					const [d_in, d_out] = raw.split('|').map(Number);
					comp.override('d_in_mm',  d_in,  true);
					comp.override('d_out_mm', d_out, true);
					pipelineStore.propagateDiameterFrom(comp);
					this.renderProps();

				} else if (prop === 'subtype' && comp.type === 'valve') {
					const def = VALVE_DEFS[raw];
					if (def) {
						comp.name    = def.name;
						comp.K       = def.K;
						comp.subtype = raw;
					}
					pipelineStore.emit('components:change');
					this.renderProps();

				} else if (prop === 'opening_pct') {
					const val = parseInt(raw);
					comp.override('opening_pct', val, true);
					const tag = DOM.propBody.querySelector('.valve-status-tag');
					if (tag) {
						tag.textContent = val > 0 ? 'OPEN' : 'CLOSED';
						tag.className   = `valve-status-tag ${val > 0 ? 'on' : 'off'}`;
					}

				} else if (prop === 'efficiency') {
					comp.override('efficiency', parseInt(raw) / 100, true);

				} else {
					const num = parseFloat(raw);

					if (prop === 'material_id') {
						const mat = MATERIALS.find(m => m.id === raw);
						if (mat) comp.override('eps_mm', mat.eps);
					}

					comp.override(prop, isNaN(num) ? raw : num, true);

					if (['diameter_mm', 'd_out_mm'].includes(prop))
						pipelineStore.propagateDiameterFrom(comp);
				}

				pipelineStore.emit('components:change');
			};
		});
	},

	updateHUD(snapshot) {
		hudUpdater.update(snapshot);
	},

	updateControlPanel(isRunning) {
		DOM.hudIcon.textContent  = isRunning ? '■' : '▶';
		DOM.hudLabel.textContent = isRunning ? 'STOP' : 'START';
		DOM.hudStartBtn.classList.toggle('running', isRunning);
		if (!isRunning) {
			DOM.hudStartBtn.classList.remove('alarm', 'shake');
			DOM.statusDot.className    = 'status-dot ok';
			DOM.statusText.textContent = 'Ready';
		} else {
			DOM.statusDot.className    = 'status-dot ok';
			DOM.statusText.textContent = 'Running';
		}
	},

	updateStatusBar() {
		const n = pipelineStore.components.length;
		DOM.statusComponents.textContent = `${n} component${n !== 1 ? 's' : ''}`;
		const fluidName = DOM.selectFluid.options[DOM.selectFluid.selectedIndex]?.text ?? '—';
		const tempC     = SystemConfig.get('T_in_C') ?? 20;
		DOM.statusConfig.textContent = `${fluidName} · ${tempC}°C`;
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

// </editor-fold>

// <editor-fold desc="EVENT BINDINGS">
function bindEvents() {
	bindToolbar();
	bindSidebar();
	bindFluidControls();
	bindResizeHandlers();
	bindDragDrop();
	bindStoreSubscriptions();
	bindEngineCallbacks();
	ddManager.bind();
	keyboard.bind();
	renderer.onCompClick = (id) => {
		if (zoom.didConsumeDrag()) return;
		pipelineStore.select(id);
	};
	zoom.attach();
}

function bindToolbar() {
	DOM.themeBtn.onclick = () => {
		const isLight = document.documentElement.dataset.theme === 'light';
		document.documentElement.dataset.theme = isLight ? '' : 'light';
		localStorage.setItem('pf-theme', isLight ? '' : 'light');
	};
	DOM.btnUnits.onclick = () => {
		Units.toggle();
		DOM.btnUnits.textContent = Units.isMetric ? 'SI' : 'IMP';
	};


	DOM.btnClear.onclick = () => {
		IO._isClearing = true;
		pipelineStore.clear?.();
		setupInitialState();
		IO._isClearing = false;
		IO.saveProject(true);
		UI.refreshCanvas();
	};
	DOM.btnFit.onclick      = Actions.zoomToFit;

	DOM.hudStartBtn.onclick = Actions.toggleSimulation;

	DOM.btnExportJson.onclick = () => { ddManager.closeAll(); Actions.exportJSON(); };

	DOM.btnImportJson.onclick = () => Actions.importJSON();

//	DOM.btnTabAdd.onclick = () => { ddManager.closeAll(); Actions.newProject(); };
	//TODO: buna yeni tab oluşturma eklenmesi lazım
	DOM.btnTabAdd.onclick = () => {
		ddManager.closeAll();
		tabManager.addTab();           // yeni tab = yeni proje
	};

//	DOM.btnTabClose=()=> {};
	//todo: bu kısma da tab kapama silme vs eklenmesi lazım

	document.querySelectorAll('[data-chart-metric]').forEach(btn => {
		btn.addEventListener('click', () => {
			document.querySelectorAll('[data-chart-metric]').forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			chart.setMetric(btn.dataset.chartMetric);
		});
	});

	const _zoomStep = (dir) => {
		const rect = DOM.svgCanvas.getBoundingClientRect();
		DOM.svgCanvas.dispatchEvent(new WheelEvent('wheel', {
			deltaY:     dir > 0 ? 1 : -1,
			bubbles:    true,
			cancelable: true,
			clientX:    rect.left + rect.width  / 2,
			clientY:    rect.top  + rect.height / 2,
		}));
	};
	document.getElementById('btn-zoom-in') ?.addEventListener('click', () => _zoomStep(-1));
	document.getElementById('btn-zoom-out')?.addEventListener('click', () => _zoomStep(+1));
}

function bindSidebar() {
	DOM.sidebarToggle.onclick = Actions.toggleSidebar;
}

function bindFluidControls() {
	DOM.selectFluid.onchange = (e) => {
		const fluidId = e.target.value;
		SystemConfig.set('fluid_id', fluidId);
		const range = fluidRegistry.get(fluidId)?.meta.valid_range;
		if (range) {
			const prevT = SystemConfig.get('T_in_C') ?? 20;
			const tempC = Math.max(range.T_min_C, Math.min(prevT, range.T_max_C));
			DOM.tempSlider.min        = range.T_min_C;
			DOM.tempSlider.max        = range.T_max_C;
			DOM.tempSlider.value      = tempC;
			DOM.tempLabel.textContent = `${tempC}°C`;
			SystemConfig.set('T_in_C', tempC);
		}
		Actions.updateFluid();
	};
	DOM.tempSlider.oninput = (e) => {
		const tempC = parseInt(e.target.value);
		SystemConfig.set('T_in_C', tempC);
		DOM.tempLabel.textContent = `${tempC}°C`;
		Actions.updateFluid();
	};
}

//TODO: properties kısmının handlerı çalışmıyor
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
		zoom.onRendererUpdate();
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
		zoom.onRendererUpdate();
		UI.updateStatusBar();
		tooltip.rebind(DOM.svgCanvas);
		if (engine.sysState === SysState.RUNNING) animator.reset();
		// M6: Do not save when _isClearing flag is active — btnClear handles its own save
		if (engine.sysState === SysState.IDLE && !IO?._isClearing) IO?.saveProject(true);
	});
	pipelineStore.on('selection:change', () => {
		UI.refreshCanvas();
		UI.renderProps();
	});
	Units.onChange(() => {
		UI.refreshCanvas();
		UI.renderProps();
		if (chart._lastData) chart.draw(chart._lastData);
		DOM.tempLabel.textContent = Units.temp(SystemConfig.get('T_in_C') ?? 20);
		hudUpdater.redrawVolume();
	});
}

function bindEngineCallbacks() {
	engine.onTick((snap) => {
		animator.update(pipelineStore.layout, snap);

		// M1/CH6: Send raw Pa — chart and Units handle pressureVal(Pa) conversion
		chart.draw({
			results: snap.nodes.map(n => ({
				P_in:     n.P_in,
				P_out:    n.P_out,
				v:        n.v,
				dP_major: n.dP_major,
				dP_minor: n.dP_minor,
				Q_m3s:    snap.Q_m3s,
			})),
			components:  pipelineStore.components,
			selectedIdx: pipelineStore.selectedId != null   // M3: falsy 0 protection
				? pipelineStore.components.findIndex(c => c.id === pipelineStore.selectedId)
				: null,
		});

		UI.updateHUD(snap);

		// M9: Update data-prv-circle attributes on every tick
		snap.nodes.forEach(n => {
			if (n.subtype !== 'prv') return;
			const el = DOM.svgCanvas.querySelector(`[data-prv-circle="${n.id}"]`);
			if (!el) return;
			el.setAttribute('fill', n.prvState === 'active' ? '#ef4444' : 'var(--c-prv)');
		});
	});

	engine.onAlarm((alarms) => {
		const significant = alarms.filter(a => a.level !== 'info');
		if (!significant.length) return;
		DOM.hudStartBtn.classList.add('alarm');
		DOM.hudStartBtn.classList.remove('shake');
		void DOM.hudStartBtn.offsetWidth;
		DOM.hudStartBtn.classList.add('shake');
		DOM.statusDot.className    = 'status-dot err';
		DOM.statusText.textContent = 'Alarm';
		const top = significant.find(a => a.level === 'critical') ?? significant[0];
		UI.showBlockToast(top.message);
	});
}

// </editor-fold>

// <editor-fold desc="INTERACTIONS">
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

// </editor-fold>


// <editor-fold desc="INIT">
function setupInitialState() {
	const fluidId = SystemConfig.get('fluid_id') ?? 'water';
	const tempC   = SystemConfig.get('T_in_C')   ?? 20;
	DOM.selectFluid.value     = fluidId;
	DOM.tempSlider.value      = tempC;
	DOM.tempLabel.textContent = `${tempC}°C`;
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
	// DOM Sanity Check — init() içine ekle, bootstrap'ın hemen başına
	(function checkDOM() {
		const missing = Object.entries(DOM)
			.filter(([, el]) => el == null)
			.map(([key]) => key);
		if (missing.length > 0) {
			console.warn('[PipeFlow] Missing DOM elements:', missing);
		}
	})();
	// 5a. tabManager oluştur — IO'dan ÖNCE
	tabManager = createTabManager({
		tabBar:    DOM.tabBar,
		showToast: (msg) => UI.showBlockToast(msg),
		onSwitch: (id, isNew, previousId) => {
			if (!isNew && previousId) {
				// Eski tab'ın key'ine kaydet
				const prevKey = `pf-tab-${previousId}`;
				try {
					localStorage.setItem(prevKey, JSON.stringify(pipelineStore.serialize()));
				} catch(e) { /* sessiz */ }
			}
			IO.switchTabProject(isNew);
		},
	});
	IO = createProjectIO({
		engine,
		animator,
		UI,
		Actions,
		DOM,
		tooltip,
		zoom,
		setupInitialState,
		SysState,
		pipelineStore,
		SystemConfig,
		createComponent,
		getStorageKey: () => tabManager.getStorageKey(),
		onSyncFluid: (fluidId, tempC) => {
			SystemConfig.set('fluid_id', fluidId);
			SystemConfig.set('T_in_C',   tempC);
		},
	});
	// 5c. tabManager.init() — tab listesini yükler, render eder
	// İlk switch/load IO var olduktan sonra olmalı
	tabManager.init();   // render() + ilk aktif tab'ı belirler

	ddManager = createDropdownManager({
		triggers: [
			{ triggerId: 'dd-export-trigger', dropdownId: 'dd-export' },
		],
	});

	keyboard = createKeyboardController({
		CatalogManager,
		Actions,
		pipelineStore,
		createComponent,
		catBody: DOM.catBody,
	});

	if (localStorage.getItem('pf-theme') === 'light')
		document.documentElement.dataset.theme = 'light';

	UI.populateFluidSelect();
	CatalogManager.render();
	bindEvents();


	// 5d. İlk yükleme — tabManager.init() aktif tab'ı belirledi,
	// storage key artık doğru. Eski loadProject/setupInitialState koşulu:
	const activeKey = tabManager.getStorageKey();
	if (localStorage.getItem(activeKey)) {
		IO.loadProject();
	} else if (localStorage.getItem(IO.STORAGE_KEY)) {
		// Migration: eski tek-tab kaydı varsa onu yükle, yeni key'e taşı
		IO.loadProject();  // loadProject zaten LEGACY_KEY'e fallback yapıyor
	} else {
		setupInitialState();
		Actions.updateFluid();
	}

	UI.updateStatusBar();
	tooltip.rebind(DOM.svgCanvas);
})();
// </editor-fold>