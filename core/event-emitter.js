'use strict';

// ═══════════════════════════════════════════════════════════
// MINIMAL EVENT EMITTER — Node'a bağımlılık yok
// ═══════════════════════════════════════════════════════════

export class EventEmitter {
  constructor() { this._listeners = {}; }

  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return () => this.off(event, fn);   // unsubscribe fonksiyonu döner
  }

  off(event, fn) {
    const list = this._listeners[event];
    if (list) this._listeners[event] = list.filter(f => f !== fn);
  }

  emit(event, ...args) {
    (this._listeners[event] ?? []).forEach(fn => fn(...args));
    (this._listeners['*']    ?? []).forEach(fn => fn(event, ...args));
  }

  once(event, fn) {
    const wrapper = (...args) => { fn(...args); this.off(event, wrapper); };
    this.on(event, wrapper);
  }
}
