'use strict';

import { SystemConfig } from '../state/system-config.js';

export const OverrideMixin = {

	_ensureOverrides() {
		if (!this._overrides) this._overrides = {};
	},

	override(key, value, isUserSet = false) {
		this._ensureOverrides();
		if (value === null || value === undefined) {
			delete this._overrides[key];
		} else {
			this._overrides[key] = value;
		}
		this._userOverrides = this._userOverrides ?? new Set();
		if (isUserSet) this._userOverrides.add(key);
		else           this._userOverrides.delete(key);
		this._onOverrideChange?.(key, value);
		return this;
	},

	getOverride(key) {
		return this._overrides?.[key] ?? null;
	},

	resolve(key) {
		return this._overrides?.[key] ?? SystemConfig.get(key);
	},

	clearOverride(key) {
		this._ensureOverrides();
		delete this._overrides[key];
		this._userOverrides?.delete(key);
		this._onOverrideChange?.(key, undefined);
		return this;
	},

	clearAllOverrides() {
		this._overrides    = {};
		this._userOverrides = new Set();
		this._onOverrideChange?.('*', undefined);
		return this;
	},

	hasOverride(key) {
		return Boolean(this._overrides && key in this._overrides);
	},

	hasUserOverride(key) {
		return this._userOverrides?.has(key) ?? false;
	},

	serializeOverrides() {
		return this._overrides ? { ...this._overrides } : {};
	},
};