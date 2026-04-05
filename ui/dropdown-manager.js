'use strict';

/**
 * createDropdownManager({ triggers })
 * triggers: [{ triggerId, dropdownId }]
 * returns: { bind, toggle, closeAll }
 */
export function createDropdownManager({ triggers = [] } = {}) {

	// <editor-fold desc="closeAll">
	function closeAll() {
		document.querySelectorAll('.tb-dropdown.open').forEach(d => d.classList.remove('open'));
	}
	// </editor-fold>

	// <editor-fold desc="toggle">
	function toggle(id) {
		const dd      = document.getElementById(id);
		if (!dd) return;
		const wasOpen = dd.classList.contains('open');
		closeAll();
		if (!wasOpen) dd.classList.add('open');
	}
	// </editor-fold>

	// <editor-fold desc="bind">
	function bind() {
		triggers.forEach(({ triggerId, dropdownId }) => {
			const btn = document.getElementById(triggerId);
			if (!btn) return;
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				toggle(dropdownId);
			});
		});
		document.addEventListener('click', closeAll);
	}
	// </editor-fold>

	return { bind, toggle, closeAll };
}