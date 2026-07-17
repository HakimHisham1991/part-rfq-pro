(function () {
  const sidebar = document.getElementById('module-sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  if (!sidebar || !toggle) return;

  const STORAGE_KEY = 'part-rfq-pro-sidebar-collapsed';
  const SETTINGS_NAV_KEY = 'part-rfq-pro-settings-nav-expanded';

  function applyCollapsed(collapsed) {
    sidebar.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  // Always force-collapsed on load (user can still expand for the session).
  applyCollapsed(true);

  toggle.addEventListener('click', () => {
    applyCollapsed(!sidebar.classList.contains('collapsed'));
  });

  const module = document.body.className.match(/module-(\S+)/)?.[1];
  if (module) {
    document.querySelectorAll('.sidebar-nav .nav-link').forEach((link) => {
      if (link.dataset.module === module) link.classList.add('active');
    });
  }

  const settingsGroup = document.getElementById('nav-group-settings');
  const settingsToggle = document.getElementById('settings-nav-toggle');
  const isSettingsModule =
    module === 'settings-users' ||
    module === 'settings-material-specs' ||
    module === 'settings-operation-templates' ||
    module === 'settings-machine-profiles';

  if (settingsGroup && settingsToggle) {
    let expanded = isSettingsModule;
    try {
      if (!isSettingsModule) {
        expanded = localStorage.getItem(SETTINGS_NAV_KEY) !== '0';
      }
    } catch {
      /* ignore */
    }
    settingsGroup.classList.toggle('expanded', expanded);
    settingsToggle.setAttribute('aria-expanded', String(expanded));

    settingsToggle.addEventListener('click', () => {
      const next = !settingsGroup.classList.contains('expanded');
      settingsGroup.classList.toggle('expanded', next);
      settingsToggle.setAttribute('aria-expanded', String(next));
      try {
        localStorage.setItem(SETTINGS_NAV_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
    });
  }

  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('projectId');
  const partId = params.get('partId');

  const rfqNav = document.getElementById('nav-project-rfq');
  if (rfqNav && projectId) {
    rfqNav.href = `/ProjectRfq?projectId=${encodeURIComponent(projectId)}`;
  }

  const cycleNav = document.getElementById('nav-cycle-time');
  if (cycleNav && projectId && partId) {
    cycleNav.href = `/CycleTime/Edit?projectId=${encodeURIComponent(projectId)}&partId=${encodeURIComponent(partId)}`;
  }

  const analyzerNav = document.querySelector('.nav-link[data-module="analyzer"]');
  if (analyzerNav && projectId && partId) {
    analyzerNav.href = `/Analyzer?projectId=${encodeURIComponent(projectId)}&partId=${encodeURIComponent(partId)}`;
  }
})();
