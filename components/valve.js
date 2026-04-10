'use strict';
import { ComponentBase, registerComponentType } from './base.js';
import { Units } from '../data/unit-system.js';

const ARM = 10;
const S   = 10;
const T   = 8;

function closedX(cx, cy) {
	return [
		{ tag: 'line', cls: 'valve-closed-x', x1: cx - 7, y1: cy - 7, x2: cx + 7, y2: cy + 7 },
		{ tag: 'line', cls: 'valve-closed-x', x1: cx + 7, y1: cy - 7, x2: cx - 7, y2: cy + 7 },
	];
}

// <editor-fold desc="K_TABLES">
/**
 * K vs opening_pct tabloları — literatür verileri (Crane TP-410, ISA-75.01).
 * Her tablo tam açık (100) → tam kapalı (0) aralığını kapsar.
 * Engine'deki valveK() fonksiyonu bu tabloyu interpolate eder.
 *
 * gate:      Kiiski/Crane data — gate fully open K≈0.2, quarter-open K dramatik artar
 * ball:      Ball valve — 0°–90° rotasyon, çok non-lineer
 * butterfly: Rotary disc — 60°'da tam açık sayılır, 0°'da çok yüksek K
 * globe:     Yüksek K, daha lineer karakteristik
 * check:     Sabit K (yönlü, opening bağımsız) — slider gösterilmez
 */
export const VALVE_K_TABLES = {
	gate: [
		{ opening: 100, K: 0.20  },
		{ opening:  90, K: 0.30  },
		{ opening:  80, K: 0.50  },
		{ opening:  70, K: 0.90  },
		{ opening:  60, K: 1.80  },
		{ opening:  50, K: 4.00  },
		{ opening:  40, K: 10.0  },
		{ opening:  30, K: 35.0  },
		{ opening:  20, K: 160.0 },
		{ opening:  10, K: 900.0 },
		{ opening:   0, K: 1e9   },
	],
	ball: [
		{ opening: 100, K: 0.10  },
		{ opening:  90, K: 0.15  },
		{ opening:  80, K: 0.25  },
		{ opening:  70, K: 0.50  },
		{ opening:  60, K: 1.20  },
		{ opening:  50, K: 3.50  },
		{ opening:  40, K: 11.0  },
		{ opening:  30, K: 45.0  },
		{ opening:  20, K: 200.0 },
		{ opening:  10, K: 1200.0},
		{ opening:   0, K: 1e9   },
	],
	butterfly: [
		{ opening: 100, K: 0.80  },
		{ opening:  90, K: 1.00  },
		{ opening:  80, K: 1.50  },
		{ opening:  70, K: 2.80  },
		{ opening:  60, K: 5.50  },
		{ opening:  50, K: 13.0  },
		{ opening:  40, K: 35.0  },
		{ opening:  30, K: 110.0 },
		{ opening:  20, K: 500.0 },
		{ opening:  10, K: 3000.0},
		{ opening:   0, K: 1e9   },
	],
	globe: [
		{ opening: 100, K: 6.00  },
		{ opening:  90, K: 7.00  },
		{ opening:  80, K: 9.00  },
		{ opening:  70, K: 13.0  },
		{ opening:  60, K: 22.0  },
		{ opening:  50, K: 42.0  },
		{ opening:  40, K: 90.0  },
		{ opening:  30, K: 250.0 },
		{ opening:  20, K: 900.0 },
		{ opening:  10, K: 4000.0},
		{ opening:   0, K: 1e9   },
	],
	check: [
		// Check valve: tek yönlü, opening bağımsız sabit K
		{ opening: 100, K: 2.50 },
		{ opening:   0, K: 1e9  },
	],
};
// </editor-fold>

// <editor-fold desc="VALVE_DEFS">
export const VALVE_DEFS = {
	gate:      { name: 'Gate Valve'  },
	ball:      { name: 'Ball Valve'  },
	butterfly: { name: 'Butterfly'   },
	globe:     { name: 'Globe Valve' },
	check:     { name: 'Check Valve' },
};
// </editor-fold>

// <editor-fold desc="interpolateK helper">
/**
 * K_table'dan opening_pct için K değerini interpolate eder.
 * Tablo sırasız olabilir — sort dahili yapılır.
 */
function interpolateK(table, opening_pct) {
	if (opening_pct <= 0) return 1e9;
	const sorted = [...table].sort((a, b) => a.opening - b.opening);
	if (opening_pct <= sorted[0].opening)                   return sorted[0].K;
	if (opening_pct >= sorted[sorted.length - 1].opening)   return sorted[sorted.length - 1].K;
	for (let i = 0; i < sorted.length - 1; i++) {
		const lo = sorted[i];
		const hi = sorted[i + 1];
		if (opening_pct >= lo.opening && opening_pct <= hi.opening) {
			const t = (opening_pct - lo.opening) / (hi.opening - lo.opening);
			return lo.K + t * (hi.K - lo.K);
		}
	}
	return sorted[sorted.length - 1].K;
}
// </editor-fold>

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

	/**
	 * Anlık K değeri — opening_pct'e göre K_table'dan interpolate edilir.
	 * Prop panel'de readonly gösterim için kullanılır.
	 */
	get K() {
		const table = VALVE_K_TABLES[this.subtype];
		if (!table) return 1.0;
		return interpolateK(table, this.opening_pct);
	}
	// </editor-fold>

	// <editor-fold desc="getParams">
	getParams() {
		return {
			type:        'valve',
			subtype:     this.subtype,
			diameter_mm: this.resolve('diameter_mm'),
			opening:     this.opening_pct / 100,    // 0.0–1.0 → engine bu formatı bekler
			K_table:     VALVE_K_TABLES[this.subtype] ?? null,
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

		const pct      = this.opening_pct;
		const kVal     = this.K;
		const dVal     = this.resolve('diameter_mm');
		const isCheck  = this.subtype === 'check';

		// K değeri için görüntüleme formatı
		const kDisplay = kVal >= 1e6
			? '∞ (closed)'
			: kVal >= 1000
				? kVal.toFixed(0)
				: kVal >= 10
					? kVal.toFixed(1)
					: kVal.toFixed(3);

		return [
			this.row('Type',
				this.select('subtype', vTypes, this.subtype)),

			this.row('Diameter',
				this.value(dVal) +
				this.hint(dVal, v => Units.diameter(v)), 'mm'),

			// K değeri: opening_pct'e göre dinamik, readonly
			this.row('K value',
				`<span class="prop-value">${kDisplay}</span>` +
				`<span class="prop-hint">@ ${pct}% open</span>`),

			// Check valve'da opening slider anlamsız — gösterme
			...(isCheck ? [] : [
				this.row('Opening',
					this.slider('opening_pct', pct)),
			]),

			this.row('State',
				`<span class="valve-status-tag ${pct > 0 ? 'on' : 'off'}">
				${pct > 0 ? 'OPEN' : 'CLOSED'}</span>`),
		].join('');
	}
	// </editor-fold>

	// <editor-fold desc="serialize / applySerializedData">
	serialize() {
		// K artık computed property — serialize etmeye gerek yok
		return { ...super.serialize() };
	}

	applySerializedData(d) {
		super.applySerializedData(d);
		// Eski JSON'larda K alanı olabilir — ignore et, K_table'dan hesaplanır
		return this;
	}
	// </editor-fold>
}

['gate', 'ball', 'butterfly', 'globe', 'check'].forEach(s =>
	registerComponentType('valve', s, () => new ValveComponent(s))
);