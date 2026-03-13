'use strict';

// MINIMAL EVENT EMITTER — Node'a bağımlılık yok

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

	// EE1: Kopya üzerinde iterate — emit sırasında off() çağrılsa bile güvenli
	emit(event, ...args) {
		[...(this._listeners[event] ?? [])].forEach(fn => fn(...args));
	}

	once(event, fn) {
		const wrapper = (...args) => { fn(...args); this.off(event, wrapper); };
		this.on(event, wrapper);
	}

	// EE2: Wildcard ('*') listener desteği YOK — emit sadece exact event adıyla çalışır.
	// Projenin hiçbir yerinde wildcard kullanılmıyor. Gerekirse buraya eklenebilir:
	//   emit içinde [...(this._listeners['*'] ?? [])].forEach(fn => fn(event, ...args));
}