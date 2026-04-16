// diagnostic-engine.js
// Orchestrates all diagnostic rules. Consumed by main.js and tooltip-manager.js.
// Optional dependency — SimulationEngine works without it (optional chaining at call sites).

import { COMPONENT_RULES, SYSTEM_RULES, ADVICE_RULES } from './diagnostic-rules.js';

export class DiagnosticEngine {

  /** @param {import('../state/pipeline-store.js').PipelineStore} pipelineStore */
  constructor(pipelineStore) {
    this._store     = pipelineStore;
    this._results   = [];          // last evaluate() output
    this._listeners = [];          // onChange callbacks
    this._lastEval  = 0;           // timestamp for throttle
    this._THROTTLE  = 500;         // ms
  }

  // ---------------------------------------------------------------------------
  // Public — evaluate
  // ---------------------------------------------------------------------------

  /**
   * Run all rules and update internal cache.
   * Throttled to _THROTTLE ms — safe to call every 100 ms tick.
   *
   * @param {object|null} snapshot  SimulationEngine snapshot, or null when engine is stopped.
   */
  evaluate(snapshot) {
    const now = Date.now();
    if (now - this._lastEval < this._THROTTLE) return;
    this._lastEval = now;

    const allComps = this._store.components;
    const results  = [];

    // --- Pass 1A: component-level rules ---
    for (const rule of COMPONENT_RULES) {
      if (!snapshot && rule.requiresSnapshot) continue;
      for (const comp of allComps) {
        const node = snapshot?.nodes?.find(n => n.id === comp.id) ?? null;
        try {
          const r = rule.evaluate(comp, snapshot, allComps, node);
          if (r) results.push(r);
        } catch (e) {
          console.warn(`[DiagnosticEngine] Rule ${rule.id} threw:`, e);
        }
      }
    }

    // --- Pass 1B: system-level rules ---
    for (const rule of SYSTEM_RULES) {
      if (!snapshot && rule.requiresSnapshot) continue;
      try {
        const r = rule.evaluate(snapshot, allComps);
        if (r) results.push(r);
      } catch (e) {
        console.warn(`[DiagnosticEngine] System rule ${rule.id} threw:`, e);
      }
    }

    // --- Pass 2: advice rules (depend on pass-1 results) ---
    for (const rule of ADVICE_RULES) {
      if (!snapshot && rule.requiresSnapshot) continue;
      try {
        const extras = rule.evaluateAdvice(results, allComps);
        if (Array.isArray(extras)) results.push(...extras);
      } catch (e) {
        console.warn(`[DiagnosticEngine] Advice rule ${rule.id} threw:`, e);
      }
    }

    this._results = results;
    this._notify(results);
  }

  // ---------------------------------------------------------------------------
  // Public — read
  // ---------------------------------------------------------------------------

  /** All current diagnostic results. */
  getResults() {
    return this._results;
  }

  /**
   * Results relevant to a specific component — used by TooltipManager.
   * @param {number} componentId
   */
  getResultsFor(componentId) {
    return this._results.filter(r => r.componentId === componentId);
  }

  /**
   * Results filtered by category.
   * @param {'physics'|'system'|'pump'|'config'|'advice'} category
   */
  getResultsByCategory(category) {
    return this._results.filter(r => r.category === category);
  }

  /**
   * Count per severity level.
   * @returns {{ critical: number, warning: number, info: number }}
   */
  getSummary() {
    const summary = { critical: 0, warning: 0, info: 0 };
    for (const r of this._results) {
      if (r.severity in summary) summary[r.severity]++;
    }
    return summary;
  }

  /** True if any current result is critical severity. */
  hasCritical() {
    return this._results.some(r => r.severity === 'critical');
  }

  // ---------------------------------------------------------------------------
  // Public — subscription
  // ---------------------------------------------------------------------------

  /**
   * Register a callback fired after each evaluate() that produces new results.
   * @param {function(DiagnosticResult[]): void} fn
   */
  onChange(fn) {
    this._listeners.push(fn);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _notify(results) {
    for (const fn of this._listeners) {
      try { fn(results); } catch (e) { console.error('[DiagnosticEngine] onChange listener threw:', e); }
    }
  }
}
