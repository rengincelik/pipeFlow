'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { Units } from '../data/unit-system.js';
import { TRANSITION_PAIRS, EXPANDER_PAIRS, DN_LIST } from '../data/catalogs.js';

//bunlar piksel data
const FIT_W = 30;
const HALF  = 9;
const TAPER = 4;

// Katalog'daki DN50 ve DN25 (ilk iki DN çifti)
const DEFAULT_D_IN_REDUCER  = 53.1;
const DEFAULT_D_OUT_REDUCER = 26.9;

const CONE_HALF_ANGLE_DEG = 10;

export class TransitionComponent extends ComponentBase {
  constructor(subtype = 'reducer') {
    super('transition', subtype);
    this.isReducer = subtype === 'reducer';
    this.name      = this.isReducer ? 'Reducer' : 'Expander';

    // Başlangıç çapları — propagasyon set etmeden önce fallback.
    // override() kullanılır (direkt _overrides yazma değil).
    if (this.isReducer) {
      this.override('d_in_mm',  DEFAULT_D_IN_REDUCER);
      this.override('d_out_mm', DEFAULT_D_OUT_REDUCER);
    } else {
      this.override('d_in_mm',  DEFAULT_D_OUT_REDUCER);
      this.override('d_out_mm', DEFAULT_D_IN_REDUCER);
    }
  }

  getParams() {
    return {
      type:     'transition',
      subtype:  this.subtype,
      d_in_mm:  this.d_in_mm,
      d_out_mm: this.d_out_mm,
    };
  }

  get d_in_mm()        { return this._overrides.d_in_mm; }
  get d_out_mm()       { return this._overrides.d_out_mm; }
  get outDiameter_mm() { return this.d_out_mm; }
  get length_m() {
    const dIn  = this.d_in_mm  / 1000; // m
    const dOut = this.d_out_mm / 1000; // m

    if (dIn === dOut) return 0;

    const theta = CONE_HALF_ANGLE_DEG * Math.PI / 180;

    return Math.abs(dIn - dOut) / (2 * Math.tan(theta));
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
    const hasMatch = pairs.some(p => p.d_out === this.d_out_mm);

    if (!hasMatch && pairs.length > 0) {
      // Sistem set ediyor (isUserSet=false)
      this.override('d_out_mm', pairs[0].d_out, false);
    }

    const curVal = `${this.d_in_mm}|${this.d_out_mm}`;
    const lenVal = `${this.length_m}`;

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

      // input — min/max/step CONSTRAINTS'ten otomatik gelir
      this.row('Length',
        this.dimValue(`${this.length_m.toFixed(3)} m`) +
        this.hint(lenVal, v => Units.length(v)), 'm'),
    ].join('');
  }

  serialize() {
    return {
      ...super.serialize(),
      d_in_mm:  this.d_in_mm,
      d_out_mm: this.d_out_mm,
    };
    // length_m overrides üzerinden serialize edilir
  }
}

registerComponentType('transition', 'reducer',  () => new TransitionComponent('reducer'));
registerComponentType('transition', 'expander', () => new TransitionComponent('expander'));
