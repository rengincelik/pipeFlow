'use strict';

/**
 * createHudUpdater({ DOM, Units })
 * Döndürür: { update(snapshot) }
 */
export function createHudUpdater({ DOM, Units }) {

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
	// Units.volume(m3) — metric: L / m³, imperial: gal / kgal
	// Units.onChange ile birim değişince otomatik yeniden çizilir (bindStoreSubscriptions'ta)
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
		nodes.filter(n => n.subtype === 'prv').forEach(n => {
			const isActive = n.prvState === 'active';
			const ratio    = (isFinite(n.P_in) && n.P_set_Pa > 0)
				? Math.min(1, n.P_in / n.P_set_Pa)
				: 0;

			const fill = !isFinite(n.P_in) ? 'var(--text-dim)'
				: ratio < 0.8               ? 'var(--green)'
					: ratio < 1.0               ? 'var(--accent)'
						:                             'var(--red)';

			DOM.svgCanvas
				.querySelector(`[data-prv-circle="${n.id}"]`)
				?.setAttribute('fill', fill);

			DOM.propBody.querySelectorAll('[data-live="prv_status"]').forEach(el => {
				el.textContent = isActive ? 'ACTIVE' : 'INACTIVE';
				el.style.color = isActive ? 'var(--red)' : '';
			});

			DOM.propBody.querySelectorAll('[data-live="prv_p_in"]').forEach(el => {
				el.textContent = isFinite(n.P_in)
					// P_in Pa cinsinden gelir, Units.pressure bar bekler
					? Units.pressure(n.P_in / 1e5)
					: '—';
			});
		});
	}
	// </editor-fold>

	return { update, redrawVolume: () => { if (_lastVolume_m3 != null) DOM.hudVol.textContent = Units.volume(_lastVolume_m3); } };
}