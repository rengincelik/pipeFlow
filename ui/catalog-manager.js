'use strict';

import { createComponent } from '../components/base.js';
import { CATALOG_DEF }     from '../data/catalogs.js';
import { pipelineStore }   from '../state/pipeline-store.js';

export function createCatalogManager({ catBody, showToast }) {

	// ── State ──────────────────────────────────────────────
	let _focusedGi   = 0;
	let _focusedIi   = 0;
	let _expandedKey = null;
	let _lastConfig  = {};

	// ── Helpers ────────────────────────────────────────────

	// CA1: Single filtering point — hide 'pump' from the catalog
	function _visibleItems(grp) {
		return grp.items.filter(it => it.type !== 'pump');
	}

	function _flatItems() {
		return CATALOG_DEF.flatMap((grp, gi) =>
			_visibleItems(grp).map((it, ii) => ({ gi, ii, item: it }))
		);
	}

	function _focusedFlatIdx() {
		return _flatItems().findIndex(f => f.gi === _focusedGi && f.ii === _focusedIi);
	}

	// CA5: Remains private — removed from public API
	function _getTemplate(gi, ii) {
		return _visibleItems(CATALOG_DEF[gi])[ii];
	}

	function _getFocusedTemplate() {
		return _getTemplate(_focusedGi, _focusedIi);
	}

	function _updateFocusHighlight() {
		catBody.querySelectorAll('.cat-chip').forEach(el => {
			const gi = parseInt(el.dataset.gi);
			const ii = parseInt(el.dataset.ii);
			el.classList.toggle('focused', gi === _focusedGi && ii === _focusedIi);
		});
	}

	function _scrollFocusedIntoView() {
		catBody.querySelector('.cat-chip.focused')
			?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}

	// ── makeComp ───────────────────────────────────────────
	function makeComp(template) {
		const comp = createComponent(template.type, template.subtype);
		comp.name  = template.name ?? comp.name;

		if (template.defaultOverrides) {
			Object.entries(template.defaultOverrides).forEach(([k, v]) => comp.override(k, v));
		}

		const last = pipelineStore.components.at(-1);
		if (last && !comp.hasOverride('diameter_mm')) {
			comp.override('diameter_mm', last.outDiameter_mm);
		}

		return comp;
	}

	// ── Render ─────────────────────────────────────────────
	function render() {
		catBody.innerHTML = CATALOG_DEF.map((grp, gi) => {
			const validItems = _visibleItems(grp);   // CA1
			if (!validItems.length) return '';
			return `
        <div class="cat-chip-group">
          <div class="cat-chip-label">${grp.group}</div>
          <div class="cat-chips">
            ${validItems.map((it, ii) => `
              <div class="cat-chip-wrap" data-gi="${gi}" data-ii="${ii}">
                <div class="cat-chip" draggable="true" data-gi="${gi}" data-ii="${ii}">
                  <span class="cat-chip-icon">${it.icon}</span> 
                  <span class="cat-chip-name">${it.desc}</span>
                  <span class="cat-chip-arrow">▾</span>
                </div>
                <div class="cat-chip-expand" id="expand-${gi}-${ii}"></div>
              </div>`).join('')}
          </div>
        </div>`;
		}).join('');

		_updateFocusHighlight();
		_bindCatalogEvents();
	}

	// ── Event binding ──────────────────────────────────────
	function _bindCatalogEvents() {
		catBody.querySelectorAll('.cat-chip').forEach(el => {
			const gi = parseInt(el.dataset.gi);
			const ii = parseInt(el.dataset.ii);

			el.ondragstart = (e) => {
				e.dataTransfer.setData('text/plain', JSON.stringify(_getTemplate(gi, ii)));
			};

			el.onclick = () => {
				_focusedGi = gi;
				_focusedIi = ii;
				_updateFocusHighlight();
				_toggleExpand(gi, ii);
			};

			el.onmouseenter = () => {
				_focusedGi = gi;
				_focusedIi = ii;
				_updateFocusHighlight();
			};
		});
	}

	function _bindExpandInputs(comp, container) {
		container.querySelectorAll('[data-prop]').forEach(el => {
			const eventName = el.tagName === 'SELECT' ? 'onchange' : 'oninput';
			el[eventName] = () => {
				const prop = el.dataset.prop;
				const raw  = el.value;

				if (el.type === 'range') {
					const lbl = el.nextElementSibling;
					if (lbl) lbl.textContent = raw + '%';
				}

				if (prop === 'transition_pair') {
					const [d_in, d_out] = raw.split('|').map(Number);
					comp.override('d_in_mm',  d_in,  true);
					comp.override('d_out_mm', d_out, true);
				} else if (prop === 'efficiency') {
					comp.override('efficiency', parseInt(raw) / 100, true);
				} else if (prop === 'opening_pct') {
					comp.override('opening_pct', parseInt(raw), true);
				} else {
					const num = parseFloat(raw);
					comp.override(prop, isNaN(num) ? raw : num, true);
				}
			};
		});
	}

	// ── Accordion ──────────────────────────────────────────
	function _toggleExpand(gi, ii) {
		const key = `${gi}:${ii}`;

		if (_expandedKey === key) {
			_closeExpand(gi, ii);
			_expandedKey = null;
			return;
		}

		if (_expandedKey) {
			const [oldGi, oldIi] = _expandedKey.split(':').map(Number);
			_closeExpand(oldGi, oldIi);
		}

		_expandedKey = key;
		_openExpand(gi, ii);
	}

	function _openExpand(gi, ii) {
		const template = _getTemplate(gi, ii);
		const expandEl = document.getElementById(`expand-${gi}-${ii}`);
		if (!expandEl) return;

		const comp = makeComp(template);
		const key  = `${template.type}:${template.subtype}`;
		const saved = _lastConfig[key];
		if (saved) Object.entries(saved).forEach(([k, v]) => comp.override(k, v, true));

		const tmp = document.createElement('div');
		tmp.innerHTML = comp.renderPropsHTML();
		tmp.querySelectorAll('.prop-row').forEach(row => {
			if (!row.querySelector('[data-prop]')) row.remove();
		});

		expandEl.innerHTML = `
      <div class="cat-expand-body">
        ${tmp.innerHTML || '<div class="cat-expand-empty">No configurable parameters</div>'}
      </div>
      <button class="cat-expand-add" data-gi="${gi}" data-ii="${ii}">＋ Add</button>`;

		expandEl.style.maxHeight = expandEl.scrollHeight + 200 + 'px';
		expandEl.classList.add('open');

		catBody.querySelector(`.cat-chip[data-gi="${gi}"][data-ii="${ii}"]`)
			?.querySelector('.cat-chip-arrow')?.classList.add('rotated');

		_bindExpandInputs(comp, expandEl);

		expandEl.querySelector('.cat-expand-add').onclick = () => {
			const last = pipelineStore.components.at(-1);
			if (last && !comp.hasUserOverride('diameter_mm')) {
				comp.override('diameter_mm', last.outDiameter_mm);
			}
			_lastConfig[key] = { ...comp._overrides };
			pipelineStore.insert(comp, pipelineStore.components.length);
			_closeExpand(gi, ii);
			_expandedKey = null;
		};

		requestAnimationFrame(() => {
			expandEl.querySelector('input, select')?.focus();
		});
	}

	function _closeExpand(gi, ii) {
		const expandEl = document.getElementById(`expand-${gi}-${ii}`);
		if (!expandEl) return;
		expandEl.style.maxHeight = '0';
		expandEl.classList.remove('open');

		catBody.querySelector(`.cat-chip[data-gi="${gi}"][data-ii="${ii}"]`)
			?.querySelector('.cat-chip-arrow')?.classList.remove('rotated');

		catBody.querySelector(`.cat-chip[data-gi="${gi}"][data-ii="${ii}"]`)?.focus();
	}

	// ── Keyboard Navigation ────────────────────────────────
	function navigateUp() {
		const flat = _flatItems();
		if (!flat.length) return;
		let idx = _focusedFlatIdx();
		idx = (idx - 1 + flat.length) % flat.length;
		_focusedGi = flat[idx].gi;
		_focusedIi = flat[idx].ii;
		_updateFocusHighlight();
		_scrollFocusedIntoView();
	}

	function navigateDown() {
		const flat = _flatItems();
		if (!flat.length) return;
		let idx = _focusedFlatIdx();
		idx = (idx + 1) % flat.length;
		_focusedGi = flat[idx].gi;
		_focusedIi = flat[idx].ii;
		_updateFocusHighlight();
		_scrollFocusedIntoView();
	}

	function addDirect() {
		const template = _getFocusedTemplate();
		if (!template) return;
		const comp  = makeComp(template);
		const key   = `${template.type}:${template.subtype}`;
		const saved = _lastConfig[key];
		if (saved) Object.entries(saved).forEach(([k, v]) => comp.override(k, v, true));
		pipelineStore.insert(comp, pipelineStore.components.length);
		showToast(`✓ ${template.desc ?? template.subtype} added`);
	}

	function toggleExpandFocused() {
		_toggleExpand(_focusedGi, _focusedIi);
	}

	function closeExpanded() {
		if (!_expandedKey) return false;
		const [gi, ii] = _expandedKey.split(':').map(Number);
		_closeExpand(gi, ii);
		_expandedKey = null;
		return true;
	}

	function getExpandedKey() { return _expandedKey; }

	// ── Public API ─────────────────────────────────────────
	// CA5: _getTemplate and _focusedGi/Ii removed from public API
	return {
		render,
		makeComp,
		navigateUp,
		navigateDown,
		addDirect,
		toggleExpandFocused,
		closeExpanded,
		getExpandedKey,
		getTemplate: _getTemplate,                              // For keyboard-controller
		get focusedGi() { return _focusedGi; },
		get focusedIi() { return _focusedIi; },
	};
}