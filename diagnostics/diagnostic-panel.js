// diagnostic-panel.js
// Manages the Diagnostics tab inside #panel-chart.
// Consumed by main.js — instantiated after DiagnosticEngine.

import { pipelineStore } from '../state/pipeline-store.js';

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

export class DiagnosticsPanel {

  /**
   * @param {import('./diagnostic-engine.js').DiagnosticEngine} diagnosticEngine
   */
  constructor(diagnosticEngine) {
    this._engine     = diagnosticEngine;
    this._activeTab  = 'analysis'; // 'analysis' | 'diagnostics'
    this._userChose  = false;      // true → user manually switched tab

    this._el = {
      panelHeader:      document.querySelector('#panel-chart .panel-header'),
      chartBody:        document.getElementById('chart-body'),
      chartMetricTabs:  document.querySelector('.chart-metric-tabs'),
      diagBody:         null,  // created in _buildDOM
      tabAnalysis:      null,
      tabDiagnostics:   null,
      badge:            null,
    };

    this._buildDOM();
    this._bindTabEvents();
  }

  // DOM construction

  _buildDOM() {
    const header = this._el.panelHeader;
    if (!header) return;

    // Replace plain "Analysis" text with a tab bar
    // Original header inner: <span>Analysis</span> + <div class="chart-metric-tabs">...</div>
    const metricTabs = this._el.chartMetricTabs;

    // Build tab bar
    const tabBar = document.createElement('div');
    tabBar.className = 'panel-tab-bar';
    tabBar.innerHTML = `
      <button class="panel-tab active" data-panel="analysis">Analysis</button>
      <button class="panel-tab" data-panel="diagnostics">
        Diagnostics
        <span class="diag-badge" id="diag-badge"></span>
      </button>
    `;

    // Replace the <span>Analysis</span> with the tab bar
    const titleSpan = header.querySelector('span');
    if (titleSpan) titleSpan.replaceWith(tabBar);

    this._el.tabAnalysis    = tabBar.querySelector('[data-panel="analysis"]');
    this._el.tabDiagnostics = tabBar.querySelector('[data-panel="diagnostics"]');
    this._el.badge          = tabBar.querySelector('#diag-badge');

    // Create diagnostics body (hidden by default)
    const diagBody = document.createElement('div');
    diagBody.id        = 'diagnostics-body';
    diagBody.className = 'diag-body';
    diagBody.hidden    = true;
    this._el.chartBody.after(diagBody);
    this._el.diagBody = diagBody;
  }

  // ---------------------------------------------------------------------------
  // Tab switching
  // ---------------------------------------------------------------------------

  _bindTabEvents() {
    this._el.tabAnalysis?.addEventListener('click', () => {
      this._userChose = true;
      this._switchTo('analysis');
    });
    this._el.tabDiagnostics?.addEventListener('click', () => {
      this._userChose = true;
      this._switchTo('diagnostics');
    });
  }

  _switchTo(tab) {
    this._activeTab = tab;

    const isAnalysis = tab === 'analysis';
    this._el.tabAnalysis?.classList.toggle('active', isAnalysis);
    this._el.tabDiagnostics?.classList.toggle('active', !isAnalysis);

    this._el.chartBody.hidden          = !isAnalysis;
    this._el.diagBody.hidden           = isAnalysis;
    if (this._el.chartMetricTabs) {
      this._el.chartMetricTabs.style.display = isAnalysis ? '' : 'none';
    }
  }

  /** Force open the Diagnostics tab (called when critical result appears). */
  forceOpen() {
    this._switchTo('diagnostics');
  }

  // Render — called from diagnosticEngine.onChange

  /**
   * @param {import('./diagnostic-rules.js').DiagnosticResult[]} results
   */
  render(results) {
    this._updateBadge(results);

    // Auto-open only when critical and user hasn't manually navigated away
    if (this._engine.hasCritical() && (!this._userChose || this._activeTab !== 'analysis')) {
      this.forceOpen();
    }

    // Once no critical remains, stop forcing (user stays wherever they are)
    if (!this._engine.hasCritical()) {
      this._userChose = false;
    }

    this._renderList(results);
  }

  // Badge

  _updateBadge(results) {
    const badge = this._el.badge;
    if (!badge) return;

    const { critical, warning } = this._engine.getSummary();

    if (critical > 0) {
      badge.textContent = critical;
      badge.className   = 'diag-badge critical';
    } else if (warning > 0) {
      badge.textContent = warning;
      badge.className   = 'diag-badge warning';
    } else {
      badge.textContent = '';
      badge.className   = 'diag-badge';
    }
  }

  // List render

  _renderList(results) {
    const body = this._el.diagBody;
    if (!body) return;

    if (!results.length) {
      body.innerHTML = '<div class="diag-empty">No issues detected.</div>';
      return;
    }

    // Sort: critical → warning → info, then by category
    const sorted = [...results].sort((a, b) => {
      const sd = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
      if (sd !== 0) return sd;
      return (a.category ?? '').localeCompare(b.category ?? '');
    });

    // Group by severity
    const groups = {};
    for (const r of sorted) {
      (groups[r.severity] ??= []).push(r);
    }

    const html = [];
    for (const severity of ['critical', 'warning', 'info']) {
      const items = groups[severity];
      if (!items?.length) continue;
      const label = severity.toUpperCase();
      html.push(`<div class="diag-group">`);
      html.push(`<div class="diag-group-header diag-group-header--${severity}">${label} (${items.length})</div>`);
      for (const r of items) {
        html.push(this._renderItem(r));
      }
      html.push(`</div>`);
    }

    body.innerHTML = `<div class="diag-list">${html.join('')}</div>`;

    // Bind click handlers for component selection
    body.querySelectorAll('.diag-item[data-comp-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.compId, 10);
        if (isFinite(id)) pipelineStore.select(id);
      });
    });

    // Bind expand toggle for detail/advice
    body.querySelectorAll('.diag-item').forEach(el => {
      el.addEventListener('click', () => el.classList.toggle('expanded'));
    });
  }

  _renderItem(r) {
    const compAttr   = r.componentId != null ? `data-comp-id="${r.componentId}"` : '';
    const compLabel  = r.componentName ? `<span class="diag-item-comp">${r.componentName}</span> — ` : '';
    const detail     = r.detail  ? `<div class="diag-item-detail">${r.detail}</div>` : '';
    const advice     = r.advice  ? `<div class="diag-item-advice">💡 ${r.advice}</div>`  : '';
    const valueStr   = r.value != null && r.unit ? `<span class="diag-item-value">${_fmt(r.value)} ${r.unit}</span>` : '';

    return `
      <div class="diag-item ${r.severity}" ${compAttr}>
        <div class="diag-item-main">
          <span class="diag-item-id">${r.id}</span>
          ${compLabel}
          <span class="diag-item-msg">${r.message}</span>
          ${valueStr}
        </div>
        <div class="diag-item-extra">
          ${detail}
          ${advice}
        </div>
      </div>`;
  }
}

// Tiny format helper — mirrors _fmt in main.js
function _fmt(val) {
  if (!isFinite(val)) return '—';
  return Number.isInteger(val) ? String(val) : val.toFixed(2);
}