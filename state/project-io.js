'use strict';

const STORAGE_KEY = 'pf-pipeline-v2';

/**
 * createProjectIO({ engine, animator, UI, Actions, DOM, tooltip, zoom,
 *                   setupInitialState, SysState, pipelineStore, SystemConfig,
 *                   createComponent, onSyncFluid })
 * Döndürür: { saveProject, loadProject, newProject, exportJSON, importJSON, STORAGE_KEY }
 */
export function createProjectIO({
									engine,
									animator,
									UI,
									Actions,
									DOM,
									tooltip,
									zoom,           // IO5: zoom inject edildi
									setupInitialState,
									SysState,
									pipelineStore,
									SystemConfig,
									createComponent,
									onSyncFluid,
								}) {

	// <editor-fold desc="saveProject">
	function saveProject(silent = false) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(pipelineStore.serialize()));
			if (!silent) UI.showBlockToast('Saved');
		} catch (e) {
			UI.showBlockToast('Save failed: ' + e.message);
		}
	}
	// </editor-fold>

	// <editor-fold desc="loadProject">
	function loadProject() {
		const raw = localStorage.getItem(STORAGE_KEY);
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
			// IO5: load sonrası zoom sıfırla
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
		// IO2: yeni proje açılınca eski proje localStorage'da kalmasın
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
					// IO1: UI.updateFluid() → Actions.updateFluid() (UI objesinde bu metod yok)
					Actions.updateFluid();
					UI.refreshCanvas();
					UI.renderProps();
					tooltip.rebind(DOM.svgCanvas);
					// IO5: import sonrası zoom sıfırla
					zoom.reset();
					Actions.zoomToFit();
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

	return { saveProject, loadProject, newProject, exportJSON, importJSON, STORAGE_KEY };
}