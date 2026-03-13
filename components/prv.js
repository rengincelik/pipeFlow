'use strict';

// ═══════════════════════════════════════════════════════════
// PRV — Pressure Reducing Valve
// ═══════════════════════════════════════════════════════════

import { ComponentBase, registerComponentType } from './base.js';
import { Units }                                from '../data/unit-system.js';

// -- Boyut sabitleri --
const BODY_W   = 54;
const STEM_UP  = 18;
const STEM_DN  = 12;
const R        = 6;
const PORT_W   = 10;
const PORT_GAP = 4;


export class PRVComponent extends ComponentBase {

	static get CONSTRAINTS() {
		return {
			P_set_bar: { min: 0.1, max: 100, step: 0.1, unit: 'bar' },
		};
	}

	constructor() {
		super('valve', 'prv');
		this.name   = 'PRV';
		this._lenPx = BODY_W;
	}

	// C9: Tek kaynak — resolve() üzerinden al, double override tekrarı yok
	get P_set_bar() {
		return this.resolve('P_set_bar') ?? 1.0;
	}

	getParams() {
		return {
			type:        'valve',
			subtype:     'prv',
			diameter_mm: this.resolve('diameter_mm'),
			P_set_Pa:    this.P_set_bar * 1e5,
		};
	}

	// ── SVG ──────────────────────────────────────────────────

	shapeSpec(layout) {
		const { ix, iy } = layout;
		const mx = ix + BODY_W / 2;
		const my = iy;

		const circY    = my - STEM_UP;
		const portTopY = my + STEM_DN;

		return {
			itemShape: [
				{ tag: 'line',   cls: 'prv-stem',
					x1: ix, y1: my, x2: ix + BODY_W, y2: my },

				{ tag: 'line',   cls: 'prv-stem',
					x1: mx, y1: my, x2: mx, y2: circY + R },

				{ tag: 'circle', cls: 'prv-status-circle',
					cx: mx, cy: circY, r: R,
					'data-prv-circle': this.id },

				{ tag: 'line',   cls: 'prv-stem',
					x1: mx, y1: my, x2: mx, y2: portTopY },

				{ tag: 'line',   cls: 'prv-port-line',
					x1: mx - PORT_W, y1: portTopY,
					x2: mx + PORT_W, y2: portTopY },

				{ tag: 'line',   cls: 'prv-port-line',
					x1: mx - PORT_W, y1: portTopY + PORT_GAP,
					x2: mx + PORT_W, y2: portTopY + PORT_GAP },

				{ tag: 'line',   cls: 'prv-port-line',
					x1: mx - PORT_W, y1: portTopY + PORT_GAP * 2,
					x2: mx + PORT_W, y2: portTopY + PORT_GAP * 2 },
			],
			anchors:     [{ type: 'label', x: mx, y: my }],
			orientation: this.entryDir,
		};
	}

	// ── Props Panel ──────────────────────────────────────────

	renderPropsHTML() {
		const dVal    = this.diameter_mm;
		const psetVal = this.P_set_bar;

		return [
			this.row('Diameter',
				this.value(dVal) +
				this.hint(dVal, v => Units.diameter(v)), 'mm'),

			this.row('Set Pressure',
				this.input('P_set_bar', psetVal) +
				this.hint(psetVal, () => `${(psetVal * 14.504).toFixed(1)} psi`), 'bar'),

			this.row('Status',
				`<span class="prop-value" data-live="prv_status">—</span>`),

			this.row('Inlet P',
				`<span class="prop-value" data-live="prv_p_in">—</span>`),
		].join('');
	}

	// ── Serialize ────────────────────────────────────────────

	serialize() {
		return { ...super.serialize(), P_set_bar: this.P_set_bar };
	}

	applySerializedData(d) {
		super.applySerializedData(d);
		if (d.P_set_bar != null) this.override('P_set_bar', d.P_set_bar, true);
		return this;
	}
}


registerComponentType('valve', 'prv', () => new PRVComponent());