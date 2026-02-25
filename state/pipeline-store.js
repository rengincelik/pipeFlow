'use strict';

import { EventEmitter }   from '../core/event-emitter.js';
import { SystemConfig }   from './system-config.js';
import { computeLayout }  from '../renderer/svg-renderer.js';


export class PipelineStore extends EventEmitter {
  constructor() {
    super();
    this._components = [];   // ComponentBase[]
    this._selectedId  = null;

    // SystemConfig değişince yeniden hesapla
    SystemConfig.on('change', () => this.emit('components:change'));
  }
  insert(comp, atIndex = this._components.length) {
    // Önceki komptan çap mirası
    if (atIndex > 0) {
      const prev = this._components[atIndex - 1];
      const prevD = prev.outDiameter_mm;
      if (comp.type !== 'pipe' && !comp.hasOverride('diameter_mm')) {
        comp.override('diameter_mm', prevD);
      }
    }
    this._components.splice(atIndex, 0, comp);

    this.emit('components:change');
    return this;
  }
  remove(compId) {
    const idx = this._components.findIndex(c => c.id === compId);
    if (idx === -1) return this;
    this._components.splice(idx, 1);
    if (this._selectedId === compId) this._selectedId = null;
    this.emit('components:change');
    return this;
  }
  clear() {
    this._components = [];
    this._selectedId  = null;
    this.emit('components:change');
    return this;
  }
  select(compId) {
    this._selectedId = compId;
    this.emit('selection:change', compId);
    return this;
  }
  deselect() { return this.select(null); }
  serialize() {
    return {
      version: 2,
      systemConfig: SystemConfig.snapshot(),
      components: this._components.map(c => c.serialize()),
    };
  }
  deserialize(data, componentFactory) {
    this.clear();
    if (data.systemConfig) {
      Object.entries(data.systemConfig).forEach(([k, v]) => SystemConfig.set(k, v));
    }
    data.components?.forEach(d => {
      const comp = componentFactory(d.type, d.subtype);
      comp.applySerializedData(d);
      this.insert(comp);
    });
    return this;
  }
  get selectedId()   { return this._selectedId; }
  get selectedComp() { return this._components.find(c => c.id === this._selectedId) ?? null; }
  get layout() { return computeLayout(this._components); }
  get components() { return [...this._components]; }
  get length()     { return this._components.length; }

}

export const pipelineStore = new PipelineStore();
