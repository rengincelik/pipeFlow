'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { reynolds, G } from '../core/hydraulics.js';
import { svgEl ,drawSpec} from '../renderer/svg-utils.js';

const R = 18;  // daire yarıçapı

export class PumpComponent extends ComponentBase {
  constructor() {
    super('pump', 'centrifugal');
    this.name       = 'Centrifugal';
    this.head_m     = 20;
    this.efficiency = 0.75;
    this._lenPx     = 64;
  }

shapeSpec(layout) {
  const { ix, iy } = layout;
  const len = this._lenPx;
  const mx  = ix + len / 2;
  const R   = 12; // Sabit yarıçap varsayalım

  return {
    itemShape: [
      { tag: 'line',   cls: 'pump-stem',   x1: ix,      y1: iy, x2: mx - R, y2: iy },
      { tag: 'line',   cls: 'pump-stem',   x1: mx + R,  y1: iy, x2: ix + len, y2: iy },
      { tag: 'circle', cls: 'pump-circle', cx: mx, cy: iy, r: R },
      { tag: 'path',   cls: 'pump-blade',  d: `M${mx},${iy} L${mx-5},${iy-7} L${mx+7},${iy-3} Z` },
    ],
    anchors: [
      { type: 'pump_label', x: mx, y: iy },
      { type: 'head',       x: mx, y: iy }
    ],
    orientation: this.entryDir
  };
}



  calcHydraulics(Q_m3s, fluid) {
    super.calcHydraulics(Q_m3s, fluid);

    // Head (basma yüksekliği) değerini basınca çevir
    const addP_Pa = fluid.rho * 9.81 * this.head_m;

    this.result.isPump = true;
    this.result.head_m = this.head_m;
    this.result.dP_Pa = -addP_Pa; // Basınç artışı negatif kayıp demektir
    this.result.dP_bar = -addP_Pa / 1e5;
    this.result.hf.total = -this.head_m;

    return this.result;
  }





  renderPropsHTML() {
    return [
      this.row('Head', this.input('head_m', this.head_m, "1"), 'm'),
      this.row('Efficiency', this.input('efficiency', this.efficiency, "0.01"))
    ].join('');
  }

  serialize() { return { ...super.serialize(), head_m: this.head_m, efficiency: this.efficiency }; }
}

registerComponentType('pump', 'centrifugal', () => new PumpComponent());
