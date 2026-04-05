'use strict';

/**
 * createHudUpdater({ DOM, Units, pipelineStore })
 * Returns: { update(snapshot), redrawVolume() }
 */
export function createHudUpdater({ DOM, Units, pipelineStore }) {

	// HU3/HU4: DOM query cache
	let _pShaftEls    = null;
	let _pumpStateEls = null;
	let _prvStatusEls = null;
	let _prvPInEls    = null;

	function _invalidatePropCache() {
		_pShaftEls    = null;
		_prvStatusEls = null;
		_prvPInEls    = null;
		_pumpStateEls = null;
	}

	// Reset cache when selection changes as prop panel is re-rendered
	pipelineStore.on('selection:change', _invalidatePropCache);

	// <editor-fold desc="update">
	function update(snapshot) {
		_updateTime(snapshot.t);
		_updateVolume(snapshot.totalVolume_m3);
		_updatePump(snapshot.nodes);
		_updatePRV(snapshot.nodes);
	}
	// </editor-fold>

	// <editor-fold desc="_updateTime">
	function _updateTime(t) {
		DOM.hudTime.textContent =
			`${String(Math.floor(t / 3600)).padStart(2, '0')}:` +
			`${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:` +
			`${String(Math.floor(t % 60)).padStart(2, '0')}`;
	}
	// </editor-fold>

	// <editor-fold desc="_updateVolume">
	let _lastVolume_m3 = null;

	function _updateVolume(vol_m3) {
		_lastVolume_m3 = vol_m3;
		DOM.hudVol.textContent = Units.volume(vol_m3);
	}
	// </editor-fold>

	// <editor-fold desc="_updatePump">
	function _updatePump(nodes) {
		const pumpNode = nodes.find(n => n.type === 'pump');

		// HU3: Query on cache miss, then store in cache
		if (!_pShaftEls) {
			_pShaftEls = [...DOM.propBody.querySelectorAll('[data-live="P_shaft"]')];
		}
		if (!_pumpStateEls) {
			_pumpStateEls = [...DOM.propBody.querySelectorAll('[data-live="pump_state"]')];
		}

		_pShaftEls.forEach(el => {
			el.textContent = isFinite(pumpNode?.P_shaft)
				? `${Math.round(pumpNode.P_shaft)} W`
				: '—';
		});

		// P3: Display pump_state in the property panel
		const stateLabel = {
			STOPPED:  'IDLE',
			RAMPING:  'STARTING',
			RUNNING:  'RUNNING',
			OVERLOAD: 'OVERLOAD',
		}[pumpNode?.pumpState] ?? '—';

		_pumpStateEls.forEach(el => {
			el.textContent = stateLabel;
			// Color: Red for OVERLOAD, Green for RUNNING, default otherwise
			el.style.color = pumpNode?.pumpState === 'OVERLOAD' ? 'var(--red)'
				: pumpNode?.pumpState === 'RUNNING'  ? 'var(--green)'
					: '';
		});
	}
	// </editor-fold>

	// <editor-fold desc="_updatePRV">
	function _updatePRV(nodes) {
		// HU5: Only update prop panel if the selected component is a PRV
		const selectedId    = pipelineStore.selectedId;
		const selectedComp  = pipelineStore.selectedComp;
		const selectedIsPRV = selectedComp?.type === 'valve' && selectedComp?.subtype === 'prv';

		nodes.filter(n => n.subtype === 'prv').forEach(n => {
			// SVG circle — ID-based, each PRV has its own unique circle
			const ratio = (isFinite(n.P_in) && n.P_set_Pa > 0)
				? Math.min(1, n.P_in / n.P_set_Pa)
				: 0;

			const fill = !isFinite(n.P_in)  ? 'var(--text-dim)'
				: ratio < 0.8               ? 'var(--green)'
					: ratio < 1.0               ? 'var(--accent)'
						:                             'var(--red)';

			DOM.svgCanvas
				.querySelector(`[data-prv-circle="${n.id}"]`)
				?.setAttribute('fill', fill);

			// Prop panel live fields — write only to the selected PRV
			if (!selectedIsPRV || n.id !== selectedId) return;

			const isActive = n.prvState === 'active';

			// HU4: Query on cache miss
			if (!_prvStatusEls) {
				_prvStatusEls = [...DOM.propBody.querySelectorAll('[data-live="prv_status"]')];
			}
			if (!_prvPInEls) {
				_prvPInEls = [...DOM.propBody.querySelectorAll('[data-live="prv_p_in"]')];
			}

			_prvStatusEls.forEach(el => {
				el.textContent = isActive ? 'ACTIVE' : 'INACTIVE';
				el.style.color = isActive ? 'var(--red)' : '';
			});

			_prvPInEls.forEach(el => {
				el.textContent = isFinite(n.P_in)
					? Units.pressure(n.P_in / 1e5)
					: '—';
			});
		});
	}
	// </editor-fold>

	return {
		update,
		redrawVolume: () => {
			if (_lastVolume_m3 != null) DOM.hudVol.textContent = Units.volume(_lastVolume_m3);
		},
	};
}