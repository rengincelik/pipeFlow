'use strict';

// STORAGE_KEY artık tab manager'dan dinamik geliyor.
// Eski sabit key backward-compat için korundu (migration).
const LEGACY_KEY = 'pf-pipeline-v2';

/**
 * createProjectIO({ engine, animator, UI, Actions, DOM, tooltip, zoom,
 *   setupInitialState, SysState, pipelineStore, SystemConfig,
 *   createComponent, onSyncFluid,
 *   getStorageKey   ← TAB MANAGER'dan gelen () => 'pf-tab-{id}'
 * })
 */
export function createProjectIO({
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
									onSyncFluid,
									getStorageKey,   // ← yeni: tab manager'dan inject
								}) {

	// <editor-fold desc="saveProject">
	function saveProject(silent = false) {
		try {
			const key = getStorageKey();
			localStorage.setItem(key, JSON.stringify(pipelineStore.serialize()));
			if (!silent) UI.showBlockToast('Saved');
		} catch (e) {
			UI.showBlockToast('Save failed: ' + e.message);
		}
	}
	// </editor-fold>

	// <editor-fold desc="loadProject">
	function loadProject() {
		const key = getStorageKey();
		const raw = localStorage.getItem(key)
			?? localStorage.getItem(LEGACY_KEY); // migration: eski tek-tab kaydı

		if (!raw) { UI.showBlockToast('No saved project found'); return; }

		try {
			const data = JSON.parse(raw);
			_stopIfRunning();
			pipelineStore.deserialize(data, (type, subtype) => createComponent(type, subtype));
			_syncFluidUI();
			Actions.updateFluid();
			UI.refreshCanvas();
			UI.renderProps();
			tooltip.rebind(DOM.svgCanvas);
			zoom.reset();
			Actions.zoomToFit();
			UI.showBlockToast('Loaded');
		} catch (e) {
			UI.showBlockToast('Load failed: ' + e.message);
			console.error('[Load]', e);
		}
	}
	// </editor-fold>

	// <editor-fold desc="newProject">
	function newProject() {
		_stopIfRunning();
		pipelineStore.clear();
		SystemConfig.reset();
		_syncFluidUI();
		setupInitialState();
		Actions.updateFluid();
		UI.refreshCanvas();
		UI.renderProps();
		tooltip.rebind(DOM.svgCanvas);
		saveProject(true);
	}
	// </editor-fold>

	// <editor-fold desc="switchTabProject">
	/**
	 * Tab switch'te çağrılır.
	 * isNew = true  → yeni boş proje kur
	 * isNew = false → tab'ın kaydını yükle
	 */
	function switchTabProject(isNew) {
		_stopIfRunning();
		if (isNew) {
			pipelineStore.clear();
			SystemConfig.reset();
			_syncFluidUI();
			setupInitialState();
			Actions.updateFluid();
			UI.refreshCanvas();
			UI.renderProps();
			tooltip.rebind(DOM.svgCanvas);
			zoom.reset();
			saveProject(true);
		} else {
			loadProject();
		}
	}
	// </editor-fold>

	// <editor-fold desc="saveCurrentTab">
	/**
	 * Tab switch öncesi mevcut tab'ı kaydetmek için.
	 */
	function saveCurrentTab() {
		saveProject(true);
	}
	// </editor-fold>

	// <editor-fold desc="exportJSON">
	function exportJSON() {
		try {
			const data = JSON.stringify(pipelineStore.serialize(), null, 2);
			const blob = new Blob([data], { type: 'application/json' });
			const url  = URL.createObjectURL(blob);
			const a    = document.createElement('a');
			a.href     = url;
			a.download = `pipeflow-${Date.now()}.json`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			UI.showBlockToast('Export failed: ' + e.message);
		}
	}
	// </editor-fold>

	// <editor-fold desc="importJSON">
	function importJSON() {
		const input    = document.createElement('input');
		input.type     = 'file';
		input.accept   = '.json';
		input.onchange = (e) => {
			const file = e.target.files[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (ev) => {
				try {
					const data = JSON.parse(ev.target.result);
					_stopIfRunning();
					pipelineStore.deserialize(data, (type, subtype) => createComponent(type, subtype));
					_syncFluidUI();
					Actions.updateFluid();
					UI.refreshCanvas();
					UI.renderProps();
					tooltip.rebind(DOM.svgCanvas);
					zoom.reset();
					Actions.zoomToFit();
					saveProject(true); // import sonrası aktif tab'a kaydet
					UI.showBlockToast('Imported');
				} catch (err) {
					UI.showBlockToast('Import failed: ' + err.message);
					console.error('[ImportJSON]', err);
				}
			};
			reader.readAsText(file);
		};
		input.click();
	}
	// </editor-fold>

	// <editor-fold desc="helpers">
	function _stopIfRunning() {
		if (engine.sysState !== SysState.IDLE) {
			engine.stop();
			animator.stop();
			UI.updateControlPanel(false);
		}
	}

	function _syncFluidUI() {
		const fluidId = SystemConfig.get('fluid_id') ?? 'water';
		const tempC   = SystemConfig.get('T_in_C')   ?? 20;
		DOM.selectFluid.value     = fluidId;
		DOM.tempSlider.value      = tempC;
		DOM.tempLabel.textContent = `${tempC}°C`;
		onSyncFluid(fluidId, tempC);
	}
	// </editor-fold>

	// STORAGE_KEY export'u eski API uyumluluğu için
	const STORAGE_KEY = LEGACY_KEY;

	return {
		saveProject,
		loadProject,
		newProject,
		switchTabProject,
		saveCurrentTab,
		exportJSON,
		importJSON,
		STORAGE_KEY,
		_isClearing: false,
	};
}