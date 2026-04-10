'use strict';
import { SystemConfig } from '../state/system-config.js';
import { ComponentBase, registerComponentType } from './base.js';
import { Units } from '../data/unit-system.js';
import { TRANSITION_PAIRS, EXPANDER_PAIRS } from '../data/catalogs.js';

const FIT_W = 20;
const HALF  = 9;
const TAPER = 4;

const DEFAULT_D_IN_REDUCER  = 53.1;
const DEFAULT_D_OUT_REDUCER = 26.9;
const DEFAULT_CONE_ANGLE    = 10;   // degrees — ASME B16.5 typical


export class TransitionComponent extends ComponentBase {

	// <editor-fold desc="CONSTRAINTS">
	static get CONSTRAINTS() {
		return {
			cone_angle_deg: { min: 3, max: 60, step: 1, unit: '°' },
		};
	}
	// </editor-fold>

	// <editor-fold desc="constructor">
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
		// Cone angle: sistem default'u, kullanıcı override edebilir
		this.override('cone_angle_deg', DEFAULT_CONE_ANGLE, false);
	}
	// </editor-fold>

	// <editor-fold desc="override hook">
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
	// </editor-fold>

	// <editor-fold desc="getters">
	get d_in_mm()        { return this._overrides.d_in_mm; }
	get d_out_mm()       { return this._overrides.d_out_mm; }
	get outDiameter_mm() { return this.d_out_mm; }

	get cone_angle_deg() {
		return this.resolve('cone_angle_deg')
			?? SystemConfig.get('cone_angle_deg')
			?? DEFAULT_CONE_ANGLE;
	}

	get length_m() {
		const dIn  = this.d_in_mm  / 1000;
		const dOut = this.d_out_mm / 1000;
		if (dIn === dOut) return 0;
		const theta = this.cone_angle_deg * Math.PI / 180;
		return Math.abs(dIn - dOut) / (2 * Math.tan(theta / 2));
	}
	// </editor-fold>

	// <editor-fold desc="getParams">
	getParams() {
		return {
			type:           'transition',
			subtype:        this.subtype,
			d_in_mm:        this.d_in_mm,
			d_out_mm:       this.d_out_mm,
			cone_angle_deg: this.cone_angle_deg,
		};
	}
	// </editor-fold>

	// <editor-fold desc="shapeSpec">
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
	// </editor-fold>

	// <editor-fold desc="renderPropsHTML">
	renderPropsHTML() {
		const allPairs = this.isReducer ? TRANSITION_PAIRS : EXPANDER_PAIRS;
		const pairs    = allPairs.filter(p => p.d_in === this.d_in_mm);

		const curVal = `${this.d_in_mm}|${this.d_out_mm}`;
		const opts   = pairs.map(p =>
			`<option value="${p.d_in}|${p.d_out}" ${`${p.d_in}|${p.d_out}` === curVal ? 'selected' : ''}>
				${p.label}
			</option>`
		).join('');

		const angle  = this.cone_angle_deg;
		const len    = this.length_m;

		return [
			this.row('Fitting',
				`<select class="prop-selection" data-prop="transition_pair">${opts}</select>`),

			this.row('D in',
				this.dimValue(`${this.d_in_mm} mm`) +
				this.hint(this.d_in_mm, v => Units.diameter(v))),

			this.row('D out',
				this.dimValue(`${this.d_out_mm} mm`) +
				this.hint(this.d_out_mm, v => Units.diameter(v))),

			// Cone angle: kullanıcı bu değeri doğrudan edit eder → length otomatik değişir
			this.row('Cone Angle',
				this.input('cone_angle_deg', angle) +
				this.slider('cone_angle_deg', angle), '°'),

			// Length: türetilmiş, readonly (cone angle + diameters'dan hesaplanır)
			this.row('Length',
				this.dimValue(`${len.toFixed(3)} m`) +
				this.hint(len, v => Units.length(v)), 'm'),
		].join('');
	}
	// </editor-fold>

	// <editor-fold desc="serialize">
	serialize() {
		return {
			...super.serialize(),
			d_in_mm:        this.d_in_mm,
			d_out_mm:       this.d_out_mm,
			cone_angle_deg: this.cone_angle_deg,
		};
	}
	// </editor-fold>
}

registerComponentType('transition', 'reducer',  () => new TransitionComponent('reducer'));
registerComponentType('transition', 'expander', () => new TransitionComponent('expander'));