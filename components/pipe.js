'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { calcSegment } from '../core/hydraulics.js';
import { svgEl ,drawSpec} from '../renderer/svg-utils.js';
import { DN_LIST, MATERIALS } from '../data/catalogs.js';

const PX_PER_M = 18;
const MIN_PX   = 40;
const HALF     = 9;

export class PipeComponent extends ComponentBase {
  constructor() {
    super('pipe', 'pipe');
    this.name     = 'Pipe';
    this.entryDir = 'right';
    this.exitDir  = 'right';
  }

  get _lenPx() { return Math.max(MIN_PX, (this._overrides.length_m ?? 5) * PX_PER_M); }

  get dz_m() {
    const len = this._overrides.length_m ?? 5;
    if (this.entryDir === 'down') return  len;
    if (this.entryDir === 'up')   return -len;
    return 0;
  }

  // ── Şekil tanımları — world coord, yöne göre ─────────
shapeSpec(layout) {
  const { ix, iy } = layout;

  const len = this._lenPx;
  const mx = ix + len / 2;

  return {
    itemShape: [
      { tag: 'line',  cls: 'pipe-centerline', x1: ix + 4, y1: iy, x2: ix + len - 4, y2: iy },
    ],
    anchors: [
      { type: 'dim', x: mx, y: iy },
      { type: 'len', x: mx, y: iy },
      { type: 'vel', x: mx, y: iy }
    ],
    orientation: this.entryDir // Borunun yönü (right, down, up)
  };
}

  calcHydraulics(Q_m3s, fluid, prev = null) {
    // 1. Temel hesaplamaları yap (v, Re vs.)
    super.calcHydraulics(Q_m3s, fluid);

    const length_m = this._overrides.length_m ?? 5;
    const prevSeg  = prev ? { diameter_mm: prev.outDiameter_mm } : null;

    // 2. Boruya özel sürtünme ve kayıp hesapları (calcSegment merkezi fonksiyonun)
    const segmentRes = calcSegment(
      { diameter_mm: this.diameter_mm, length_m, dz_m: this.dz_m, eps_mm: this.eps_mm, K_fittings: 0 },
      Q_m3s, fluid, prevSeg
    );

    // 3. Base'den gelen result'ı boru verileriyle güncelle
    Object.assign(this.result, segmentRes);
    this.result.P_out = null;
    return this.result;
  }





  renderPropsHTML() {
    const dnOptions = DN_LIST.map(x => ({ value: x.d, label: `${x.dn} (${x.d}mm)` }));
    const matOptions = MATERIALS.map(m => ({ value: m.id, label: m.name }));

    return [
      this.row('Diameter', this.select('diameter_mm', dnOptions, this.diameter_mm)),
      this.row('Length', this.input('length_m', this._overrides.length_m ?? 5, "0.5"), 'm'),
      this.row('Material', this.select('material_id', matOptions, this.resolve('material_id'))),
      this.row('Roughness ε', this.dimValue(this.eps_mm), 'mm')
    ].join('');
  }

  serialize() { return { ...super.serialize(), length_m: this._overrides.length_m ?? 5 }; }
}

registerComponentType('pipe', 'pipe', () => new PipeComponent());
