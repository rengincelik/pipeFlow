'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { Units } from '../data/unit-system.js';
import { TRANSITION_PAIRS, EXPANDER_PAIRS } from '../data/catalogs.js';

const FIT_W = 20;
const HALF  = 9;
const TAPER = 4;

const DEFAULT_D_IN_REDUCER  = 53.1;
const DEFAULT_D_OUT_REDUCER = 26.9;

const CONE_HALF_ANGLE_DEG = 10;

export class TransitionComponent extends ComponentBase {

	constructor(subtype = 'reducer') {
		super('transition', subtype);
		this.isReducer = subtype === 'reducer';
		this.name      = this.isReducer ? 'Reducer' : 'Expander';
		this._lenPx    = FIT_W;

		if (this.isReducer) {
			this.override('d_in_mm',  DEFAULT_D_IN_REDUCER);
			this.override('d_out_mm', DEFAULT_D_OUT_REDUCER);
		} else {
			this.override('d_in_mm',  DEFAULT_D_OUT_REDUCER);
			this.override('d_out_mm', DEFAULT_D_IN_REDUCER);
		}
	}

	override(key, val, isUser) {
		const result = ComponentBase.prototype.override.call(this, key, val, isUser);

		// d_in değişince d_out'u catalog'dan otomatik güncelle
		// Sadece sistem set ediyorsa (isUser=false) — kullanıcı override varsa dokunma
		if (key === 'd_in_mm' && !isUser) {
			const allPairs = this.isReducer ? TRANSITION_PAIRS : EXPANDER_PAIRS;
			const pairs    = allPairs.filter(p => p.d_in === val);
			const hasMatch = pairs.some(p => p.d_out === this.d_out_mm);

			if (!hasMatch && pairs.length > 0) {
				ComponentBase.prototype.override.call(this, 'd_out_mm', pairs[0].d_out, false);
			}
		}

		return result;
	}

	get d_in_mm()        { return this._overrides.d_in_mm; }
	get d_out_mm()       { return this._overrides.d_out_mm; }
	get outDiameter_mm() { return this.d_out_mm; }

	get length_m() {
		const dIn  = this.d_in_mm  / 1000;
		const dOut = this.d_out_mm / 1000;
		if (dIn === dOut) return 0;
		const theta = CONE_HALF_ANGLE_DEG * Math.PI / 180;
		return Math.abs(dIn - dOut) / (2 * Math.tan(theta));
	}

	getParams() {
		return {
			type:     'transition',
			subtype:  this.subtype,
			d_in_mm:  this.d_in_mm,
			d_out_mm: this.d_out_mm,
		};
	}

	shapeSpec(layout) {
		const { ix, iy } = layout;
		const mx   = ix + FIT_W / 2;
		const wIn  = this.isReducer ? HALF : HALF - TAPER;
		const wOut = this.isReducer ? HALF - TAPER : HALF;
		const cls  = `transition-body ${this.isReducer ? 'pipe-reducer' : 'pipe-expander'}`;

		return {
			itemShape: [
				{
					tag:    'polygon',
					cls:    cls,
					points: `${ix},${iy - wIn} ${ix + FIT_W},${iy - wOut} ${ix + FIT_W},${iy + wOut} ${ix},${iy + wIn}`,
				},
			],
			anchors:     [{ type: 'label', x: mx, y: iy }],
			orientation: this.entryDir,
		};
	}

	renderPropsHTML() {
		const allPairs = this.isReducer ? TRANSITION_PAIRS : EXPANDER_PAIRS;
		const pairs    = allPairs.filter(p => p.d_in === this.d_in_mm);

		// C7: override() çağrısı buradan KALDIRILDI.
		// Bu mantık zaten override() hook'unda çalışıyor —
		// d_in değiştiğinde otomatik d_out güncellenir.
		// renderPropsHTML render için okunur, state değiştirmez.

		const curVal = `${this.d_in_mm}|${this.d_out_mm}`;

		const opts = pairs.map(p =>
			`<option value="${p.d_in}|${p.d_out}" ${`${p.d_in}|${p.d_out}` === curVal ? 'selected' : ''}>
				${p.label}
			</option>`
		).join('');

		return [
			this.row('Fitting',
				`<select class="prop-selection" data-prop="transition_pair">${opts}</select>`),

			this.row('D in',
				this.dimValue(`${this.d_in_mm} mm`) +
				this.hint(this.d_in_mm, v => Units.diameter(v))),

			this.row('D out',
				this.dimValue(`${this.d_out_mm} mm`) +
				this.hint(this.d_out_mm, v => Units.diameter(v))),

			this.row('Length',
				this.dimValue(`${this.length_m.toFixed(3)} m`) +
				this.hint(this.length_m, v => Units.length(v)), 'm'),
		].join('');
	}

	serialize() {
		return {
			...super.serialize(),
			d_in_mm:  this.d_in_mm,
			d_out_mm: this.d_out_mm,
		};
	}
}

registerComponentType('transition', 'reducer',  () => new TransitionComponent('reducer'));
registerComponentType('transition', 'expander', () => new TransitionComponent('expander'));