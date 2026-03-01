'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { Units } from '../data/unit-system.js';

const R = 18;  // daire yarıçapı

export class PumpComponent extends ComponentBase {
  constructor() {
    super('pump', 'centrifugal');
    this.name       = 'Centrifugal';
    this.Q_m3s = this.resolve('Q_m3s'),
    this.head_m     = 20;
    this.efficiency = 0.75;
    this._lenPx     = 64;
  }
  getParams() {
    return {
      type:       'pump',
      subtype:    this.subtype,
      Q_m3s:      this.resolve('Q_m3s'),
      H_m:        this.resolve('head_m') ?? 20,
      efficiency: this.resolve('efficiency'),
      diameter_mm: this.resolve('diameter_mm'),
    };
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
        { type: 'label', x: mx, y: iy },

      ],
      orientation: this.entryDir
    };
  }




  renderPropsHTML() {
    const headVal = this._overrides.head_m ;
    const etaVal  = this._overrides.efficiency ;
    const Q_lps   = ((this._overrides.Q_m3s ) * 1000).toFixed(1);
    const etaPct  = Math.round(etaVal * 100);

    return [
      // Head — sayısal input + imperial hint
      this.row('Head',
        this.input('head_m', headVal, '1') +
        this.hint(headVal, v => Units.length(v)), 'm'),

      this.row('Flow',
        this.slider('Q_m3s', Q_lps, '0.1'), 'L/s'),

      this.row('Efficiency', this.slider('efficiency_pct', etaPct)),

      this.row('Status', `<span class="p-status-tag ${this.isRunning ? 'running' : 'idle'}">${this.isRunning ? 'RUNNING' : 'IDLE'}</span>`)


    ].join('');
  }

  serialize() { return { ...super.serialize(), head_m: this.head_m, efficiency: this.efficiency }; }
}

registerComponentType('pump', 'centrifugal', () => new PumpComponent());
