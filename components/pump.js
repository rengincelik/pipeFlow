'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { fitHQCurve }                           from '../Simulation/simulation-engine.js';
import { Units }                                from '../data/unit-system.js';
import { validateParams } from '../components/validation.js';

export class PumpComponent extends ComponentBase {

	// <editor-fold desc="CONSTRAINTS">
	static get CONSTRAINTS() {
		return {
			H_shutoff_m: { min: 1,    max: 600,  step: 1,    unit: 'm'   },
			head_m:      { min: 1,    max: 500,  step: 1,    unit: 'm'   },
			Q_nom_lps:   { min: 0.1,  max: 500,  step: 0.1,  unit: 'L/s' },
			Q_max_lps:   { min: 0.1,  max: 500,  step: 0.1,  unit: 'L/s' },
			// Ham değer: 0.0–1.0 (store'da böyle tutulur)
			// renderPropsHTML içinde *100 ile gösterilir, slider 0–100 görünür
			efficiency:  { min: 0.1,  max: 1.0,  step: 0.01, unit: '%'   },
		};
	}
	// </editor-fold>

	// <editor-fold desc="constructor">
	constructor() {
		super('pump', 'centrifugal');
		this.name   = 'Centrifugal';
		this._lenPx = 64;
		this._hq_coeffs = null;
		this._hq_dirty  = true;
	}
	// </editor-fold>

	// <editor-fold desc="hq_coeffs">
	_onOverrideChange(key) {
		super._onOverrideChange?.(key);
		if (['H_shutoff_m', 'head_m', 'Q_nom_lps', 'Q_max_lps'].includes(key)) {
			this._hq_dirty = true;
		}
	}

	get hq_coeffs() {
		if (!this._hq_dirty && this._hq_coeffs) return this._hq_coeffs;

		const H_shutoff = this.resolve('H_shutoff_m');
		const Q_nom     = this.resolve('Q_nom_lps') / 1000;
		const H_nom     = this.resolve('head_m');
		const Q_max     = this.resolve('Q_max_lps') / 1000;

		this._hq_coeffs = fitHQCurve(H_shutoff, Q_nom, H_nom, Q_max);
		this._hq_dirty  = false;
		return this._hq_coeffs;
	}
	// </editor-fold>

	// <editor-fold desc="getParams">
	getParams() {
		return {
			type:        'pump',
			subtype:     this.subtype,
			hq_coeffs:   this.hq_coeffs,
			efficiency:  this.resolve('efficiency'),   // 0.0–1.0, engine SI'da çalışır
			diameter_mm: this.resolve('diameter_mm'),
		};
	}
	// </editor-fold>

	// <editor-fold desc="shapeSpec">
	shapeSpec(layout) {
		const { ix, iy } = layout;
		const len = this._lenPx;
		const mx  = ix + len / 2;
		const R   = 12;

		return {
			itemShape: [
				{ tag: 'line',   cls: 'pump-stem',   x1: ix,     y1: iy, x2: mx - R,   y2: iy },
				{ tag: 'line',   cls: 'pump-stem',   x1: mx + R, y1: iy, x2: ix + len, y2: iy },
				{ tag: 'circle', cls: 'pump-circle', cx: mx, cy: iy, r: R },
			],
			anchors:     [{ type: 'label', x: mx, y: iy }],
			orientation: this.entryDir,
		};
	}
	// </editor-fold>

	// <editor-fold desc="renderPropsHTML">
	renderPropsHTML() {
		const H_shutoff = this.resolve('H_shutoff_m');
		const H_nom     = this.resolve('head_m');
		const Q_nom_lps = this.resolve('Q_nom_lps');
		const Q_max_lps = this.resolve('Q_max_lps');
		// Store: 0.0–1.0 → gösterim: 0–100 (tamsayı)
		const etaPct    = Math.round(this.resolve('efficiency') * 100);

		return [
			`<div class="prop-section-label">H-Q Curve</div>`,

			this.row('Shutoff Head',
				this.input('H_shutoff_m', H_shutoff) +
				this.hint(H_shutoff, v => Units.length(v)), 'm'),

			this.row('Nominal Head',
				this.input('head_m', H_nom) +
				this.hint(H_nom, v => Units.length(v)), 'm'),

			this.row('Nominal Flow',
				this.input('Q_nom_lps', Q_nom_lps), 'L/s'),
//TODO: burada birim değişmiyor. incelenebilir.

			this.row('Max Flow',
				this.input('Q_max_lps', Q_max_lps), 'L/s'),

			// Slider: görüntüde 0–100, data-prop="efficiency", oninput'ta /100 yapılır (main.js)
			// base.js'teki slider() CONSTRAINTS'ten min/max okur — ham değer min:0.1 max:1
			// Bu yüzden slider'a explicit min/max/step veriyoruz: 10–100, step 1
			this.row('Efficiency',
				`<div class="prop-slider-group">
          <input type="range" data-prop="efficiency"
            min="10" max="100" step="1"
            value="${etaPct}">
          <span class="prop-slider-val">${etaPct}%</span>
        </div>`),

			// Status: data-live ile tick'te güncellenir (P3 fix scope dışı, şimdilik statik)
			this.row('Status',
				`<span class="p-status-tag idle">IDLE</span>`),

			this.row('Shaft Power',
				`<span class="prop-value" data-live="P_shaft">—</span>`, 'W'),
		].join('');
	}
	// </editor-fold>

	// <editor-fold desc="serialize">
	serialize() {
		return { ...super.serialize() };
	}
	// </editor-fold>
}

registerComponentType('pump', 'centrifugal', () => new PumpComponent());