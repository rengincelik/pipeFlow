'use strict';

import { ComponentBase, registerComponentType } from './base.js';
import { DN_LIST, MATERIALS } from '../data/catalogs.js';
import { Units } from '../data/unit-system.js';

const MIN_PX   = 100;
const MAX_PX   = 500;

export class PipeComponent extends ComponentBase {
  constructor() {
    super('pipe', 'pipe');
    this.name     = 'Pipe';
    this.entryDir = 'right';
    this.exitDir  = 'right';
    this.constraints ={
      length_m: {min:1, max:100, step:1 }
    }
  }
  getParams() {
    return {
      type:        this.type,
      subtype:     this.subtype,
      length_m:    this.resolve('length_m'),
      diameter_mm: this.resolve('diameter_mm'),
      eps_mm:      this.resolve('eps_mm'),
    };
  }

  get _lenPx() {
    return Math.min(
      MAX_PX,
      Math.max(
        MIN_PX,
        (this._overrides.length_m ?? 6) * (MAX_PX-MIN_PX)*0.01
      )
    );
  }

  get dz_m() {
    const len = this._overrides.length_m ?? 6;
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
        { type: 'label', x: mx, y: iy },
      ],
      orientation: this.entryDir // Borunun yönü (right, down, up)
    };
  }


  renderPropsHTML() {
    const dnOptions  = DN_LIST.map(x => ({
      value: x.d,
      label: `${x.dn} (${x.d}mm)`
    }));
    const matOptions = MATERIALS.map(m => ({ value: m.id, label: m.name }));
    const lenVal = this._overrides.length_m;
    const dVal   = this.diameter_mm;

    return [
      this.row('Diameter',
        this.select('diameter_mm', dnOptions, dVal) +
        this.hint(dVal, v => Units.diameter(v))),

      this.row('Material',
        this.select('material_id', matOptions, this.resolve('material_id'))),

      this.row('Length',
        this.slider('length_m', lenVal ) +
        this.hint(lenVal, v => Units.length(v)), 'm'),


      this.row('Roughness ε',
        this.dimValue(this.eps_mm), 'mm'),
    ].join('');
  }

  serialize() {
    return {
      ...super.serialize(),
      length_m: this._overrides.length_m
    };
  }
}

registerComponentType('pipe', 'pipe', () => new PipeComponent());
