'use strict';

import { ComponentBase, registerComponentType, DIR_VEC } from './base.js'; 

const ARM = 27;

export class ElbowComponent extends ComponentBase {
  constructor(subtype = 'rd') {
    super('elbow', subtype);
    this.name   = 'Elbow';
    this.K      = 0.90;
    this._lenPx = ARM;
    const dirs  = { rd: ['right','down'], ru: ['right','up'],
                    ur: ['up','right'],   dr: ['down','right'] };
    [this.entryDir, this.exitDir] = dirs[subtype] ?? ['right', 'down'];
  }
  getParams() {
    return {
      type:        'elbow',
      subtype:     this.subtype,
      K:           this.resolve('K'),
      diameter_mm: this.resolve('diameter_mm'),
    };
  }
  computeExit(ix, iy) {
    const eVec    = DIR_VEC[this.entryDir];
    const xVec    = DIR_VEC[this.exitDir];
    const cornerX = ix + eVec.dx * ARM;
    const cornerY = iy + eVec.dy * ARM;
    return { ox: cornerX + xVec.dx * ARM, oy: cornerY + xVec.dy * ARM,
             exitDir: this.exitDir, cornerX, cornerY };
  }

  // Elbow world koordinatlarla çalışır — shapeSpec layout'un tamamını alır
shapeSpec(layout) {
  const { ix, iy, ox, oy, cornerX, cornerY } = layout;
  // Eğer ix/iy undefined geliyorsa burası patlar, kontrol ekle
  if (ix === undefined) return { itemShape: [], anchors: [] };

  const cx = cornerX ?? (ix === ox ? ix : ox);
  const cy = cornerY ?? (iy === oy ? iy : oy);

  return {
    itemShape: [
      {
        tag: 'path',
        cls: 'elbow-path',
        d: `M ${ix} ${iy} Q ${cx} ${cy} ${ox} ${oy}`,
        fill: 'none',
        stroke: '#333', // Çizginin rengi
        'stroke-width': '3' // Çizginin kalınlığı
      }
    ],
    anchors: [
      { type: 'label', x: ix, y: iy },
    ],
    orientation: 'static' // Dönmesin, koordinatları zaten doğru
  };
}







  renderPropsHTML() {
    return [
    this.row('Turn',     this.value(`${this.entryDir} → ${this.exitDir}`)),
    this.row('Diameter', this.value(this.diameter_mm, 'mm')),
    this.row('K value',  this.value(this.K))
    ].join('');
  }

}

['rd', 'ru', 'ur', 'dr'].forEach(s =>
  registerComponentType('elbow', s, () => new ElbowComponent(s))
);
