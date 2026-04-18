'use strict';

import { ComponentBase, registerComponentType, DIR_VEC } from './base.js';
import { Units } from '../data/unit-system.js';

const ARM = 27;

export const ELBOW_CATALOG = {
	'std_90':   { name: 'Standard 90°', leq_d: 30 },
	'long_90':  { name: 'Long Radius 90°', leq_d: 20 },
	'std_45':   { name: 'Standard 45°', leq_d: 16 },
	'long_45':  { name: 'Long Radius 45°', leq_d: 13 },
	'u_bend':   { name: '180° Close Return Bend', leq_d: 50 },
	'miter_90': { name: 'Miter Bend 90° (2-piece)', leq_d: 60 }
};

/**
 * Crane Technical Paper 410: K = f_t * (L/D)_eq
 */

function calculateK(type, diameter_mm, eps_mm) {
	const config = ELBOW_CATALOG[type] ?? ELBOW_CATALOG['std_90'];
	const D = diameter_mm / 1000;
	const eps = eps_mm / 1000;

	if (!D || D <= 0) return 0;

	// f_t: Tam türbülanslı sürtünme faktörü (Karman denklemi/Nikuradse yaklaşımı)
	// Not: log10(eps/3.7D) kısmı pürüzsüz borularda sorun çıkarabilir,
	// çok küçük eps değerleri için ufak bir koruma eklenebilir.

	const f_t = 0.25 / Math.pow(Math.log10(D / (3.7 * eps)), 2);
	return f_t * config.leq_d;
}
export class ElbowComponent extends ComponentBase {

	static get CONSTRAINTS() {
		return {
			elbow_type: {
				type: 'select',
				options: Object.keys(ELBOW_CATALOG).map(key => ({
					value: key,
					label: ELBOW_CATALOG[key].name
				})),
				default: 'std_90'
			},
			eps_mm: { type: 'number', default: 0.045 }
		};
	}

	constructor(subtype = 'rd') {
		super('elbow', subtype);
		// Constructor anında elbow_type henüz resolve edilemez (overrides boş olabilir)
		// O yüzden isimlendirmeyi statik bırakıp render anında resolve etmek daha güvenli.
		this.name   = 'Elbow';
		this._lenPx = ARM;

		const dirs = {
			rd: ['right', 'down'],
			ru: ['right', 'up'   ],
			ur: ['up',    'right'],
			dr: ['down',  'right'],
		};
		[this.entryDir, this.exitDir] = dirs[subtype] ?? ['right', 'down'];
	}

	getParams() {
		return {
			type: 'elbow',
			subtype: this.subtype,
			elbow_type: this.resolve('elbow_type') || 'std_90',
			diameter_mm: this.resolve('diameter_mm'),
			eps_mm: this.resolve('eps_mm') || 0.045,
			K: this.K,
		};
	}

	get K() {
		const type = this.resolve('elbow_type') || 'std_90';
		const dVal = this.resolve('diameter_mm');
		const eps  = this.resolve('eps_mm') || 0.045;

		return calculateK(type, dVal, eps);
	}

	computeExit(ix, iy) {
		const eVec    = DIR_VEC[this.entryDir];
		const xVec    = DIR_VEC[this.exitDir];
		const cornerX = ix + eVec.dx * ARM;
		const cornerY = iy + eVec.dy * ARM;
		return {
			ox:      cornerX + xVec.dx * ARM,
			oy:      cornerY + xVec.dy * ARM,
			exitDir: this.exitDir,
			cornerX,
			cornerY,
		};
	}

	shapeSpec(layout) {
		const { ix, iy, ox, oy, cornerX, cornerY } = layout;
		if (ix === undefined) return { itemShape: [], anchors: [] };

		const cx = cornerX ?? (ix === ox ? ix : ox);
		const cy = cornerY ?? (iy === oy ? iy : oy);

		return {
			itemShape: [
				{
					tag: 'path',
					cls: 'elbow-path',
					d: `M ${ix} ${iy} Q ${cx} ${cy} ${ox} ${oy}`,
					fill: 'none',
					stroke: 'var(--c-elbow)',
					'stroke-width': '3',
				},
			],
			anchors: [{ type: 'label', x: ix, y: iy }],
			orientation: 'static',
		};
	}

	renderPropsHTML() {
		const dVal = this.resolve('diameter_mm');
		const currentType = this.resolve('elbow_type') || 'std_90';
		const typeName = ELBOW_CATALOG[currentType]?.name || 'Unknown';

		return [
			this.row('Type', this.select('elbow_type', this.constructor.CONSTRAINTS.elbow_type.options, currentType)),

			this.row('Diameter',
				this.value(dVal) +
				this.hint(dVal, v => Units.diameter(v)), 'mm'),

			this.row('K Factor',
				this.value(this.K > 0 ? this.K.toFixed(3) : '---'),
				'<small>Dynamic (Crane)</small>')
		].join('');
	}
}

['rd', 'ru', 'ur', 'dr'].forEach(s =>
	registerComponentType('elbow', s, () => new ElbowComponent(s))
);