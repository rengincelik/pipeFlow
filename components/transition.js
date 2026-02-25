'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { calcSegment } from '../core/hydraulics.js';
import { svgEl, drawSpec } from '../renderer/svg-utils.js';
import { DN_LIST } from '../data/catalogs.js';

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

  get d_in_mm()        { return this._overrides.d_in_mm  ?? this.resolve('diameter_mm'); }
  get d_out_mm()       { return this._overrides.d_out_mm ?? this.resolve('diameter_mm'); }
  get outDiameter_mm() { return this.d_out_mm; }

  get dz_m() {
    const len = this._overrides.length_m ?? 0.3;
    if (this.entryDir === 'down') return  len;
    if (this.entryDir === 'up')   return -len;
    return 0;
  }

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
        { type: 'dim', x: mx, y: iy }
      ],
      orientation: this.entryDir // Base sınıf bunu rotate(90, ix, iy) vb. yapacak
    };
  }

  calcHydraulics(Q_m3s, fluid) {
    super.calcHydraulics(Q_m3s, fluid);

    const hm = hLoss_fitting(this.K, this.result.v);
    const dP_Pa = fluid.rho * 9.81 * hm;

    this.result.hf.fittings = hm;
    this.result.hf.total = hm;
    this.result.dP_Pa = dP_Pa;

    return this.result;
  }



  renderPropsHTML() {
    const dnOpts = DN_LIST.map(x => ({ value: x.d, label: `${x.dn} (${x.d}mm)` }));

    return [
      this.row('D inlet', this.select('d_in_mm', dnOpts, this.d_in_mm)),
      this.row('D outlet', this.select('d_out_mm', dnOpts, this.d_out_mm)),
      this.row('Length', this.input('length_m', this._overrides.length_m ?? 0.3, "0.05"), 'm')
    ].join('');
  }

  serialize() {
    return { ...super.serialize(), length_m: this._overrides.length_m ?? 0.3,
             d_in_mm: this.d_in_mm, d_out_mm: this.d_out_mm };
  }
}

registerComponentType('pipe', 'reducer',  () => new TransitionComponent('reducer'));
registerComponentType('pipe', 'expander', () => new TransitionComponent('expander'));
