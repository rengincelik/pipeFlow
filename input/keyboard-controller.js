'use strict';

/**
 * createKeyboardController({ CatalogManager, Actions, pipelineStore, createComponent, catBody })
 * main.js'ten çağrılır, instance inject edilir.
 * Döndürür: { bind() }
 */
export function createKeyboardController(
	{CatalogManager, Actions, pipelineStore, createComponent, catBody }
) {

	// KB1: Constraint cache — her _stepInput çağrısında createComponent() alloc önlenir.
	// renderProps() çağrılınca (eleman değişince) cache sıfırlanır.
	const _constraintCache = new Map();

	function _getCachedConstraint(type, subtype, prop) {
		const key = `${type}:${subtype}:${prop}`;
		if (_constraintCache.has(key)) return _constraintCache.get(key);
		try {
			const constraint = createComponent(type, subtype).getConstraint(prop);
			_constraintCache.set(key, constraint);
			return constraint;
		} catch (_) {
			_constraintCache.set(key, null);
			return null;
		}
	}

	// <editor-fold desc="_stepInput">
	function _stepInput(el, dir) {
		if (!el) return;

		if (el.tagName === 'SELECT') {
			const idx = el.selectedIndex;
			if (dir > 0 && idx < el.options.length - 1) el.selectedIndex = idx + 1;
			if (dir < 0 && idx > 0) el.selectedIndex = idx - 1;
			el.dispatchEvent(new Event('change', { bubbles: true }));
			return;
		}

		if (el.type === 'number' || el.type === 'range') {
			const prop = el.dataset.prop;
			let step = parseFloat(el.step) || 1;

			if (prop) {
				try {
					const t = CatalogManager.getTemplate(CatalogManager.focusedGi, CatalogManager.focusedIi);
					// KB1: createComponent() yerine cache'den oku
					const constraint = _getCachedConstraint(t.type, t.subtype, prop);
					if (constraint?.step) step = constraint.step;
				} catch (_) {
				}
			}

			const min = el.min !== '' ? parseFloat(el.min) : -Infinity;
			const max = el.max !== '' ? parseFloat(el.max) : Infinity;
			el.value = Math.min(max, Math.max(min, +(parseFloat(el.value || 0) + dir * step).toFixed(10)));
			el.dispatchEvent(new Event('input', { bubbles: true }));
		}
	}

	// </editor-fold>

	// <editor-fold desc="_handleExpandKey">
	function _handleExpandKey(e, inExpand) {
		const focusables = Array.from(
			inExpand.querySelectorAll('input:not([disabled]), select:not([disabled])')
		);
		const idx = focusables.indexOf(document.activeElement);

		switch (e.key) {
			case 'Tab':
				if (!e.shiftKey) {
					e.preventDefault();
					focusables[idx + 1]?.focus();
				}
				break;
			case 'ArrowDown':
				e.preventDefault();
				focusables[idx + 1]?.focus();
				break;
			case 'ArrowUp':
				e.preventDefault();
				focusables[idx - 1]?.focus();
				break;
			case 'ArrowRight':
				e.preventDefault();
				_stepInput(document.activeElement, 1);
				break;
			case 'ArrowLeft':
				e.preventDefault();
				_stepInput(document.activeElement, -1);
				break;
			case 'Enter':
				e.preventDefault();
				inExpand.querySelector('.cat-expand-add')?.click();
				break;
			case 'Escape':
				e.preventDefault();
				CatalogManager.closeExpanded();
				break;
		}
	}

	// </editor-fold>

	// <editor-fold desc="_handleCatalogKey">
	function _handleCatalogKey(e) {
		switch (e.key) {
			case 'ArrowUp':
				e.preventDefault();
				CatalogManager.navigateUp();
				break;
			case 'ArrowDown':
				e.preventDefault();
				CatalogManager.navigateDown();
				break;
			case 'Enter':
				e.preventDefault();
				CatalogManager.toggleExpandFocused();
				break;

			case ' ': {
				e.preventDefault();
				// KB3: Space sadece catalog focus'undayken component eklesin
				const active = document.activeElement;
				if (!catBody || !catBody.contains(active)) break;
				CatalogManager.addDirect();
				break;
			}

			case 'ArrowLeft': {
				e.preventDefault();
				const comps = pipelineStore.components;
				if (!comps.length) break;
				const cur = comps.findIndex(c => c.id === pipelineStore.selectedId);
				pipelineStore.select(comps[cur <= 0 ? comps.length - 1 : cur - 1].id);
				break;
			}

			case 'ArrowRight': {
				e.preventDefault();
				const comps = pipelineStore.components;
				if (!comps.length) break;
				const cur = comps.findIndex(c => c.id === pipelineStore.selectedId);
				pipelineStore.select(comps[(cur === -1 || cur === comps.length - 1) ? 0 : cur + 1].id);
				break;
			}

			case 'Delete':
			case 'Backspace':
				// KB4: INPUT/SELECT/TEXTAREA guard bind()'daki keydown handler'da yapılıyor —
				// buraya gelinmişse zaten güvenli input değil.
				// prop-slider-group'taki range input'u INPUT tag'i sayılır → zaten korunuyor.
				if (pipelineStore.selectedComp?.type !== 'pump') Actions.deleteComponent();
				break;

			case 'Escape':
				if (!CatalogManager.closeExpanded()) pipelineStore.select(null);
				break;
		}
	}

	// </editor-fold>

	// <editor-fold desc="bind">
	function bind() {
		document.addEventListener('keydown', (e) => {
			const active = document.activeElement;
			const inExpand = active?.closest('.cat-chip-expand');
			if (inExpand) {
				_handleExpandKey(e, inExpand);
				return;
			}
			// KB4: INPUT/SELECT/TEXTAREA + contenteditable içindeyken catalog key'lerini yutma
			if (['INPUT', 'SELECT', 'TEXTAREA'].includes(active?.tagName)) return;
			if (active?.isContentEditable) return;
			_handleCatalogKey(e);
		});
	}

	// </editor-fold>

	return { bind };
}