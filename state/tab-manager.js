'use strict';

// <editor-fold desc="CONSTANTS">
const TAB_LIST_KEY   = 'pf-tabs';
const ACTIVE_TAB_KEY = 'pf-active-tab';
const TAB_DATA_KEY   = (id) => `pf-tab-${id}`;
const MAX_TABS       = 5;
// </editor-fold>

/**
 * createTabManager({ tabBar, onSwitch, onNew, onClose, showToast })
 *
 * onSwitch(tabId)  — aktif tab değişince çağrılır, caller store'u swap eder
 * onNew()          — yeni proje başlatmak için caller'ın newProject mantığı
 * onClose(tabId)   — tab kapanınca localStorage temizliği caller'a bildiriliyor
 *
 * Public API:
 *   render()
 *   activeId         → string
 *   getStorageKey()  → 'pf-tab-{activeId}'
 *   saveTabList()    → tabs listesini localStorage'a yazar
 *   activateTab(id)  → programatik switch (IO.loadProject vb.)
 */
export function createTabManager({ tabBar, onSwitch, showToast }) {

	// <editor-fold desc="STATE">
	let tabs     = [];   // [{ id: string, name: string }]
	let activeId = null;
	let tabCounter = 0;
	// </editor-fold>

	// <editor-fold desc="INIT">
	function init() {
		_loadState();
		if (tabs.length === 0) _addTab({ silent: true });
		if (!tabs.find(t => t.id === activeId)) activeId = tabs[0].id;
		_persist();
		render();
	}

	function _loadState() {
		try {
			const raw = localStorage.getItem(TAB_LIST_KEY);
			tabs      = raw ? JSON.parse(raw) : [];
		} catch { tabs = []; }
		activeId = localStorage.getItem(ACTIVE_TAB_KEY) ?? null;
		tabCounter = parseInt(localStorage.getItem('pf-tab-counter') ?? '0');
	}
	// </editor-fold>

	// <editor-fold desc="TAB CRUD">
	function _newId() {
		return 'tab-' + Math.random().toString(36).slice(2, 8);
	}

	function _addTab({ silent = false } = {}) {
		if (tabs.length >= MAX_TABS) {
			if (!silent) showToast(`Maximum ${MAX_TABS} tabs allowed`);
			return null;
		}
		const id   = _newId();
		tabCounter +=1;
		const name = `Project ${tabCounter}`;
		tabs.push({ id, name });
		activeId = id;
		_persist();
		return id;
	}

	function addTab() {
		const id = _addTab();
		if (!id) return;
		render();
		onSwitch(id, true, null); // true = yeni proje
	}

	function closeTab(id) {
		if (tabs.length === 1) {
			showToast('At least one tab must remain');
			return;
		}
		const idx = tabs.findIndex(t => t.id === id);
		if (idx === -1) return;

		// localStorage'dan tab datasını sil
		localStorage.removeItem(TAB_DATA_KEY(id));

		tabs.splice(idx, 1);

		// Kapanan tab aktif idiyse komşuya geç
		if (activeId === id) {
			activeId = tabs[Math.min(idx, tabs.length - 1)].id;
			_persist();
			render();
			onSwitch(activeId, false);
		} else {
			_persist();
			render();
		}
	}

	function renameTab(id, newName) {
		const t = tabs.find(t => t.id === id);
		if (!t) return;
		t.name = newName.trim() || t.name;
		_persist();
		render();
	}

	function activateTab(id) {
		if (activeId === id) return;
		const previousId = activeId;   // ← eski id'yi sakla
		activeId = id;
		_persist();
		render();
		onSwitch(id, false, previousId);  // ← üçüncü parametre olarak geç
	}
	// </editor-fold>

	// <editor-fold desc="STORAGE">
	function _persist() {
		localStorage.setItem(TAB_LIST_KEY,   JSON.stringify(tabs));
		localStorage.setItem(ACTIVE_TAB_KEY, activeId ?? '');
		localStorage.setItem('pf-tab-counter', String(tabCounter));
	}

	function getStorageKey() {
		return TAB_DATA_KEY(activeId);
	}

	function saveTabList() {
		_persist();
	}
	// </editor-fold>

	// <editor-fold desc="RENDER">
	function render() {
		tabBar.innerHTML = '';

		tabs.forEach(tab => {
			const el = document.createElement('div');
			el.className  = 'tab' + (tab.id === activeId ? ' active' : '');
			el.dataset.tabId = tab.id;

			// İsim span — çift tık ile rename
			const nameEl = document.createElement('span');
			nameEl.className   = 'tab-name';
			nameEl.textContent = tab.name;

			nameEl.addEventListener('dblclick', (e) => {
				e.stopPropagation();
				_startRename(tab, nameEl);
			});

			// Kapat butonu
			const closeEl = document.createElement('span');
			closeEl.className   = 'tab-close';
			closeEl.title       = 'Close';
			closeEl.textContent = '×';
			closeEl.addEventListener('click', (e) => {
				e.stopPropagation();
				closeTab(tab.id);
			});

			el.appendChild(nameEl);
			el.appendChild(closeEl);

			el.addEventListener('click', () => activateTab(tab.id));

			tabBar.appendChild(el);
		});

		// + butonu
		if (tabs.length < MAX_TABS) {
			const addBtn = document.createElement('div');
			addBtn.className   = 'tab-add';
			addBtn.id          = 'btn-tab-add';
			addBtn.title       = 'New tab';
			addBtn.textContent = '+';
			addBtn.addEventListener('click', () => addTab());
			tabBar.appendChild(addBtn);
		}

		_applyFluidTabWidths();
	}

	function _applyFluidTabWidths() {
		const tabEls = tabBar.querySelectorAll('.tab');
		if (!tabEls.length) return;

		// Tab bar genişliğinden + butonunu çıkar (~32px)
		const addBtnWidth = tabs.length < MAX_TABS ? 36 : 0;
		const available   = tabBar.offsetWidth - addBtnWidth;

		const ideal       = available / tabEls.length;
		const width       = Math.max(10, Math.min(100, ideal));

		tabEls.forEach(el => { el.style.width = width + 'px'; });
	}
	// </editor-fold>

	// <editor-fold desc="RENAME">
	function _startRename(tab, nameEl) {
		const input = document.createElement('input');
		input.type      = 'text';
		input.className = 'tab-rename-input';
		input.value     = tab.name;

		const finish = () => {
			renameTab(tab.id, input.value);
		};

		input.addEventListener('blur',  finish);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter')  { input.blur(); }
			if (e.key === 'Escape') { input.value = tab.name; input.blur(); }
		});

		nameEl.replaceWith(input);
		input.focus();
		input.select();
	}
	// </editor-fold>

	// ResizeObserver — tab bar genişliği değişince widths'leri güncelle
	new ResizeObserver(() => _applyFluidTabWidths()).observe(tabBar);

	return {
		init,
		render,
		addTab,
		closeTab,
		activateTab,
		renameTab,
		saveTabList,
		getStorageKey,
		get activeId() { return activeId; },
		get tabs()     { return tabs; },
	};
}