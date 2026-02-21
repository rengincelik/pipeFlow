'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { calcSegment } from '../core/hydraulics.js';
import { svgEl } from '../renderer/svg-utils.js';
import { drawSpec } from '../renderer/draw-spec.js';
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
  shapeSpec(ix, iy) {
    const len  = FIT_W;
    const mx   = ix + len / 2;
    const wIn  = this.isReducer ? HALF : HALF - TAPER;
    const wOut = this.isReducer ? HALF - TAPER : HALF;
    const cls  = `pipe-body ${this.isReducer ? 'pipe-reducer' : 'pipe-expander'}`;
    const dim  = `${this.d_in_mm}→${this.d_out_mm}mm`;

    return {
      right: {
        prims: [
          { tag: 'polygon', cls,
            points: `${ix},${iy-wIn} ${ix+len},${iy-wOut} ${ix+len},${iy+wOut} ${ix},${iy+wIn}` },
        ],
        labels: [
          { x: mx, y: iy - 14, anchor: 'middle', cls: 'lbl lbl-dim', text: dim },
        ],
      },

      down: {
        // Giriş üstte (iy), çıkış altta (iy+len). Reducer: üst geniş → alt dar.
        prims: [
          { tag: 'polygon', cls,
            points: `${ix-wIn},${iy} ${ix+wIn},${iy} ${ix+wOut},${iy+len} ${ix-wOut},${iy+len}` },
        ],
        labels: [
          { x: ix + HALF + 6, y: iy + len/2, anchor: 'start', cls: 'lbl lbl-dim', text: dim },
        ],
      },

      up: {
        // Giriş altta (iy), çıkış üstte (iy-len). Reducer: alt geniş → üst dar.
        prims: [
          { tag: 'polygon', cls,
            points: `${ix-wIn},${iy} ${ix+wIn},${iy} ${ix+wOut},${iy-len} ${ix-wOut},${iy-len}` },
        ],
        labels: [
          { x: ix + HALF + 6, y: iy - len/2, anchor: 'start', cls: 'lbl lbl-dim', text: dim },
        ],
      },
    };
  }

  calcHydraulics(Q_m3s, fluid, prev = null) {
    const length_m = this._overrides.length_m ?? 0.3;
    const prevSeg  = prev ? { diameter_mm: prev.outDiameter_mm } : null;
    this.result = calcSegment(
      { diameter_mm: this.d_out_mm, length_m, dz_m: this.dz_m, eps_mm: this.eps_mm, K_fittings: 0 },
      Q_m3s, fluid, prevSeg
    );
    this.result.P_out = null;
    return this.result;
  }

  createSVG(layout, labelLayer) {
    const g = svgEl('g');
    g.dataset.compId = this.id;
    g.classList.add('component', 'pipe', this.isReducer ? 'pipe-reducer-comp' : 'pipe-expander-comp');
    const spec = this.shapeSpec(layout.ix, layout.iy);
    drawSpec(g, labelLayer, spec[layout.entryDir]);
    return g;
  }

  updateSVG(g, layout, labelLayer) {
    super.updateSVG(g, layout);
    while (g.firstChild) g.removeChild(g.firstChild);
    const spec = this.shapeSpec(layout.ix, layout.iy);
    drawSpec(g, labelLayer, spec[layout.entryDir]);
  }

  renderPropsHTML() {
    const mkOpts = (val) => DN_LIST.map(x =>
      `<option value="${x.d}" ${Math.abs(x.d - val) < 1 ? 'selected' : ''}>${x.dn} (${x.d}mm)</option>`
    ).join('');
    return `
      <div class="pr"><span class="pl">D inlet</span>
        <select class="p-select" data-prop="d_in_mm">${mkOpts(this.d_in_mm)}</select></div>
      <div class="pr"><span class="pl">D outlet</span>
        <select class="p-select" data-prop="d_out_mm">${mkOpts(this.d_out_mm)}</select></div>
      <div class="pr"><span class="pl">Length</span>
        <input class="p-input" type="number" value="${this._overrides.length_m ?? 0.3}"
          step="0.05" min="0.05" data-prop="length_m">
        <span class="pu">m</span></div>`;
  }

  serialize() {
    return { ...super.serialize(), length_m: this._overrides.length_m ?? 0.3,
             d_in_mm: this.d_in_mm, d_out_mm: this.d_out_mm };
  }
}

registerComponentType('pipe', 'reducer',  () => new TransitionComponent('reducer'));
registerComponentType('pipe', 'expander', () => new TransitionComponent('expander'));
