'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { Units } from '../data/unit-system.js';
import { validateParams } from './validation.js';

const ARM = 10;
const S   = 10;
const T   = 8;

function closedX(cx, cy) {
	return [
		{ tag: 'line', cls: 'valve-closed-x', x1: cx - 7, y1: cy - 7, x2: cx + 7, y2: cy + 7 },
		{ tag: 'line', cls: 'valve-closed-x', x1: cx + 7, y1: cy - 7, x2: cx - 7, y2: cy + 7 },
	];
}

const VALVE_DEFS = {
	gate:      { name: 'Gate Valve',  K: 0.20 },
	ball:      { name: 'Ball Valve',  K: 0.10 },
	butterfly: { name: 'Butterfly',   K: 0.80 },
	globe:     { name: 'Globe Valve', K: 6.00 },
	check:     { name: 'Check Valve', K: 2.50 },
};

export class ValveComponent extends ComponentBase {

	// <editor-fold desc="CONSTRAINTS">
	static get CONSTRAINTS() {
		return {
			opening_pct: { min: 0, max: 100, step: 1, unit: '%' },
		};
	}
	// </editor-fold>

	// <editor-fold desc="constructor">
	constructor(subtype = 'gate') {
		super('valve', subtype);
		const d   = VALVE_DEFS[subtype] ?? VALVE_DEFS.gate;
		this.name = d.name;
		this.K    = d.K;
		// NOT: this.open KALDIRILDI — tek kaynak opening_pct override'ı
		this._lenPx = 54;
	}
	// </editor-fold>

	// <editor-fold desc="getters">
	/** Tek kaynak: override varsa onu al, yoksa default 100 (tam açık) */
	get opening_pct() {
		return this.resolve('opening_pct') ?? 100;
	}

	/** Türetilmiş — opening_pct > 0 ise açık */
	get open() {
		return this.opening_pct > 0;
	}
	// </editor-fold>

	// <editor-fold desc="getParams">
	getParams() {
		return {
			type:        'valve',
			subtype:     this.subtype,
			diameter_mm: this.resolve('diameter_mm'),
			opening:     this.opening_pct / 100,   // 0.0–1.0 — engine bu formatı bekler
			K:           this.K,
		};
	}
	// </editor-fold>

	// <editor-fold desc="shapeSpec">
	shapeSpec(layout) {
		const { ix, iy } = layout;
		const len = this._lenPx;
		const mx  = ix + len / 2;
		const my  = iy;

		const stems = [
			{ tag: 'line', cls: 'valve-stem', x1: ix,       y1: iy, x2: mx - ARM, y2: my },
			{ tag: 'line', cls: 'valve-stem', x1: mx + ARM, y1: my, x2: ix + len, y2: iy },
		];
		const triangles = [
			{ tag: 'polygon', cls: 'valve-tri', points: `${mx - S},${my - T} ${mx + S},${my} ${mx - S},${my + T}` },
			{ tag: 'polygon', cls: 'valve-tri', points: `${mx + S},${my - T} ${mx - S},${my} ${mx + S},${my + T}` },
		];
		const closedMark = this.open ? [] : closedX(mx, my);

		return {
			itemShape:   [...stems, ...triangles, ...closedMark],
			anchors:     [{ type: 'label', x: mx, y: my }],
			orientation: this.entryDir,
		};
	}
	// </editor-fold>

	// <editor-fold desc="renderPropsHTML">
	renderPropsHTML() {
		const vTypes = [
			{ value: 'gate',      label: 'Gate Valve'  },
			{ value: 'ball',      label: 'Ball Valve'  },
			{ value: 'butterfly', label: 'Butterfly'   },
			{ value: 'globe',     label: 'Globe Valve' },
			{ value: 'check',     label: 'Check Valve' },
		];

		const pct  = this.opening_pct;   // getter üzerinden
		const dVal = this.resolve('diameter_mm');

		return [
			this.row('Type',
				this.select('subtype', vTypes, this.subtype)),

			this.row('Diameter',
				this.value(dVal) +
				this.hint(dVal, v => Units.diameter(v)), 'mm'),

			this.row('K value',
				this.value(this.K)),

			this.row('Opening',
				this.slider('opening_pct', pct)),

			this.row('State',
				`<span class="valve-status-tag ${pct > 0 ? 'on' : 'off'}">
          ${pct > 0 ? 'OPEN' : 'CLOSED'}</span>`),
		].join('');
	}
	// </editor-fold>

	// <editor-fold desc="serialize / applySerializedData">
	serialize() {
		// open instance property kaldırıldı — opening_pct zaten serializeOverrides içinde
		return { ...super.serialize(), K: this.K };
	}

	applySerializedData(d) {
		super.applySerializedData(d);
		if (d.K != null) this.K = d.K;
		// d.open restore kaldırıldı — opening_pct override'dan gelir
		return this;
	}
	// </editor-fold>
}

['gate', 'ball', 'butterfly', 'globe', 'check'].forEach(s =>
	registerComponentType('valve', s, () => new ValveComponent(s))
);