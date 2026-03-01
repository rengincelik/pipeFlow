'use strict';

import { ComponentBase, registerComponentType } from './base.js';

import { Units } from '../data/unit-system.js';
import { TRANSITION_PAIRS, EXPANDER_PAIRS } from '../data/catalogs.js';

const FIT_W = 30;
const HALF  = 9;
const TAPER = 4;

export class TransitionComponent extends ComponentBase {
  constructor(subtype = 'reducer') {
    super('pipe', subtype);
    this.isReducer = subtype === 'reducer';
    this.name      = this.isReducer ? 'Reducer' : 'Expander';
    this.entryDir  = 'right';
    this.exitDir   = 'right';
    this._lenPx    = FIT_W;
    this._overrides.d_in_mm  = this.isReducer ? 53.1 : 26.9;
    this._overrides.d_out_mm = this.isReducer ? 26.9 : 53.1;
  }
  getParams() {
    return {
      type:       'transition',
      subtype:    this.subtype,              // 'reducer' | 'expander'
      D_in_mm:    this.resolve('d_in_mm'),
      D_out_mm:   this.resolve('d_out_mm'),
      length_m:   this._overrides.length_m ?? 0.3,
    };
  }
  get d_in_mm()        { return this._overrides.d_in_mm  ?? this.resolve('diameter_mm'); }
  get d_out_mm()       { return this._overrides.d_out_mm ?? this.resolve('diameter_mm'); }
  get outDiameter_mm() { return this.d_out_mm; }



  // wIn/wOut: reducer → giriş geniş, çıkış dar. Expander → tersi.
  shapeSpec(layout) {
    const { ix, iy } = layout;
    const len  = FIT_W; // Genellikle dirsek/transition için sabit genişlik
    const mx   = ix + len / 2;

    // Genişlik hesapları (Sadece yatay düzleme göre)
    const wIn  = this.isReducer ? HALF : HALF - TAPER;
    const wOut = this.isReducer ? HALF - TAPER : HALF;
    const cls  = `pipe-body ${this.isReducer ? 'pipe-reducer' : 'pipe-expander'}`;

    return {
      itemShape: [
        {
          tag: 'polygon',
          cls: cls,
          // Yatayda ix'den (giriş) ix+len'e (çıkış) giden yamuk (trapezoid)
          points: `${ix},${iy-wIn} ${ix+len},${iy-wOut} ${ix+len},${iy+wOut} ${ix},${iy+wIn}`
        }
      ],
      anchors: [
        { type: 'label', x: mx, y: iy }
      ],
      orientation: this.entryDir // Base sınıf bunu rotate(90, ix, iy) vb. yapacak
    };
  }






renderPropsHTML() {
  const allPairs = this.isReducer ? TRANSITION_PAIRS : EXPANDER_PAIRS;
  const pairs    = allPairs.filter(p => p.d_in === this.d_in_mm);
  const hasMatch = pairs.some(p => p.d_out === this.d_out_mm);

  if (!hasMatch && pairs.length > 0) {
    this._overrides.d_out_mm = pairs[0].d_out;
  }

  const curVal = `${this.d_in_mm}|${this.d_out_mm}`;
  const lenVal = this._overrides.length_m ?? 0.3;

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
      this.input('length_m', lenVal ) +
      this.hint(lenVal, v => Units.length(v)), 'm'),
  ].join('');
}

  serialize() {
    return { ...super.serialize(), length_m: this._overrides.length_m ,
             d_in_mm: this.d_in_mm, d_out_mm: this.d_out_mm };
  }
}

registerComponentType('pipe', 'reducer',  () => new TransitionComponent('reducer'));
registerComponentType('pipe', 'expander', () => new TransitionComponent('expander'));
