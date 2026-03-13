'use strict';

/**
 * createHudUpdater({ DOM, Units, pipelineStore })
 * Döndürür: { update(snapshot), redrawVolume() }
 */
export function createHudUpdater({ DOM, Units, pipelineStore }) {

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
		DOM.propBody.querySelectorAll('[data-live="P_shaft"]').forEach(el => {
			el.textContent = isFinite(pumpNode?.P_shaft)
				? `${Math.round(pumpNode.P_shaft)} W`
				: '—';
		});
	}
	// </editor-fold>

	// <editor-fold desc="_updatePRV">
	function _updatePRV(nodes) {
		// HU5: Sadece seçili component PRV ise prop panel'i güncelle.
		// SVG circle her PRV için güncellenir (id bazlı — çakışma yok).
		const selectedId   = pipelineStore.selectedId;
		const selectedComp = pipelineStore.selectedComp;
		const selectedIsPRV = selectedComp?.type === 'valve' && selectedComp?.subtype === 'prv';

		nodes.filter(n => n.subtype === 'prv').forEach(n => {
			// SVG circle — id bazlı, her PRV'nin kendi circle'ı, güncelleme güvenli
			const ratio = (isFinite(n.P_in) && n.P_set_Pa > 0)
				? Math.min(1, n.P_in / n.P_set_Pa)
				: 0;

			const fill = !isFinite(n.P_in) ? 'var(--text-dim)'
				: ratio < 0.8              ? 'var(--green)'
					: ratio < 1.0              ? 'var(--accent)'
						:                            'var(--red)';

			DOM.svgCanvas
				.querySelector(`[data-prv-circle="${n.id}"]`)
				?.setAttribute('fill', fill);

			// Prop panel live alanları — sadece seçili PRV'ye yaz
			if (!selectedIsPRV || n.id !== selectedId) return;

			const isActive = n.prvState === 'active';

			DOM.propBody.querySelectorAll('[data-live="prv_status"]').forEach(el => {
				el.textContent = isActive ? 'ACTIVE' : 'INACTIVE';
				el.style.color = isActive ? 'var(--red)' : '';
			});

			DOM.propBody.querySelectorAll('[data-live="prv_p_in"]').forEach(el => {
				el.textContent = isFinite(n.P_in)
					? Units.pressure(n.P_in / 1e5)
					: '—';
			});
		});
	}
	// </editor-fold>

	return {
		update,
		redrawVolume: () => { if (_lastVolume_m3 != null) DOM.hudVol.textContent = Units.volume(_lastVolume_m3); },
	};
}