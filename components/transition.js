'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { Units } from '../data/unit-system.js';
import { TRANSITION_PAIRS, EXPANDER_PAIRS, DN_LIST } from '../data/catalogs.js';

const FIT_W = 30;
const HALF  = 9;
const TAPER = 4;

// Katalog'daki DN50 ve DN25 (ilk iki DN çifti)
const DEFAULT_D_IN_REDUCER  = 53.1;
const DEFAULT_D_OUT_REDUCER = 26.9;

export class TransitionComponent extends ComponentBase {

  static get CONSTRAINTS() {
    return {
      length_m: { min: 0.05, max: 2, step: 0.05, unit: 'm' },
    };
  }

  constructor(subtype = 'reducer') {
    super('pipe', subtype);
    this.isReducer = subtype === 'reducer';
    this.name      = this.isReducer ? 'Reducer' : 'Expander';
    this.entryDir  = 'right';
    this.exitDir   = 'right';
    this._lenPx    = FIT_W;

    // Başlangıç çapları — propagasyon set etmeden önce fallback.
    // override() kullanılır (direkt _overrides yazma değil).
    if (this.isReducer) {
      this.override('d_in_mm',  DEFAULT_D_IN_REDUCER);
      this.override('d_out_mm', DEFAULT_D_OUT_REDUCER);
    } else {
      this.override('d_in_mm',  DEFAULT_D_OUT_REDUCER);
      this.override('d_out_mm', DEFAULT_D_IN_REDUCER);
    }
    // length_m default SystemConfig'ten gelir (transition_length_m: 0.3)
    // Buraya hardcode etmiyoruz.
  }

  getParams() {
    return {
      type:     'transition',
      subtype:  this.subtype,
      D_in_mm:  this.d_in_mm,
      D_out_mm: this.d_out_mm,
    };
  }

  get d_in_mm()        { return this._overrides.d_in_mm  ?? this.resolve('diameter_mm'); }
  get d_out_mm()       { return this._overrides.d_out_mm ?? this.resolve('diameter_mm'); }
  get outDiameter_mm() { return this.d_out_mm; }

  shapeSpec(layout) {
    const { ix, iy } = layout;
    const mx   = ix + FIT_W / 2;
    const wIn  = this.isReducer ? HALF : HALF - TAPER;
    const wOut = this.isReducer ? HALF - TAPER : HALF;
    const cls  = `pipe-body ${this.isReducer ? 'pipe-reducer' : 'pipe-expander'}`;

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
    const lenVal = this.resolve('length_m');

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
        this.input('length_m', lenVal) +
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

registerComponentType('pipe', 'reducer',  () => new TransitionComponent('reducer'));
registerComponentType('pipe', 'expander', () => new TransitionComponent('expander'));
