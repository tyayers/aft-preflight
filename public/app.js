/**
 * AFT PREFLIGHT — Bungee Runtime Explorer & Tester
 * Pure vanilla JavaScript frontend for inspecting runtime state and running endpoint tests with trace profiling.
 */

(function () {
  'use strict';

  // State
  const state = {
    dataSummary: null,
    deploymentTests: [],
    currentProxyName: null,
    activeTest: null,
    activeTestAssertions: [],
    lastAssertionResults: null,
    testRunResults: new Map(),
    selectedCategory: 'proxies',
    selectedId: null,
    selectedTraceId: null,
    selectedItem: null,
    currentTrace: null,
    traces: [],
    activeTab: 'overview', // 'overview' | 'yaml' | 'tester' | 'tracesList'
    activeReqSubtab: 'headers', // 'headers' | 'body'
    activeResSubtab: 'body', // 'body' | 'headers' | 'assertions' | 'trace'
  };

  // DOM Elements
  const el = {
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    sidebarToggleBtn: document.getElementById('sidebarToggleBtn'),
    sidebarBackdrop: document.getElementById('sidebarBackdrop'),
    sidebarNav: document.getElementById('sidebarNav'),
    hStatProxies: document.getElementById('hStatProxies'),
    hStatProducts: document.getElementById('hStatProducts'),
    hStatUsers: document.getElementById('hStatUsers'),
    sidebarSearchInput: document.getElementById('sidebarSearchInput'),
    sidebarSearchClear: document.getElementById('sidebarSearchClear'),
    badgeNavProxies: document.getElementById('badgeNavProxies'),
    badgeNavProducts: document.getElementById('badgeNavProducts'),
    badgeNavUsers: document.getElementById('badgeNavUsers'),
    badgeNavTraces: document.getElementById('badgeNavTraces'),
    navItemsProxies: document.getElementById('navItemsProxies'),
    navItemsProducts: document.getElementById('navItemsProducts'),
    navItemsUsers: document.getElementById('navItemsUsers'),
    navItemsTraces: document.getElementById('navItemsTraces'),
    itemTypeBadge: document.getElementById('itemTypeBadge'),
    itemSubpath: document.getElementById('itemSubpath'),
    itemTitleDisplay: document.getElementById('itemTitleDisplay'),
    headerProxyUrls: document.getElementById('headerProxyUrls'),
    mainTabControl: document.getElementById('mainTabControl'),
    tabBtnOverview: document.getElementById('tabBtnOverview'),
    tabBtnYaml: document.getElementById('tabBtnYaml'),
    tabBtnTester: document.getElementById('tabBtnTester'),
    paneOverview: document.getElementById('paneOverview'),
    paneYaml: document.getElementById('paneYaml'),
    paneTester: document.getElementById('paneTester'),
    paneTracesList: document.getElementById('paneTracesList'),
    overviewContainer: document.getElementById('overviewContainer'),
    yamlFilenameLabel: document.getElementById('yamlFilenameLabel'),
    yamlCodeView: document.getElementById('yamlCodeView'),
    btnCopyYaml: document.getElementById('btnCopyYaml'),
    btnDownloadYaml: document.getElementById('btnDownloadYaml'),
    // Snippet Modal Elements
    yamlSnippetModal: document.getElementById('yamlSnippetModal'),
    snippetModalTitle: document.getElementById('snippetModalTitle'),
    snippetTypeBadge: document.getElementById('snippetTypeBadge'),
    snippetModalCode: document.getElementById('snippetModalCode'),
    btnCopySnippet: document.getElementById('btnCopySnippet'),
    copySnippetBtnText: document.getElementById('copySnippetBtnText'),
    btnCloseSnippetModal: document.getElementById('btnCloseSnippetModal'),
    btnCloseSnippetBtn: document.getElementById('btnCloseSnippetBtn'),
    // Help Modal Elements
    btnHeaderHelp: document.getElementById('btnHeaderHelp'),
    helpModal: document.getElementById('helpModal'),
    btnCloseHelpModal: document.getElementById('btnCloseHelpModal'),
    btnCloseHelpFooterBtn: document.getElementById('btnCloseHelpFooterBtn'),
    // Tester Elements
    btnHeaderTestConsole: document.getElementById('btnHeaderTestConsole'),
    testerVerbSelect: document.getElementById('testerVerbSelect'),
    testerUrlInput: document.getElementById('testerUrlInput'),
    btnTesterSend: document.getElementById('btnTesterSend'),
    btnTesterSendText: document.getElementById('btnTesterSendText'),
    subtabBtnHeaders: document.getElementById('subtabBtnHeaders'),
    subtabBtnBody: document.getElementById('subtabBtnBody'),
    subpaneHeaders: document.getElementById('subpaneHeaders'),
    subpaneBody: document.getElementById('subpaneBody'),
    headersTableBody: document.getElementById('headersTableBody'),
    btnAddHeaderRow: document.getElementById('btnAddHeaderRow'),
    headersCountBadge: document.getElementById('headersCountBadge'),
    btnPresetApiKey: document.getElementById('btnPresetApiKey'),
    btnPresetOpenAi: document.getElementById('btnPresetOpenAi'),
    btnFormatJson: document.getElementById('btnFormatJson'),
    testerBodyTextarea: document.getElementById('testerBodyTextarea'),
    // Proxy Tests & Assertions Elements
    proxyTestsCard: document.getElementById('proxyTestsCard'),
    proxyTestsTitle: document.getElementById('proxyTestsTitle'),
    proxyTestsCountBadge: document.getElementById('proxyTestsCountBadge'),
    proxyTestsSubtitle: document.getElementById('proxyTestsSubtitle'),
    btnRunAllProxyTests: document.getElementById('btnRunAllProxyTests'),
    proxyTestsGrid: document.getElementById('proxyTestsGrid'),
    activeTestBanner: document.getElementById('activeTestBanner'),
    activeTestNameDisplay: document.getElementById('activeTestNameDisplay'),
    activeTestAssertionsDisplay: document.getElementById('activeTestAssertionsDisplay'),
    btnResetActiveTest: document.getElementById('btnResetActiveTest'),
    resAssertionPill: document.getElementById('resAssertionPill'),
    resSubtabBtnAssertions: document.getElementById('resSubtabBtnAssertions'),
    resAssertionsCountBadge: document.getElementById('resAssertionsCountBadge'),
    resSubpaneAssertions: document.getElementById('resSubpaneAssertions'),
    assertionsCardWrapper: document.getElementById('assertionsCardWrapper'),
    assertionsEmptyNotice: document.getElementById('assertionsEmptyNotice'),
    assertionsList: document.getElementById('assertionsList'),
    resStatusCard: document.getElementById('resStatusCard'),
    resStatusBadge: document.getElementById('resStatusBadge'),
    resDurationCard: document.getElementById('resDurationCard'),
    resDurationPill: document.getElementById('resDurationPill'),
    resSizeCard: document.getElementById('resSizeCard'),
    resSizePill: document.getElementById('resSizePill'),
    resStreamCard: document.getElementById('resStreamCard'),
    resStreamPill: document.getElementById('resStreamPill'),
    resAssertionCard: document.getElementById('resAssertionCard'),
    resAssertionPill: document.getElementById('resAssertionPill'),
    resTraceCard: document.getElementById('resTraceCard'),
    resTraceIdPill: document.getElementById('resTraceIdPill'),
    resSubtabBtnBody: document.getElementById('resSubtabBtnBody'),
    resSubtabBtnHeaders: document.getElementById('resSubtabBtnHeaders'),
    resSubtabBtnTrace: document.getElementById('resSubtabBtnTrace'),
    resSubpaneBody: document.getElementById('resSubpaneBody'),
    resSubpaneHeaders: document.getElementById('resSubpaneHeaders'),
    resSubpaneTrace: document.getElementById('resSubpaneTrace'),
    btnCopyResponseBody: document.getElementById('btnCopyResponseBody'),
    resBodyCode: document.getElementById('resBodyCode'),
    resHeadersTableBody: document.getElementById('resHeadersTableBody'),
    traceIdLabel: document.getElementById('traceIdLabel'),
    traceDurationLabel: document.getElementById('traceDurationLabel'),
    traceProxyTimeLabel: document.getElementById('traceProxyTimeLabel'),
    traceTargetTimeLabel: document.getElementById('traceTargetTimeLabel'),
    traceTimelineContainer: document.getElementById('traceTimelineContainer'),
    btnToggleAllSteps: document.getElementById('btnToggleAllSteps'),
    btnToggleAllStepsText: document.getElementById('btnToggleAllStepsText'),
    btnExportApigee: document.getElementById('btnExportApigee'),
    btnExportOtel: document.getElementById('btnExportOtel'),
    // Traces List & Detail Elements
    tracesListView: document.getElementById('tracesListView'),
    tracesTableBody: document.getElementById('tracesTableBody'),
    btnClearTraces: document.getElementById('btnClearTraces'),
    btnRefreshTraces: document.getElementById('btnRefreshTraces'),
    btnBackToTracesList: document.getElementById('btnBackToTracesList'),
    traceDetailCard: document.getElementById('traceDetailCard'),
    traceDetailMethod: document.getElementById('traceDetailMethod'),
    traceDetailPath: document.getElementById('traceDetailPath'),
    traceDetailStatus: document.getElementById('traceDetailStatus'),
    traceDetailProxy: document.getElementById('traceDetailProxy'),
    traceDetailDuration: document.getElementById('traceDetailDuration'),
    traceDetailProxyDuration: document.getElementById('traceDetailProxyDuration'),
    traceDetailTargetDuration: document.getElementById('traceDetailTargetDuration'),
    traceDetailId: document.getElementById('traceDetailId'),
    traceDetailStepsContainer: document.getElementById('traceDetailStepsContainer'),
    traceDetailTargetContainer: document.getElementById('traceDetailTargetContainer'),
    btnToggleAllStepsDetail: document.getElementById('btnToggleAllStepsDetail'),
    btnToggleAllStepsDetailText: document.getElementById('btnToggleAllStepsDetailText'),
    btnExportApigeeDetail: document.getElementById('btnExportApigeeDetail'),
    btnExportOtelDetail: document.getElementById('btnExportOtelDetail'),
    btnCloseTraceDetail: document.getElementById('btnCloseTraceDetail'),
    traceReqVerbBadge: document.getElementById('traceReqVerbBadge'),
    traceReqUrlDisplay: document.getElementById('traceReqUrlDisplay'),
    traceReqHeadersDetails: document.getElementById('traceReqHeadersDetails'),
    traceReqHeadersCount: document.getElementById('traceReqHeadersCount'),
    traceReqHeadersBody: document.getElementById('traceReqHeadersBody'),
    traceReqPayloadBody: document.getElementById('traceReqPayloadBody'),
    btnCopyReqPayload: document.getElementById('btnCopyReqPayload'),
    traceResStatusBadge: document.getElementById('traceResStatusBadge'),
    traceResHeadersDetails: document.getElementById('traceResHeadersDetails'),
    traceResHeadersCount: document.getElementById('traceResHeadersCount'),
    traceResHeadersBody: document.getElementById('traceResHeadersBody'),
    traceResPayloadBody: document.getElementById('traceResPayloadBody'),
    traceResPayloadTag: document.getElementById('traceResPayloadTag'),
    btnCopyResPayload: document.getElementById('btnCopyResPayload'),
  };

  // --------------------------------------------------------------------------
  // YAML Snippet Registry & Modal Helpers
  // --------------------------------------------------------------------------
  const snippetCache = new Map();

  function registerSnippet(title, type, dataOrYaml) {
    const snipId = 'snip_' + Math.random().toString(36).substring(2, 9);
    let yamlText = '';
    if (typeof dataOrYaml === 'string') {
      yamlText = dataOrYaml;
    } else if (window.jsyaml && dataOrYaml) {
      try {
        yamlText = window.jsyaml.dump(dataOrYaml, { indent: 2, lineWidth: -1, noRefs: true });
      } catch {
        yamlText = JSON.stringify(dataOrYaml, null, 2);
      }
    } else {
      yamlText = JSON.stringify(dataOrYaml, null, 2);
    }
    snippetCache.set(snipId, { title, type, yamlText });
    return snipId;
  }

  function showSnippetModal(snipId) {
    const item = snippetCache.get(snipId);
    if (!item) return;
    if (el.snippetModalTitle) el.snippetModalTitle.textContent = item.title;
    if (el.snippetTypeBadge) el.snippetTypeBadge.textContent = item.type || 'YAML';
    if (el.snippetModalCode) el.snippetModalCode.textContent = item.yamlText;
    if (el.copySnippetBtnText) el.copySnippetBtnText.textContent = 'Copy Snippet';
    if (el.yamlSnippetModal && typeof el.yamlSnippetModal.showModal === 'function') {
      el.yamlSnippetModal.showModal();
    }
  }

  function renderSnippetButton(title, type, dataOrYaml, label = 'YAML') {
    const snipId = registerSnippet(title, type, dataOrYaml);
    return `
      <button class="btn-snippet" data-snip-id="${snipId}" title="View ${escapeHtml(title)} YAML snippet">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        <span>${escapeHtml(label)}</span>
      </button>
    `;
  }

  // --------------------------------------------------------------------------
  // Help & Documentation Modal Helpers
  // --------------------------------------------------------------------------
  function openHelpModal() {
    if (el.helpModal && typeof el.helpModal.showModal === 'function') {
      el.helpModal.showModal();
    }
  }

  function closeHelpModal() {
    if (el.helpModal && typeof el.helpModal.close === 'function') {
      el.helpModal.close();
    }
  }

  // --------------------------------------------------------------------------
  // URL Deep Linking & State Synchronization
  // --------------------------------------------------------------------------
  function syncUrl(options = {}) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('proxy');
      url.searchParams.delete('product');
      url.searchParams.delete('user');
      url.searchParams.delete('trace');
      url.searchParams.delete('tab');

      if (state.selectedCategory === 'traces' && state.selectedTraceId) {
        url.searchParams.set('trace', state.selectedTraceId);
      } else if (state.selectedItem) {
        const cleanName = state.selectedItem.cleanName || state.selectedItem.name.replace(/\.(yaml|yml|json)$/i, '');
        if (state.selectedCategory === 'proxies') {
          url.searchParams.set('proxy', cleanName);
        } else if (state.selectedCategory === 'products') {
          url.searchParams.set('product', cleanName);
        } else if (state.selectedCategory === 'users') {
          url.searchParams.set('user', cleanName);
        }

        if (state.activeTab === 'tester') {
          url.searchParams.set('tab', 'tester');
        } else if (state.activeTab === 'yaml') {
          url.searchParams.set('tab', 'yaml');
        }
      }

      const newUrl = url.pathname + (url.search ? url.search : '') + (url.hash || '');
      const currentUrl = window.location.pathname + (window.location.search || '') + (window.location.hash || '');
      if (newUrl !== currentUrl) {
        if (options.push) {
          window.history.pushState({}, '', newUrl);
        } else {
          window.history.replaceState({}, '', newUrl);
        }
      }
    } catch (e) {
      console.warn('Failed to sync URL:', e);
    }
  }

  function restoreResourceFromUrl() {
    if (!state.dataSummary) return false;

    const params = new URLSearchParams(window.location.search);
    const traceId = params.get('trace');
    const proxyName = params.get('proxy');
    const productName = params.get('product');
    const userName = params.get('user');
    const tab = params.get('tab');

    // Also support hash fallback: #/proxies/xxx, #proxy=xxx, #trace=xxx
    let hashResource = null;
    let hashType = null;
    if (window.location.hash) {
      const hash = window.location.hash.replace(/^#\/?/, '');
      if (hash.startsWith('traces/') || hash.startsWith('trace=')) {
        hashType = 'trace';
        hashResource = hash.split('/')[1] || hash.split('=')[1];
      } else if (hash.startsWith('proxies/') || hash.startsWith('proxy=')) {
        hashType = 'proxy';
        hashResource = hash.split('/')[1] || hash.split('=')[1];
      } else if (hash.startsWith('products/') || hash.startsWith('product=')) {
        hashType = 'product';
        hashResource = hash.split('/')[1] || hash.split('=')[1];
      } else if (hash.startsWith('users/') || hash.startsWith('user=')) {
        hashType = 'user';
        hashResource = hash.split('/')[1] || hash.split('=')[1];
      }
    }

    const targetTrace = traceId || (hashType === 'trace' ? hashResource : null);
    if (targetTrace) {
      selectTrace(targetTrace);
      return true;
    }

    const targetProxy = proxyName || (hashType === 'proxy' ? hashResource : null);
    if (targetProxy && state.dataSummary?.files?.proxies) {
      const match = state.dataSummary.files.proxies.find(p =>
        p === targetProxy || p.replace(/\.(yaml|yml)$/i, '') === targetProxy
      );
      if (match) {
        selectItem('proxies', match);
        if (tab === 'tester') {
          openTestConsole(null, match);
        } else if (tab === 'yaml') {
          switchTab('yaml');
        }
        return true;
      }
    }

    const targetProduct = productName || (hashType === 'product' ? hashResource : null);
    if (targetProduct && state.dataSummary?.files?.products) {
      const match = state.dataSummary.files.products.find(p =>
        p === targetProduct || p.replace(/\.(yaml|yml)$/i, '') === targetProduct
      );
      if (match) {
        selectItem('products', match);
        if (tab === 'yaml') switchTab('yaml');
        return true;
      }
    }

    const targetUser = userName || (hashType === 'user' ? hashResource : null);
    if (targetUser && state.dataSummary?.files?.users) {
      const match = state.dataSummary.files.users.find(u =>
        u === targetUser || u.replace(/\.(yaml|yml)$/i, '') === targetUser
      );
      if (match) {
        selectItem('users', match);
        if (tab === 'yaml') switchTab('yaml');
        return true;
      }
    }

    return false;
  }

  // --------------------------------------------------------------------------
  // Theme Management
  // --------------------------------------------------------------------------
  function initTheme() {
    const savedTheme = localStorage.getItem('aft_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('aft_theme', next);
  }

  // --------------------------------------------------------------------------
  // Data Fetching & State Initialization
  // --------------------------------------------------------------------------
  async function loadRuntimeData() {
    try {
      const res = await fetch('/api/data');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.dataSummary = await res.json();
      state.deploymentTests = state.dataSummary.tests || [];
      renderSidebar();
      updateHeaderCounts();
      loadRecentTraces();

      // Restore selected resource from URL parameters or fallback to defaults
      const restored = restoreResourceFromUrl();
      if (!restored && !state.selectedId) {
        const firstProxy = state.dataSummary.files?.proxies?.[0];
        const firstProduct = state.dataSummary.files?.products?.[0];
        const firstUser = state.dataSummary.files?.users?.[0];
        if (firstProxy) {
          selectItem('proxies', firstProxy);
        } else if (firstProduct) {
          selectItem('products', firstProduct);
        } else if (firstUser) {
          selectItem('users', firstUser);
        }
      }
    } catch (err) {
      console.error('Failed to load runtime data:', err);
    }
  }

  function updateHeaderCounts() {
    if (!state.dataSummary) return;
    const c = state.dataSummary.counts || {};
    if (el.hStatProxies) el.hStatProxies.textContent = `${c.proxies || 0} Proxies`;
    if (el.hStatProducts) el.hStatProducts.textContent = `${c.products || 0} Products`;
    if (el.hStatUsers) el.hStatUsers.textContent = `${c.users || 0} Users`;

    if (el.badgeNavProxies) el.badgeNavProxies.textContent = c.proxies || 0;
    if (el.badgeNavProducts) el.badgeNavProducts.textContent = c.products || 0;
    if (el.badgeNavUsers) el.badgeNavUsers.textContent = c.users || 0;
  }

  // --------------------------------------------------------------------------
  // Mobile / Narrow Viewport Sidebar Management
  // --------------------------------------------------------------------------
  function closeSidebar() {
    el.sidebarNav?.classList.remove('open');
    el.sidebarBackdrop?.classList.remove('active');
  }

  function closeSidebarIfNarrow() {
    if (window.innerWidth <= 850) {
      closeSidebar();
    }
  }

  function toggleSidebar() {
    // If the window is wide enough to show the menu, keep it closed and backdrop hidden
    if (window.innerWidth > 850) {
      closeSidebar();
      return;
    }
    el.sidebarNav?.classList.toggle('open');
    el.sidebarBackdrop?.classList.toggle('active');
  }

  // --------------------------------------------------------------------------
  // Sidebar Rendering & Navigation
  // --------------------------------------------------------------------------
  function renderSidebar() {
    if (!state.dataSummary) return;
    const files = state.dataSummary.files;
    const filter = (el.sidebarSearchInput?.value || '').trim().toLowerCase();

    renderSectionList(el.navItemsProxies, files.proxies || [], 'proxies', filter);
    renderSectionList(el.navItemsProducts, files.products || [], 'products', filter);
    renderSectionList(el.navItemsUsers, files.users || [], 'users', filter);
    renderRecentTraces(state.traces || []);
  }

  function renderSectionList(container, items, category, filter) {
    container.innerHTML = '';
    const filtered = items.filter(name => !filter || name.toLowerCase().includes(filter));

    if (filtered.length === 0) {
      container.innerHTML = `<div style="padding: 6px 12px 6px 28px; font-size: var(--font-xs); color: var(--text-muted);">No matching ${category}</div>`;
      return;
    }

    filtered.forEach(name => {
      const itemEl = document.createElement('div');
      itemEl.className = 'nav-item';
      if (state.selectedCategory === category && state.selectedId === name) {
        itemEl.classList.add('active');
      }

      const cleanName = name.replace(/\.(yaml|yml|json)$/, '');
      itemEl.innerHTML = `
        <span class="nav-item-title" title="${name}">${cleanName}</span>
        <span class="nav-item-sub">.yaml</span>
      `;

      itemEl.addEventListener('click', () => {
        selectItem(category, name);
      });

      container.appendChild(itemEl);
    });
  }

  // --------------------------------------------------------------------------
  // Select Item & Render Main View
  // --------------------------------------------------------------------------
  function getCategorySingular(category) {
    if (category === 'proxies') return 'PROXY';
    if (category === 'products') return 'PRODUCT';
    if (category === 'users') return 'USER';
    if (category.endsWith('ies')) return category.slice(0, -3).toUpperCase() + 'Y';
    if (category.endsWith('s')) return category.slice(0, -1).toUpperCase();
    return category.toUpperCase();
  }

  function getAvailableUrlsForProxy(item, data) {
    if (!item) return [];
    const origin = window.location.origin;
    const paths = new Map(); // path -> { path, fullUrl, label }
    const proxyName = (item.cleanName || item.name || '').replace(/\.(yaml|yml|json)$/i, '');
    const endpoints = data?.endpoints || [];

    if (endpoints.length === 0) {
      const defaultPath = '/' + proxyName;
      paths.set(defaultPath, {
        path: defaultPath,
        fullUrl: `${origin}${defaultPath}`,
        label: 'default'
      });
    } else {
      endpoints.forEach(ep => {
        let base = ep.basePath || '/';
        if (!base.startsWith('/')) base = '/' + base;
        if (base.endsWith('/') && base.length > 1) base = base.slice(0, -1);

        paths.set(base, {
          path: base,
          fullUrl: `${origin}${base}`,
          label: ep.name || 'endpoint'
        });

        // Check conditional flows for proxy.pathsuffix
        const flows = ep.flows || [];
        flows.forEach(fl => {
          if (fl.condition) {
            const matches = fl.condition.matchAll(/proxy\.pathsuffix\s*(?:==|=|!=|MatchesPath)\s*["']([^"']+)["']/gi);
            for (const m of matches) {
              let suffix = m[1];
              if (!suffix.startsWith('/')) suffix = '/' + suffix;
              const fullPath = (base === '/' ? '' : base) + suffix;
              if (!paths.has(fullPath)) {
                paths.set(fullPath, {
                  path: fullPath,
                  fullUrl: `${origin}${fullPath}`,
                  label: fl.name || ep.name || 'flow'
                });
              }
            }
          }
        });
      });
    }

    // Check products for operations referencing this proxy
    if (state.dataSummary?.products) {
      Object.values(state.dataSummary.products).forEach(prod => {
        const pData = prod.parsed || {};
        const allOps = [
          ...(pData.operations || []),
          ...(pData.llmOperations || []),
          ...(pData.payloadOperations || [])
        ];
        allOps.forEach(group => {
          if (group.apiSource === proxyName) {
            (group.operations || []).forEach(op => {
              if (op.name) {
                let opPath = op.name;
                if (opPath === '/') {
                  // Already covered by base
                } else {
                  if (!opPath.startsWith('/')) opPath = '/' + opPath;
                  endpoints.forEach(ep => {
                    let base = ep.basePath || '/';
                    if (base.endsWith('/') && base.length > 1) base = base.slice(0, -1);
                    const fullPath = (base === '/' ? '' : base) + opPath;
                    if (!paths.has(fullPath)) {
                      paths.set(fullPath, {
                        path: fullPath,
                        fullUrl: `${origin}${fullPath}`,
                        label: op.model || group.apiSource || 'operation'
                      });
                    }
                  });
                }
              }
            });
          }
        });
      });
    }

    // Check linked tests
    const tests = getTestsForProxy(proxyName);
    tests.forEach(t => {
      if (t.path) {
        let p = t.path;
        if (!p.startsWith('/')) p = '/' + p;
        if (!paths.has(p)) {
          paths.set(p, {
            path: p,
            fullUrl: `${origin}${p}`,
            label: t.name || 'test'
          });
        }
      }
    });

    return Array.from(paths.values());
  }

  function renderHeaderProxyUrls(item, data) {
    if (!el.headerProxyUrls) return;
    const urls = getAvailableUrlsForProxy(item, data);
    if (urls.length === 0) {
      el.headerProxyUrls.style.display = 'none';
      return;
    }

    el.headerProxyUrls.innerHTML = urls.map(u => `
      <div class="header-url-badge" title="${escapeHtml(u.fullUrl)}">
        <span class="header-url-icon">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </span>
        <span class="header-url-text">${escapeHtml(u.fullUrl)}</span>
        <button class="btn-copy-url" data-url="${escapeHtml(u.fullUrl)}" title="Copy complete URL">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>Copy</span>
        </button>
        <button class="btn-test-url" data-path="${escapeHtml(u.path)}" data-proxy="${escapeHtml(item.name)}" title="Test endpoint in Console">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <span>Test</span>
        </button>
      </div>
    `).join('');

    // Attach copy and test listeners
    el.headerProxyUrls.querySelectorAll('.btn-copy-url').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const urlToCopy = btn.getAttribute('data-url');
        if (!urlToCopy) return;
        try {
          await navigator.clipboard.writeText(urlToCopy);
          const orig = btn.innerHTML;
          btn.innerHTML = '<span>✓ Copied!</span>';
          setTimeout(() => { btn.innerHTML = orig; }, 1800);
        } catch (err) {
          console.warn('Clipboard copy failed:', err);
        }
      });
    });

    el.headerProxyUrls.querySelectorAll('.btn-test-url').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const path = btn.getAttribute('data-path');
        const proxy = btn.getAttribute('data-proxy');
        openTestConsole(path, proxy);
      });
    });

    el.headerProxyUrls.style.display = 'flex';
  }

  function selectItem(category, name) {
    state.selectedCategory = category;
    state.selectedId = name;
    state.selectedTraceId = null;

    const rawYaml = state.dataSummary?.fileContents?.[category]?.[name] || '';
    let parsed = null;
    try {
      if (window.jsyaml && rawYaml) {
        parsed = window.jsyaml.load(rawYaml);
      }
    } catch (e) {
      console.warn('Failed to parse YAML for', name, e);
    }

    state.selectedItem = {
      category,
      name,
      cleanName: name.replace(/\.(yaml|yml|json)$/, ''),
      rawYaml,
      parsed,
    };

    // Update Header Meta
    el.itemTypeBadge.textContent = getCategorySingular(category);
    el.itemTitleDisplay.textContent = state.selectedItem.parsed?.name || state.selectedItem.cleanName;
    el.itemSubpath.textContent = state.selectedItem.parsed?.endpoints?.[0]?.basePath || name;

    // Render complete URLs in header for proxies
    if (category === 'proxies') {
      renderHeaderProxyUrls(state.selectedItem, parsed);
    } else {
      if (el.headerProxyUrls) el.headerProxyUrls.style.display = 'none';
    }

    // Refresh Sidebar active classes
    renderSidebar();

    // Render Views
    renderVisualOverview();
    renderYamlView();

    // If currently on Test Console or tracesList view, switch to overview to show clicked object
    if (state.activeTab === 'tester' || state.activeTab === 'tracesList') {
      switchTab('overview');
    } else {
      syncUrl();
    }

    closeSidebarIfNarrow();
  }

  // --------------------------------------------------------------------------
  // Visual Overview Rendering
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // Visual Overview Helpers & Visual Component Generators
  // --------------------------------------------------------------------------
  function renderMethodBadge(method) {
    const m = (method || 'ANY').toUpperCase();
    let cls = 'method-badge ';
    if (m === 'GET') cls += 'method-get';
    else if (m === 'POST') cls += 'method-post';
    else if (m === 'PUT') cls += 'method-put';
    else if (m === 'DELETE') cls += 'method-delete';
    else if (m === 'PATCH') cls += 'method-patch';
    else cls += 'method-any';
    return `<span class="${cls}">${escapeHtml(m)}</span>`;
  }

  function extractSteps(flowObj) {
    if (!flowObj) return [];
    if (Array.isArray(flowObj.steps)) {
      return flowObj.steps.map(s => typeof s === 'string' ? { name: s } : s);
    }
    const steps = [];
    if (flowObj.request?.steps && Array.isArray(flowObj.request.steps)) {
      steps.push(...flowObj.request.steps.map(s => typeof s === 'string' ? { name: s, phase: 'Request' } : { ...s, phase: 'Request' }));
    }
    if (flowObj.response?.steps && Array.isArray(flowObj.response.steps)) {
      steps.push(...flowObj.response.steps.map(s => typeof s === 'string' ? { name: s, phase: 'Response' } : { ...s, phase: 'Response' }));
    }
    return steps;
  }

  function normalizeFlows(container) {
    const result = {
      preFlow: null,
      conditionalFlows: [],
      postFlow: null,
      eventFlow: null,
      faultRules: [],
      defaultFaultRule: container.defaultFaultRule || null,
    };

    if (container.preFlow) {
      result.preFlow = {
        name: 'PreFlow',
        mode: 'Request & Response',
        steps: extractSteps(container.preFlow),
        condition: container.preFlow.condition || '',
        raw: container.preFlow
      };
    }

    if (container.postFlow) {
      result.postFlow = {
        name: 'PostFlow',
        mode: 'Response',
        steps: extractSteps(container.postFlow),
        condition: container.postFlow.condition || '',
        raw: container.postFlow
      };
    }

    if (Array.isArray(container.flows)) {
      container.flows.forEach(fl => {
        const name = fl.name || 'Flow';
        const lower = name.toLowerCase();
        if (lower === 'preflow') {
          result.preFlow = {
            name: fl.name,
            mode: fl.mode || 'Request',
            steps: extractSteps(fl),
            condition: fl.condition || '',
            raw: fl
          };
        } else if (lower === 'postflow') {
          result.postFlow = {
            name: fl.name,
            mode: fl.mode || 'Response',
            steps: extractSteps(fl),
            condition: fl.condition || '',
            raw: fl
          };
        } else if (lower === 'eventflow') {
          result.eventFlow = {
            name: fl.name,
            mode: fl.mode || 'Response (SSE)',
            steps: extractSteps(fl),
            condition: fl.condition || '',
            raw: fl
          };
        } else {
          result.conditionalFlows.push({
            name: fl.name,
            mode: fl.mode || 'Conditional Flow',
            steps: extractSteps(fl),
            condition: fl.condition || '',
            raw: fl
          });
        }
      });
    }

    if (Array.isArray(container.faultRules)) {
      result.faultRules = container.faultRules;
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Flow Policy Summary & Rendering Helpers
  // --------------------------------------------------------------------------
  function summarizeFlowPolicies(steps, policies) {
    if (!steps || steps.length === 0) {
      return {
        count: 0,
        types: [],
        html: '<span style="font-size: var(--font-xs); color: var(--text-muted); font-style: italic;">No policies</span>'
      };
    }

    const typeCounts = {};
    steps.forEach(s => {
      const stepName = typeof s === 'string' ? s : s.name;
      const pol = (policies || []).find(p => p.name === stepName);
      const polType = pol?.type || s.type || 'Policy';
      typeCounts[polType] = (typeCounts[polType] || 0) + 1;
    });

    const entries = Object.entries(typeCounts);
    const badges = entries.map(([type, count]) => {
      return `<span class="step-type-pill">${escapeHtml(type)}${count > 1 ? ` (${count})` : ''}</span>`;
    }).join(' ');

    const countLabel = steps.length === 1 ? '1 policy' : `${steps.length} policies`;

    const html = `
      <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
        <span style="font-size: var(--font-xs); font-weight: 600; color: var(--text-sub);">${countLabel}:</span>
        <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
          ${badges}
        </div>
      </div>
    `;

    return {
      count: steps.length,
      types: Object.keys(typeCounts),
      html
    };
  }

  function renderFlowSummaryRow(title, mode, condition, steps, policies, rawObj) {
    const summary = summarizeFlowPolicies(steps, policies);
    const modeClass = mode && mode.toLowerCase().includes('fault')
      ? 'flow-mode-fault'
      : mode && mode.toLowerCase().includes('response')
      ? 'flow-mode-response'
      : 'flow-mode-request';

    return `
      <div class="flow-summary-row">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span style="font-weight: 600; font-size: var(--font-sm); font-family: var(--font-mono);">${escapeHtml(title)}</span>
          <span class="flow-mode-badge ${modeClass}" style="font-size: var(--font-2xs); padding: 1px 6px;">${escapeHtml(mode || 'FLOW')}</span>
          ${condition ? `<span class="step-condition-pill" title="${escapeHtml(condition)}" style="font-size: var(--font-2xs);">⚡ ${escapeHtml(condition)}</span>` : ''}
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          ${summary.html}
          ${rawObj ? renderSnippetButton(title, 'FLOW', rawObj) : ''}
        </div>
      </div>
    `;
  }

  function renderFaultRulesSummary(defaultFaultRule, faultRules, policies) {
    if (!defaultFaultRule && (!faultRules || faultRules.length === 0)) {
      return '';
    }

    let html = `
      <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--border-light);">
        <div style="font-size: var(--font-xs); font-weight: 600; color: var(--text-sub); margin-bottom: 6px;">Fault Handling & Error Rules</div>
    `;

    if (defaultFaultRule) {
      const summary = summarizeFlowPolicies(defaultFaultRule.steps || [], policies);
      html += `
        <div class="flow-summary-row">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 600; font-size: var(--font-sm); font-family: var(--font-mono);">DefaultFaultRule</span>
            <span class="flow-mode-badge flow-mode-fault" style="font-size: var(--font-2xs); padding: 1px 6px;">FAULT</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            ${summary.html}
            ${renderSnippetButton('Default Fault Rule', 'FAULT_RULE', defaultFaultRule)}
          </div>
        </div>
      `;
    }

    if (Array.isArray(faultRules) && faultRules.length > 0) {
      faultRules.forEach(fr => {
        const summary = summarizeFlowPolicies(fr.steps || [], policies);
        html += `
          <div class="flow-summary-row">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: 600; font-size: var(--font-sm); font-family: var(--font-mono);">${escapeHtml(fr.name || 'FaultRule')}</span>
              <span class="flow-mode-badge flow-mode-fault" style="font-size: var(--font-2xs); padding: 1px 6px;">FAULT</span>
              ${fr.condition ? `<span class="step-condition-pill" style="font-size: var(--font-2xs);">⚡ ${escapeHtml(fr.condition)}</span>` : ''}
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              ${summary.html}
              ${renderSnippetButton(`Fault Rule: ${fr.name}`, 'FAULT_RULE', fr)}
            </div>
          </div>
        `;
      });
    }

    html += `</div>`;
    return html;
  }

  // --------------------------------------------------------------------------
  // Visual Overview Rendering
  // --------------------------------------------------------------------------
  function renderVisualOverview() {
    const item = state.selectedItem;
    if (!item) return;

    const data = item.parsed || {};

    if (item.category === 'proxies') {
      renderProxyOverview(item, data);
    } else if (item.category === 'products') {
      renderProductOverview(item, data);
    } else if (item.category === 'users') {
      renderUserOverview(item, data);
    }
  }

  function renderProxyOverview(item, data) {
    const endpoints = data.endpoints || [];
    const targets = data.targets || [];
    const policies = data.policies || [];

    // Count total routes
    let totalRoutes = 0;
    endpoints.forEach(ep => {
      totalRoutes += (ep.routes || []).length;
    });

    let endpointsHtml = '';
    endpoints.forEach(ep => {
      const routes = ep.routes || [];
      const epFlows = normalizeFlows(ep);

      let routesHtml = '';
      if (routes.length > 0) {
        routesHtml = `
          <div style="margin-top: 10px;">
            <div style="font-size: var(--font-sm); font-weight: 600; color: var(--text-sub); margin-bottom: 6px;">Route Rules (${routes.length})</div>
            <div class="routes-container">
              ${routes.map(r => `
                <div class="route-card">
                  <div class="route-left">
                    <span class="route-name">${escapeHtml(r.name || 'default')}</span>
                    <span class="route-target-pill">Target: <strong>${escapeHtml(r.target || 'Direct Response (No Target)')}</strong></span>
                    ${r.condition ? `<span class="step-condition-pill" title="${escapeHtml(r.condition)}">⚡ ${escapeHtml(r.condition)}</span>` : '<span style="font-size: var(--font-xs); color: var(--text-muted); font-style: italic;">Default route</span>'}
                  </div>
                  <div>
                    ${renderSnippetButton(`Route: ${r.name || 'default'}`, 'ROUTE', r)}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      let flowsHtml = `
        <div style="margin-top: 12px;">
          <div style="font-size: var(--font-sm); font-weight: 600; color: var(--text-sub); margin-bottom: 6px;">Flow Policy Summary</div>
      `;

      if (epFlows.preFlow) {
        flowsHtml += renderFlowSummaryRow('PreFlow', epFlows.preFlow.mode, epFlows.preFlow.condition, epFlows.preFlow.steps, policies, epFlows.preFlow.raw);
      }

      if (epFlows.conditionalFlows.length > 0) {
        epFlows.conditionalFlows.forEach(fl => {
          flowsHtml += renderFlowSummaryRow(fl.name, fl.mode, fl.condition, fl.steps, policies, fl.raw);
        });
      }

      if (epFlows.postFlow) {
        flowsHtml += renderFlowSummaryRow('PostFlow', epFlows.postFlow.mode, epFlows.postFlow.condition, epFlows.postFlow.steps, policies, epFlows.postFlow.raw);
      }

      if (epFlows.defaultFaultRule || epFlows.faultRules.length > 0) {
        flowsHtml += renderFaultRulesSummary(epFlows.defaultFaultRule, epFlows.faultRules, policies);
      }

      flowsHtml += '</div>';

      endpointsHtml += `
        <div class="endpoint-card">
          <div class="endpoint-top">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span class="endpoint-path">${escapeHtml(ep.basePath || '/')}</span>
              <span class="badge badge-subtle">${escapeHtml(ep.name || 'default')}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <button class="btn btn-secondary btn-sm btn-test-this-endpoint" data-path="${escapeHtml(ep.basePath || '/')}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span>Test Endpoint</span>
              </button>
              ${renderSnippetButton(`Endpoint: ${ep.name || 'default'}`, 'ENDPOINT', ep)}
            </div>
          </div>
          ${routesHtml}
          ${flowsHtml}
        </div>
      `;
    });

    let targetsHtml = '';
    targets.forEach(tgt => {
      const tgtFlows = normalizeFlows(tgt);
      let tgtFlowsHtml = `
        <div style="margin-top: 10px;">
          <div style="font-size: var(--font-sm); font-weight: 600; color: var(--text-sub); margin-bottom: 6px;">Target Flow Policy Summary</div>
      `;

      let hasTargetFlows = false;
      if (tgtFlows.preFlow) {
        hasTargetFlows = true;
        tgtFlowsHtml += renderFlowSummaryRow('Target PreFlow', tgtFlows.preFlow.mode, tgtFlows.preFlow.condition, tgtFlows.preFlow.steps, policies, tgtFlows.preFlow.raw);
      }
      if (tgtFlows.eventFlow) {
        hasTargetFlows = true;
        tgtFlowsHtml += renderFlowSummaryRow('Target EventFlow (SSE)', tgtFlows.eventFlow.mode, tgtFlows.eventFlow.condition, tgtFlows.eventFlow.steps, policies, tgtFlows.eventFlow.raw);
      }
      if (tgtFlows.conditionalFlows.length > 0) {
        tgtFlows.conditionalFlows.forEach(fl => {
          hasTargetFlows = true;
          tgtFlowsHtml += renderFlowSummaryRow(`Target Flow: ${fl.name}`, fl.mode, fl.condition, fl.steps, policies, fl.raw);
        });
      }
      if (tgtFlows.postFlow) {
        hasTargetFlows = true;
        tgtFlowsHtml += renderFlowSummaryRow('Target PostFlow', tgtFlows.postFlow.mode, tgtFlows.postFlow.condition, tgtFlows.postFlow.steps, policies, tgtFlows.postFlow.raw);
      }
      if (tgtFlows.defaultFaultRule || tgtFlows.faultRules.length > 0) {
        hasTargetFlows = true;
        tgtFlowsHtml += renderFaultRulesSummary(tgtFlows.defaultFaultRule, tgtFlows.faultRules, policies);
      }

      tgtFlowsHtml += '</div>';

      targetsHtml += `
        <div class="endpoint-card">
          <div class="endpoint-top">
            <div>
              <span style="font-weight: 600; font-size: var(--font-base); font-family: var(--font-mono);">${escapeHtml(tgt.name || 'target')}</span>
              <div style="font-size: var(--font-xs); color: var(--text-muted); margin-top: 3px;">
                URL: <a href="${escapeHtml(tgt.url || '#')}" target="_blank" rel="noopener" style="color: var(--primary); font-family: var(--font-mono);">${escapeHtml(tgt.url || 'No URL')}</a>
              </div>
            </div>
            <div>
              ${renderSnippetButton(`Target: ${tgt.name}`, 'TARGET', tgt)}
            </div>
          </div>
          ${hasTargetFlows ? tgtFlowsHtml : ''}
        </div>
      `;
    });

    const proxyTests = getTestsForProxy(item.name);
    const availableUrls = getAvailableUrlsForProxy(item, data);

    el.overviewContainer.innerHTML = `
      <div class="overview-header-card">
        <div class="overview-header-top">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span class="badge badge-outline">PROXY</span>
              ${data.displayName ? `<span class="badge badge-subtle">${escapeHtml(data.name || item.cleanName)}</span>` : ''}
              ${proxyTests.length > 0 ? `<span class="badge badge-primary">${proxyTests.length} Linked Test${proxyTests.length > 1 ? 's' : ''}</span>` : ''}
            </div>
            <h2 class="overview-title">${escapeHtml(data.displayName || data.name || item.cleanName)}</h2>
            <p class="overview-desc">${escapeHtml(data.description || 'Configured API Proxy endpoint and routing flows.')}</p>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="btn btn-primary btn-sm btn-open-tester">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span>Test Proxy</span>
              ${proxyTests.length > 0 ? `<span class="badge" style="margin-left: 6px; background: rgba(255,255,255,0.25);">${proxyTests.length} tests</span>` : ''}
            </button>
            ${renderSnippetButton(`Proxy: ${data.name || item.cleanName}`, 'PROXY', data, 'Proxy YAML')}
          </div>
        </div>

        ${availableUrls.length > 0 ? `
          <div class="overview-proxy-urls" style="margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-light);">
            <div style="font-size: var(--font-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 8px;">Available Complete URLs</div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
              ${availableUrls.map(u => `
                <div class="header-url-badge" style="padding: 4px 10px; font-size: 12px;" title="${escapeHtml(u.fullUrl)}">
                  <span class="header-url-icon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                  </span>
                  <span class="header-url-text" style="font-size: 12px;">${escapeHtml(u.fullUrl)}</span>
                  <button class="btn-copy-url btn-ov-copy" data-url="${escapeHtml(u.fullUrl)}" title="Copy URL">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    <span>Copy</span>
                  </button>
                  <button class="btn-test-url btn-ov-test" data-path="${escapeHtml(u.path)}" data-proxy="${escapeHtml(item.name)}" title="Test endpoint in Console">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    <span>Test</span>
                  </button>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="overview-stats-grid">
          <div class="stat-box">
            <div class="stat-box-label">Base Endpoints</div>
            <div class="stat-box-val">${endpoints.length}</div>
          </div>
          <div class="stat-box">
            <div class="stat-box-label">Route Rules</div>
            <div class="stat-box-val">${totalRoutes}</div>
          </div>
          <div class="stat-box">
            <div class="stat-box-label">Linked Tests</div>
            <div class="stat-box-val" style="color: ${proxyTests.length > 0 ? 'var(--primary)' : 'var(--text-muted)'};">${proxyTests.length}</div>
          </div>
          <div class="stat-box">
            <div class="stat-box-label">Upstream Targets</div>
            <div class="stat-box-val">${targets.length}</div>
          </div>
          <div class="stat-box">
            <div class="stat-box-label">Configured Policies</div>
            <div class="stat-box-val">${policies.length}</div>
          </div>
        </div>
      </div>

      <div class="resource-card">
        <div class="card-heading">
          <h3>Endpoints & Routes</h3>
        </div>
        ${endpointsHtml || '<div style="color: var(--text-muted); font-size: var(--font-sm);">No endpoints configured</div>'}
      </div>

      <div class="resource-card">
        <div class="card-heading">
          <h3>Upstream Targets</h3>
        </div>
        ${targetsHtml || '<div style="color: var(--text-muted); font-size: var(--font-sm);">No upstream targets configured (Direct response proxy)</div>'}
      </div>
    `;

    // Attach listeners to test endpoint buttons
    el.overviewContainer.querySelectorAll('.btn-test-this-endpoint').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const path = e.currentTarget.getAttribute('data-path');
        openTestConsole(path, item.name);
      });
    });

    el.overviewContainer.querySelectorAll('.btn-ov-copy').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const urlToCopy = btn.getAttribute('data-url');
        if (!urlToCopy) return;
        try {
          await navigator.clipboard.writeText(urlToCopy);
          const orig = btn.innerHTML;
          btn.innerHTML = '<span>✓ Copied!</span>';
          setTimeout(() => { btn.innerHTML = orig; }, 1800);
        } catch (err) {
          console.warn('Clipboard copy failed:', err);
        }
      });
    });

    el.overviewContainer.querySelectorAll('.btn-ov-test').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const path = btn.getAttribute('data-path');
        const proxy = btn.getAttribute('data-proxy');
        openTestConsole(path, proxy);
      });
    });

    const openTesterBtn = el.overviewContainer.querySelector('.btn-open-tester');
    if (openTesterBtn) {
      openTesterBtn.addEventListener('click', () => {
        const firstPath = endpoints[0]?.basePath || '/';
        openTestConsole(firstPath, item.name);
      });
    }
  }

  function renderProductOverview(item, data) {
    const proxies = data.proxies || [];
    const environments = data.environments || [];
    const quota = data.quota || {};
    const operations = data.operations || [];
    const llmOperations = data.llmOperations || [];
    const payloadOperations = data.payloadOperations || [];

    const totalOps = operations.reduce((sum, g) => sum + (g.operations?.length || 0), 0);
    const totalLlmOps = llmOperations.reduce((sum, g) => sum + (g.operations?.length || 0), 0);
    const totalPayloadOps = payloadOperations.reduce((sum, g) => sum + (g.operations?.length || 0), 0);

    // Standard Operations HTML
    let standardOpsHtml = '';
    if (operations.length > 0) {
      standardOpsHtml = `
        <div class="resource-card">
          <div class="card-heading">
            <h3>Standard HTTP Operations</h3>
          </div>
          ${operations.map(group => {
            const items = group.operations || [];
            return `
              <div class="op-group-card">
                <div class="op-group-header">
                  <div class="op-group-title">
                    <span>API Source:</span>
                    <span class="op-api-source">${escapeHtml(group.apiSource || 'All Proxies')}</span>
                  </div>
                  ${renderSnippetButton(`Operations: ${group.apiSource}`, 'OPERATIONS', group)}
                </div>
                <table class="op-items-table op-table-standard">
                  <colgroup>
                    <col style="width: 42%;">
                    <col style="width: 26%;">
                    <col style="width: 32%;">
                  </colgroup>
                  <thead>
                    <tr>
                      <th style="width: 42%;">Resource Path</th>
                      <th style="width: 26%;">Allowed Methods</th>
                      <th style="width: 32%;">Operation Quota</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${items.map(op => {
                      const methods = op.methods || ['ALL'];
                      const opQuota = op.quota ? `${op.quota.limit || 0} / ${op.quota.interval || 1} ${op.quota.timeUnit || 'min'}` : 'Inherits Product Quota';
                      return `
                        <tr>
                          <td style="width: 42%; font-family: var(--font-mono); font-weight: 600;">${escapeHtml(op.name || '/')}</td>
                          <td style="width: 26%;">${methods.map(m => renderMethodBadge(m)).join(' ')}</td>
                          <td style="width: 32%;"><span class="quota-pill">${escapeHtml(opQuota)}</span></td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // LLM Operations HTML
    let llmOpsHtml = '';
    if (llmOperations.length > 0) {
      llmOpsHtml = `
        <div class="resource-card">
          <div class="card-heading">
            <h3>LLM Model Operations & Token Quotas</h3>
          </div>
          ${llmOperations.map(group => {
            const items = group.operations || [];
            const tokenQuota = group.llmTokenQuota;
            const quotaText = tokenQuota ? `${tokenQuota.limit || 0} tokens / ${tokenQuota.interval || 1} ${tokenQuota.timeUnit || 'min'}` : 'Inherits Global Quota';
            return `
              <div class="op-group-card">
                <div class="op-group-header">
                  <div class="op-group-title">
                    <span>API Source:</span>
                    <span class="op-api-source">${escapeHtml(group.apiSource || 'AI Proxy')}</span>
                    <span class="quota-pill" style="margin-left: 8px;">Token Quota: ${escapeHtml(quotaText)}</span>
                  </div>
                  ${renderSnippetButton(`LLM Operations: ${group.apiSource}`, 'LLM_OPERATIONS', group)}
                </div>
                <table class="op-items-table op-table-llm">
                  <colgroup>
                    <col style="width: 28%;">
                    <col style="width: 24%;">
                    <col style="width: 18%;">
                    <col style="width: 30%;">
                  </colgroup>
                  <thead>
                    <tr>
                      <th style="width: 28%;">Target Model</th>
                      <th style="width: 24%;">Path</th>
                      <th style="width: 18%;">Methods</th>
                      <th style="width: 30%;">Model Token Quota</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${items.map(op => {
                      const methods = op.methods || ['POST'];
                      return `
                        <tr>
                          <td style="width: 28%;"><span class="model-badge">${escapeHtml(op.model || 'Default Model')}</span></td>
                          <td style="width: 24%; font-family: var(--font-mono);">${escapeHtml(op.name || '/')}</td>
                          <td style="width: 18%;">${methods.map(m => renderMethodBadge(m)).join(' ')}</td>
                          <td style="width: 30%;"><span class="quota-pill">${escapeHtml(quotaText)}</span></td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // Payload / MCP Operations HTML
    let payloadOpsHtml = '';
    if (payloadOperations.length > 0) {
      payloadOpsHtml = `
        <div class="resource-card">
          <div class="card-heading">
            <h3>Payload & MCP Tool Operations</h3>
          </div>
          ${payloadOperations.map(group => {
            const items = group.operations || [];
            return `
              <div class="op-group-card">
                <div class="op-group-header">
                  <div class="op-group-title">
                    <span>API Source:</span>
                    <span class="op-api-source">${escapeHtml(group.apiSource || 'MCP Proxy')}</span>
                    <span class="protocol-badge">${escapeHtml(group.protocol || 'MCP')}</span>
                  </div>
                  ${renderSnippetButton(`Payload Operations: ${group.apiSource}`, 'PAYLOAD_OPERATIONS', group)}
                </div>
                <table class="op-items-table op-table-payload">
                  <colgroup>
                    <col style="width: 44%;">
                    <col style="width: 24%;">
                    <col style="width: 32%;">
                  </colgroup>
                  <thead>
                    <tr>
                      <th style="width: 44%;">Operation / Tool Name</th>
                      <th style="width: 24%;">Protocol</th>
                      <th style="width: 32%;">Operation Quota</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${items.map(op => {
                      const opQuota = op.quota ? `${op.quota.limit || 0} / ${op.quota.interval || 1} ${op.quota.timeUnit || 'min'}` : 'Inherits Product Quota';
                      return `
                        <tr>
                          <td style="width: 44%; font-family: var(--font-mono); font-weight: 600;">${escapeHtml(op.name || '/')}</td>
                          <td style="width: 24%;"><span class="protocol-badge">${escapeHtml(group.protocol || 'MCP')}</span></td>
                          <td style="width: 32%;"><span class="quota-pill">${escapeHtml(opQuota)}</span></td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const quotaStr = quota.limit
      ? `${quota.limit} / ${quota.interval || 1} ${quota.timeUnit || 'min'}`
      : (data.quota && typeof data.quota === 'string' ? data.quota : 'Unlimited');

    el.overviewContainer.innerHTML = `
      <div class="overview-header-card">
        <div class="overview-header-top">
          <div>
            <span class="badge badge-outline">API PRODUCT</span>
            <h2 class="overview-title">${escapeHtml(data.displayName || data.name || item.cleanName)}</h2>
            <p class="overview-desc">${escapeHtml(data.description || 'API product packaging for client authorization and quotas.')}</p>
          </div>
          <div>
            ${renderSnippetButton(`Product: ${data.name || item.cleanName}`, 'PRODUCT', data, 'Product YAML')}
          </div>
        </div>

        <div class="overview-stats-grid">
          <div class="stat-box">
            <div class="stat-box-label">Rate Quota Limit</div>
            <div class="stat-box-val">${escapeHtml(quotaStr)}</div>
          </div>
          <div class="stat-box">
            <div class="stat-box-label">Approval Type</div>
            <div class="stat-box-val">${escapeHtml(data.approvalType || 'auto')}</div>
          </div>
          <div class="stat-box">
            <div class="stat-box-label">Access Level</div>
            <div class="stat-box-val">${escapeHtml(data.access || 'public')}</div>
          </div>
          <div class="stat-box">
            <div class="stat-box-label">Bound Proxies</div>
            <div class="stat-box-val">${proxies.length}</div>
          </div>
        </div>
      </div>

      <div class="resource-card">
        <div class="card-heading">
          <h3>Bound Proxies & Environments</h3>
        </div>
        <div style="margin-bottom: 12px;">
          <div style="font-size: var(--font-xs); color: var(--text-muted); margin-bottom: 6px; font-weight: 600;">INCLUDED PROXIES (Click to View):</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${proxies.map(p => `
              <button class="btn btn-secondary btn-sm btn-jump-to-proxy" data-proxy="${escapeHtml(p)}" style="font-family: var(--font-mono); font-size: var(--font-sm);">
                <span>${escapeHtml(p)}</span>
                <span style="opacity: 0.6;">&rarr;</span>
              </button>
            `).join('') || '<span style="color: var(--text-muted); font-size: var(--font-sm);">No proxies assigned</span>'}
          </div>
        </div>
        ${environments.length > 0 ? `
          <div style="margin-top: 8px;">
            <div style="font-size: var(--font-xs); color: var(--text-muted); margin-bottom: 6px; font-weight: 600;">DEPLOYED ENVIRONMENTS:</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              ${environments.map(env => `<span class="badge badge-subtle">${escapeHtml(env)}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      ${standardOpsHtml}
      ${llmOpsHtml}
      ${payloadOpsHtml}
    `;
  }

  function renderUserOverview(item, data) {
    const apps = data.apps || [];

    let appsHtml = '';
    apps.forEach(app => {
      const credentials = app.credentials || [];
      appsHtml += `
        <div class="endpoint-card">
          <div class="endpoint-top">
            <div>
              <span style="font-weight: 600; font-size: var(--font-base);">${escapeHtml(app.name || 'App')}</span>
              <span class="badge badge-subtle" style="margin-left: 8px;">${escapeHtml(app.status || 'approved')}</span>
            </div>
            <div>
              ${renderSnippetButton(`App: ${app.name}`, 'APP', app)}
            </div>
          </div>

          ${credentials.map(c => `
            <div style="margin-top: 8px; padding: 10px; background: var(--bg-surface); border-radius: var(--radius-sm); border: 1px solid var(--border-light); font-size: var(--font-sm);">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <span style="color: var(--text-muted); font-weight: 600;">API Key (Consumer Key):</span>
                <button class="btn btn-secondary btn-sm btn-copy-key" data-key="${escapeHtml(c.consumerKey || '')}">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  <span>Copy Key</span>
                </button>
              </div>
              <div style="font-family: var(--font-mono); font-size: var(--font-base); word-break: break-all; color: var(--primary); font-weight: 600;">
                ${escapeHtml(c.consumerKey || 'N/A')}
              </div>
              ${c.apiProducts ? `
                <div style="margin-top: 8px; color: var(--text-muted);">
                  Products: ${c.apiProducts.map(p => `<span class="badge badge-subtle" style="margin-right: 4px;">${escapeHtml(p.apiproduct || p)}</span>`).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
    });

    el.overviewContainer.innerHTML = `
      <div class="overview-header-card">
        <div class="overview-header-top">
          <div>
            <span class="badge badge-outline">DEVELOPER USER</span>
            <h2 class="overview-title">${escapeHtml(data.firstName ? `${data.firstName} ${data.lastName || ''}` : item.cleanName)}</h2>
            <p class="overview-desc">${escapeHtml(data.email || 'Developer account with authorized apps & API keys.')}</p>
          </div>
          <div>
            ${renderSnippetButton(`User: ${data.email || item.cleanName}`, 'USER', data, 'User YAML')}
          </div>
        </div>

        <div class="overview-stats-grid">
          <div class="stat-box">
            <div class="stat-box-label">Status</div>
            <div class="stat-box-val">${escapeHtml(data.status || 'active')}</div>
          </div>
          <div class="stat-box">
            <div class="stat-box-label">Registered Apps</div>
            <div class="stat-box-val">${apps.length}</div>
          </div>
        </div>
      </div>

      <div class="resource-card">
        <div class="card-heading">
          <h3>Registered Developer Apps & Keys</h3>
        </div>
        ${appsHtml || '<div style="color: var(--text-muted); font-size: var(--font-sm);">No registered apps found</div>'}
      </div>
    `;

    // Attach copy key listeners
    el.overviewContainer.querySelectorAll('.btn-copy-key').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const key = e.currentTarget.getAttribute('data-key');
        if (key) {
          navigator.clipboard.writeText(key);
          const span = e.currentTarget.querySelector('span');
          const orig = span.textContent;
          span.textContent = 'Copied!';
          setTimeout(() => { span.textContent = orig; }, 1500);
        }
      });
    });
  }

  // --------------------------------------------------------------------------
  // YAML View Rendering
  // --------------------------------------------------------------------------
  function renderYamlView() {
    if (!state.selectedItem) return;
    el.yamlFilenameLabel.textContent = state.selectedItem.name;
    el.yamlCodeView.textContent = state.selectedItem.rawYaml || '# Empty or unreadable file';
  }

  // --------------------------------------------------------------------------
  // Tab Switching
  // --------------------------------------------------------------------------
  function switchTab(tab) {
    state.activeTab = tab;

    el.tabBtnOverview.classList.toggle('active', tab === 'overview');
    el.tabBtnYaml.classList.toggle('active', tab === 'yaml');
    el.tabBtnTester.classList.toggle('active', tab === 'tester');

    el.paneOverview.classList.toggle('active', tab === 'overview');
    el.paneYaml.classList.toggle('active', tab === 'yaml');
    el.paneTester.classList.toggle('active', tab === 'tester');
    el.paneTracesList.classList.toggle('active', tab === 'tracesList');

    if (tab === 'tracesList') {
      loadRecentTraces();
      if (state.selectedTraceId) {
        showTraceDetailView();
      } else {
        showTracesListView();
      }
    }

    syncUrl();
  }

  // --------------------------------------------------------------------------
  // Linked Deployment Tests & Postman-Style Test Console
  // --------------------------------------------------------------------------
  function getTestsForProxy(proxyName) {
    if (!proxyName) return [];
    const cleanName = proxyName.replace(/\.ya?ml$/i, '');
    const tests = state.deploymentTests || [];
    return tests.filter(t => {
      const p = (t.proxy || '').replace(/\.ya?ml$/i, '');
      return p === cleanName;
    });
  }

  function openTestConsole(path, proxyName) {
    switchTab('tester');
    closeSidebarIfNarrow();

    const targetProxy = proxyName || (state.selectedCategory === 'proxies' ? state.selectedItem?.name : null) || state.currentProxyName;
    if (targetProxy) {
      state.currentProxyName = targetProxy.replace(/\.ya?ml$/i, '');
    }

    // Render linked tests for the proxy
    renderProxyTests(state.currentProxyName);

    const tests = getTestsForProxy(state.currentProxyName);
    if (tests.length > 0) {
      // Automatically select and load the first test in the Test Console (or matching test if path provided)
      const selectedTest = (path ? tests.find(t => t.path === path) : null) || tests[0];
      loadTestIntoConsole(selectedTest);
      if (path && !selectedTest.path) {
        const origin = window.location.origin;
        const cleanPath = path.startsWith('/') ? path : '/' + path;
        el.testerUrlInput.value = `${origin}${cleanPath}`;
      }
    } else {
      resetActiveTest();
      if (path) {
        const origin = window.location.origin;
        const cleanPath = path.startsWith('/') ? path : '/' + path;
        el.testerUrlInput.value = `${origin}${cleanPath}`;
        if (cleanPath.includes('completions') || cleanPath.includes('chat')) {
          el.testerVerbSelect.value = 'POST';
          if (!el.testerBodyTextarea.value.trim()) {
            el.testerBodyTextarea.value = JSON.stringify({
              model: "google/gemini-3.8-flash",
              stream: true,
              max_tokens: 100,
              messages: [
                { role: "user", content: "Why is the sky blue?" }
              ]
            }, null, 2);
          }
        }
      }

      // If headers table is empty, initialize default headers
      if (el.headersTableBody.querySelectorAll('tr').length === 0) {
        initDefaultHeaders();
      }
    }

    syncUrl();
  }

  function renderProxyTests(proxyName) {
    if (!el.proxyTestsCard) return;

    if (!proxyName) {
      el.proxyTestsCard.style.display = 'none';
      return;
    }

    const cleanProxy = proxyName.replace(/\.ya?ml$/i, '');
    const tests = getTestsForProxy(cleanProxy);

    if (tests.length === 0) {
      el.proxyTestsCard.style.display = 'none';
      return;
    }

    el.proxyTestsCard.style.display = 'block';
    el.proxyTestsTitle.textContent = `Deployment Tests (${cleanProxy})`;
    el.proxyTestsCountBadge.textContent = `${tests.length} ${tests.length === 1 ? 'test' : 'tests'}`;
    el.proxyTestsGrid.innerHTML = '';

    tests.forEach(test => {
      const card = document.createElement('div');
      card.className = 'proxy-test-item-card';
      card.setAttribute('data-test-name', test.name);

      const runResult = state.testRunResults.get(test.name);
      let pillClass = 'test-pill-ready';
      let pillText = 'Ready';

      if (runResult) {
        if (runResult.running) {
          pillClass = 'test-pill-running';
          pillText = 'Running...';
        } else if (runResult.passed) {
          pillClass = 'test-pill-passed';
          pillText = `✓ Passed (${runResult.status} • ${runResult.durationMs}ms)`;
        } else {
          pillClass = 'test-pill-failed';
          pillText = `✗ Failed (${runResult.status || 'ERR'} • ${runResult.durationMs || 0}ms)`;
        }
      }

      // Payload snippet
      let payloadPreview = '(No payload)';
      if (test.payload) {
        try {
          const parsed = JSON.parse(test.payload);
          payloadPreview = JSON.stringify(parsed);
        } catch {
          payloadPreview = test.payload.replace(/\s+/g, ' ').trim();
        }
        if (payloadPreview.length > 70) {
          payloadPreview = payloadPreview.slice(0, 70) + '...';
        }
      }

      // Assertions tags
      const assertions = test.assertions && test.assertions.length > 0 ? test.assertions : ['status.code == 200'];
      const assertionsHtml = assertions.map(a =>
        `<span class="test-assertion-tag">${escapeHtml(a)}</span>`
      ).join(' ');

      const verbClass = (test.verb || 'GET').toLowerCase();

      card.innerHTML = `
        <div class="test-item-header">
          <div class="test-item-title-group">
            <span class="route-verb verb-${verbClass}">${escapeHtml(test.verb || 'POST')}</span>
            <span class="test-item-name" title="${escapeHtml(test.name)}">${escapeHtml(test.name)}</span>
          </div>
          <span class="test-pill ${pillClass}" id="pill_${escapeHtml(test.name)}">${escapeHtml(pillText)}</span>
        </div>
        <div class="test-item-details">
          ${test.payload ? `<div class="test-item-payload-preview" title="${escapeHtml(test.payload)}">${escapeHtml(payloadPreview)}</div>` : ''}
          <div class="test-item-assertions-list">
            ${assertionsHtml}
          </div>
        </div>
        <div class="test-item-actions">
          <div class="test-item-buttons-group">
            <button class="btn btn-primary btn-sm btn-run-single-test" data-test-name="${escapeHtml(test.name)}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span>Run Test</span>
            </button>
            <button class="btn btn-secondary btn-sm btn-load-single-test" data-test-name="${escapeHtml(test.name)}">
              <span>Load in Console</span>
            </button>
          </div>
          ${runResult?.traceId ? `
            <button class="btn btn-subtle-sm btn-view-trace-test" data-trace-id="${escapeHtml(runResult.traceId)}">
              <span>View Trace</span>
            </button>
          ` : ''}
        </div>
      `;

      // Event: Run
      card.querySelector('.btn-run-single-test').addEventListener('click', (e) => {
        e.stopPropagation();
        runSingleTest(test, card);
      });

      // Event: Load in Console
      card.querySelector('.btn-load-single-test').addEventListener('click', (e) => {
        e.stopPropagation();
        loadTestIntoConsole(test);
      });

      // Event: View Trace if present
      const traceBtn = card.querySelector('.btn-view-trace-test');
      if (traceBtn) {
        traceBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const traceId = traceBtn.getAttribute('data-trace-id');
          if (traceId) {
            switchResSubtab('trace');
            loadTraceDetail(traceId);
          }
        });
      }

      el.proxyTestsGrid.appendChild(card);
    });
  }

  function loadTestIntoConsole(test) {
    state.activeTest = test;
    state.activeTestAssertions = test.assertions || ['status.code == 200'];

    // Resolve URL path
    const origin = window.location.origin;
    let targetPath = test.path;
    if (!targetPath) {
      // Find proxy's first endpoint basePath
      const cleanProxy = (test.proxy || '').replace(/\.ya?ml$/i, '');
      const rawYaml = state.dataSummary?.fileContents?.proxies?.[cleanProxy + '.yaml'] ||
                      state.dataSummary?.fileContents?.proxies?.[cleanProxy + '.yml'];
      if (rawYaml && window.jsyaml) {
        try {
          const doc = window.jsyaml.load(rawYaml);
          if (doc?.endpoints?.[0]?.basePath) {
            targetPath = doc.endpoints[0].basePath;
          }
        } catch {}
      }
    }
    if (!targetPath) {
      targetPath = '/v1/chat/completions';
    }
    const cleanPath = targetPath.startsWith('/') ? targetPath : '/' + targetPath;
    el.testerUrlInput.value = `${origin}${cleanPath}`;

    // Verb
    el.testerVerbSelect.value = (test.verb || 'POST').toUpperCase();

    // Headers
    el.headersTableBody.innerHTML = '';
    const headers = test.headers || {};
    let hasContentType = false;
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === 'content-type') hasContentType = true;
      addHeaderRow(k, v);
    }
    if (!hasContentType && (el.testerVerbSelect.value === 'POST' || el.testerVerbSelect.value === 'PUT')) {
      addHeaderRow('Content-Type', 'application/json');
    }
    updateHeadersBadge();

    // Body
    if (test.payload) {
      try {
        const json = JSON.parse(test.payload);
        el.testerBodyTextarea.value = JSON.stringify(json, null, 2);
      } catch {
        el.testerBodyTextarea.value = test.payload;
      }
      switchReqSubtab('body');
    }

    // Active Test Banner
    el.activeTestNameDisplay.textContent = test.name;
    el.activeTestAssertionsDisplay.textContent = `Assertions: ${(test.assertions || ['status.code == 200']).join(', ')}`;
    el.activeTestBanner.style.display = 'flex';

    // Highlight card
    el.proxyTestsGrid?.querySelectorAll('.proxy-test-item-card')?.forEach(c => {
      c.classList.toggle('active-selected', c.getAttribute('data-test-name') === test.name);
    });
  }

  function resetActiveTest() {
    state.activeTest = null;
    state.activeTestAssertions = [];
    el.activeTestBanner.style.display = 'none';
    el.proxyTestsGrid?.querySelectorAll('.proxy-test-item-card')?.forEach(c => {
      c.classList.remove('active-selected');
    });
  }

  function evaluateAssertions(assertions, response, rawText) {
    if (!assertions || !Array.isArray(assertions) || assertions.length === 0) {
      assertions = ['status.code == 200'];
    }
    const statusCode = response ? Number(response.status) : 0;
    const results = [];
    let allPassed = true;

    for (const rawAssertion of assertions) {
      const assertionStr = rawAssertion.trim();
      const match = assertionStr.match(/^(?:status\.code|response\.status|status)\s*(==|===|!=|!==|<=|>=|<|>)\s*(\d+)$/i);
      if (match) {
        const op = match[1];
        const expected = Number(match[2]);
        let passed = false;
        switch (op) {
          case '==':
          case '===': passed = (statusCode === expected); break;
          case '!=':
          case '!==': passed = (statusCode !== expected); break;
          case '<': passed = (statusCode < expected); break;
          case '<=': passed = (statusCode <= expected); break;
          case '>': passed = (statusCode > expected); break;
          case '>=': passed = (statusCode >= expected); break;
        }
        if (!passed) allPassed = false;
        results.push({
          assertion: assertionStr,
          passed,
          actual: statusCode,
          expected: `${op} ${expected}`,
          message: passed
            ? `Assertion passed: ${assertionStr} (actual status: ${statusCode})`
            : `Assertion failed: expected ${assertionStr}, got actual status ${statusCode}`
        });
      } else {
        try {
          const evalFn = new Function('status', 'statusCode', 'response', `
            return Boolean(${assertionStr.replace(/status\.code/g, 'statusCode').replace(/response\.status/g, 'statusCode')});
          `);
          const passed = Boolean(evalFn(statusCode, statusCode, response));
          if (!passed) allPassed = false;
          results.push({
            assertion: assertionStr,
            passed,
            actual: statusCode,
            expected: assertionStr,
            message: passed
              ? `Assertion passed: ${assertionStr} (actual status: ${statusCode})`
              : `Assertion failed: ${assertionStr} (actual status: ${statusCode})`
          });
        } catch (e) {
          allPassed = false;
          results.push({
            assertion: assertionStr,
            passed: false,
            actual: statusCode,
            expected: assertionStr,
            message: `Syntax error in assertion: ${e.message}`
          });
        }
      }
    }

    return {
      passed: allPassed,
      count: results.length,
      passedCount: results.filter(r => r.passed).length,
      results
    };
  }

  function renderAssertionResults(evalResult, traceId) {
    if (!el.resAssertionCard || !el.assertionsList) return;

    if (!evalResult) {
      el.resAssertionCard.style.display = 'none';
      if (el.resAssertionsCountBadge) el.resAssertionsCountBadge.textContent = '0';
      if (el.assertionsEmptyNotice) el.assertionsEmptyNotice.style.display = 'block';
      if (el.assertionsList) el.assertionsList.style.display = 'none';
      return;
    }

    state.lastAssertionResults = evalResult;

    // Card in response header (2-line uniform card: Results / Passed or Failed)
    el.resAssertionCard.style.display = 'flex';
    const passClass = evalResult.passed ? 'assertion-passed' : 'assertion-failed';
    el.resAssertionCard.className = `res-stat-card res-assertion-card clickable ${passClass}`;
    const resultSummary = evalResult.passed
      ? `Passed (${evalResult.passedCount}/${evalResult.count})`
      : `Failed (${evalResult.passedCount}/${evalResult.count})`;
    el.resAssertionCard.title = `Results: ${resultSummary} (Click to inspect assertions)`;
    el.resAssertionCard.onclick = () => {
      switchResSubtab('assertions');
    };

    if (el.resAssertionPill) {
      el.resAssertionPill.textContent = resultSummary;
    }

    if (el.resAssertionsCountBadge) {
      el.resAssertionsCountBadge.textContent = evalResult.results.length;
    }

    // Subpane content
    el.assertionsEmptyNotice.style.display = 'none';
    el.assertionsList.style.display = 'flex';
    el.assertionsList.innerHTML = '';

    evalResult.results.forEach(res => {
      const row = document.createElement('div');
      row.className = 'assertion-row ' + (res.passed ? 'passed' : 'failed');
      row.innerHTML = `
        <div class="assertion-icon">${res.passed ? '✓' : '✗'}</div>
        <div class="assertion-details">
          <div class="assertion-expression">${escapeHtml(res.assertion)}</div>
          <div class="assertion-meta">${escapeHtml(res.message)}</div>
          ${traceId ? `
            <div style="margin-top: 4px;">
              <button class="btn btn-subtle-sm btn-inspect-trace-from-assert" style="padding: 2px 8px; font-size: var(--font-2xs);">
                Inspect Flow & Policy Trace (${escapeHtml(traceId.slice(0, 8))}...)
              </button>
            </div>
          ` : ''}
        </div>
      `;

      const inspectBtn = row.querySelector('.btn-inspect-trace-from-assert');
      if (inspectBtn) {
        inspectBtn.addEventListener('click', () => {
          switchResSubtab('trace');
          loadTraceDetail(traceId);
        });
      }

      el.assertionsList.appendChild(row);
    });
  }

  async function runSingleTest(test, cardEl) {
    loadTestIntoConsole(test);

    // Update pill to running
    state.testRunResults.set(test.name, { running: true });
    renderProxyTests(state.currentProxyName);

    await executeTestRequest();
  }

  async function runAllProxyTests(proxyName) {
    const tests = getTestsForProxy(proxyName);
    if (tests.length === 0) return;

    el.btnRunAllProxyTests.disabled = true;
    const origHtml = el.btnRunAllProxyTests.innerHTML;
    el.btnRunAllProxyTests.innerHTML = `
      <div class="spinner-small" style="width: 12px; height: 12px; border-width: 2px;"></div>
      <span>Running ${tests.length} tests...</span>
    `;

    for (const test of tests) {
      await runSingleTest(test);
    }

    el.btnRunAllProxyTests.disabled = false;
    el.btnRunAllProxyTests.innerHTML = origHtml;
  }

  function initDefaultHeaders() {
    el.headersTableBody.innerHTML = '';
    addHeaderRow('Content-Type', 'application/json');
    // Look for first user API key in data
    const userKey = getFirstUserApiKey();
    if (userKey) {
      addHeaderRow('x-api-key', userKey);
    }
    updateHeadersBadge();
  }

  function getFirstUserApiKey() {
    if (!state.dataSummary?.fileContents?.users) return '';
    for (const raw of Object.values(state.dataSummary.fileContents.users)) {
      try {
        const u = window.jsyaml?.load(raw);
        const key = u?.apps?.[0]?.credentials?.[0]?.consumerKey;
        if (key) return key;
      } catch (e) {}
    }
    return '';
  }

  function addHeaderRow(key = '', val = '') {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="table-input header-key-input" placeholder="Header Name" value="${escapeHtml(key)}"></td>
      <td><input type="text" class="table-input header-val-input" placeholder="Header Value" value="${escapeHtml(val)}"></td>
      <td style="text-align: center;"><button class="btn-remove-row" title="Remove Header">&times;</button></td>
    `;

    tr.querySelector('.btn-remove-row').addEventListener('click', () => {
      tr.remove();
      updateHeadersBadge();
    });

    tr.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', updateHeadersBadge);
    });

    el.headersTableBody.appendChild(tr);
    updateHeadersBadge();
  }

  function updateHeadersBadge() {
    const rows = el.headersTableBody.querySelectorAll('tr');
    let count = 0;
    rows.forEach(r => {
      const k = r.querySelector('.header-key-input')?.value.trim();
      if (k) count++;
    });
    el.headersCountBadge.textContent = count;
  }

  function switchReqSubtab(subtab) {
    state.activeReqSubtab = subtab;
    el.subtabBtnHeaders.classList.toggle('active', subtab === 'headers');
    el.subtabBtnBody.classList.toggle('active', subtab === 'body');
    el.subpaneHeaders.classList.toggle('active', subtab === 'headers');
    el.subpaneBody.classList.toggle('active', subtab === 'body');
  }

  function switchResSubtab(subtab) {
    state.activeResSubtab = subtab;
    el.resSubtabBtnBody.classList.toggle('active', subtab === 'body');
    el.resSubtabBtnHeaders.classList.toggle('active', subtab === 'headers');
    if (el.resSubtabBtnAssertions) el.resSubtabBtnAssertions.classList.toggle('active', subtab === 'assertions');
    el.resSubtabBtnTrace.classList.toggle('active', subtab === 'trace');
    el.resSubpaneBody.classList.toggle('active', subtab === 'body');
    el.resSubpaneHeaders.classList.toggle('active', subtab === 'headers');
    if (el.resSubpaneAssertions) el.resSubpaneAssertions.classList.toggle('active', subtab === 'assertions');
    el.resSubpaneTrace.classList.toggle('active', subtab === 'trace');
  }

  // --------------------------------------------------------------------------
  // Execute Request from Tester
  // --------------------------------------------------------------------------
  async function executeTestRequest() {
    const url = el.testerUrlInput.value.trim();
    if (!url) {
      alert('Please enter a target URL');
      return;
    }

    const method = el.testerVerbSelect.value;
    const headers = {};
    el.headersTableBody.querySelectorAll('tr').forEach(tr => {
      const k = tr.querySelector('.header-key-input')?.value.trim();
      const v = tr.querySelector('.header-val-input')?.value.trim();
      if (k) {
        headers[k] = v;
      }
    });

    let body = undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      body = el.testerBodyTextarea.value.trim() || undefined;
    }

    // Set UI Loading state
    el.btnTesterSend.disabled = true;
    el.btnTesterSendText.textContent = 'Sending...';
    if (el.resStatusBadge) el.resStatusBadge.textContent = 'Sending...';
    if (el.resStatusCard) {
      el.resStatusCard.className = 'res-stat-card';
      el.resStatusCard.title = 'Status: Sending...';
    }
    if (el.resDurationPill) el.resDurationPill.textContent = '...';
    if (el.resDurationCard) el.resDurationCard.title = 'Latency: ...';
    if (el.resSizePill) el.resSizePill.textContent = '...';
    if (el.resSizeCard) el.resSizeCard.title = 'Size: ...';
    if (el.resStreamCard) el.resStreamCard.style.display = 'none';
    if (el.resTraceCard) el.resTraceCard.style.display = 'none';
    if (el.resAssertionCard) el.resAssertionCard.style.display = 'none';
    el.resBodyCode.textContent = '';

    const startTime = performance.now();

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
      });

      // Update response status immediately
      const initialDurationMs = Math.round(performance.now() - startTime);
      if (el.resDurationPill) el.resDurationPill.textContent = `${initialDurationMs} ms`;
      if (el.resDurationCard) el.resDurationCard.title = `Latency: ${initialDurationMs} ms`;
      const initialStatusText = `${response.status} ${response.statusText || (response.status === 200 ? 'OK' : '')}`.trim();
      if (el.resStatusBadge) el.resStatusBadge.textContent = initialStatusText;
      const initialStatusClass = response.status >= 200 && response.status < 300 ? 'status-2xx' :
                                response.status >= 400 && response.status < 500 ? 'status-4xx' : 'status-5xx';
      if (el.resStatusCard) {
        el.resStatusCard.className = `res-stat-card ${initialStatusClass}`;
        el.resStatusCard.title = `Status: ${initialStatusText}`;
      }

      // Render Response Headers immediately
      el.resHeadersTableBody.innerHTML = '';
      for (const [k, v] of response.headers.entries()) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="font-family: var(--font-mono); font-weight: 600;">${escapeHtml(k)}</td><td style="font-family: var(--font-mono);">${escapeHtml(v)}</td>`;
        el.resHeadersTableBody.appendChild(tr);
      }

      // Check for x-bungee-trace-id
      const traceId = response.headers.get('x-bungee-trace-id');
      if (traceId) {
        if (el.resTraceCard) {
          el.resTraceCard.style.display = 'flex';
          el.resTraceCard.className = 'res-stat-card res-trace-card clickable trace-active';
          el.resTraceCard.title = `Trace: ${traceId} (Click to inspect)`;
          el.resTraceCard.onclick = () => {
            switchResSubtab('trace');
          };
        }
        if (el.resTraceIdPill) {
          el.resTraceIdPill.textContent = `${traceId.slice(0, 8)}...`;
        }
      } else {
        if (el.resTraceCard) el.resTraceCard.style.display = 'none';
      }

      // Ensure user is on Response Body tab to watch stream
      switchResSubtab('body');

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      let rawText = '';

      if (response.body && typeof response.body.getReader === 'function') {
        if (el.resStreamCard) el.resStreamCard.style.display = 'flex';

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            rawText += chunk;
            el.resBodyCode.textContent = rawText;
            el.resBodyCode.scrollTop = el.resBodyCode.scrollHeight;

            const streamDurationMs = Math.round(performance.now() - startTime);
            const streamByteSize = new Blob([rawText]).size;
            if (el.resDurationPill) el.resDurationPill.textContent = `${streamDurationMs} ms`;
            if (el.resDurationCard) el.resDurationCard.title = `Latency: ${streamDurationMs} ms`;
            if (el.resSizePill) el.resSizePill.textContent = formatBytes(streamByteSize);
            if (el.resSizeCard) el.resSizeCard.title = `Size: ${formatBytes(streamByteSize)}`;
          }
          // Flush decoder remaining characters
          const finalChunk = decoder.decode();
          if (finalChunk) {
            rawText += finalChunk;
            el.resBodyCode.textContent = rawText;
          }
        } catch (streamErr) {
          console.warn('Stream read error or connection closed:', streamErr);
          rawText += `\n[Stream Closed: ${streamErr.message}]`;
          el.resBodyCode.textContent = rawText;
        } finally {
          if (el.resStreamCard) el.resStreamCard.style.display = 'none';
        }
      } else {
        rawText = await response.text();
      }

      const durationMs = Math.round(performance.now() - startTime);
      const byteSize = new Blob([rawText]).size;
      if (el.resDurationPill) el.resDurationPill.textContent = `${durationMs} ms`;
      if (el.resDurationCard) el.resDurationCard.title = `Latency: ${durationMs} ms`;
      if (el.resSizePill) el.resSizePill.textContent = formatBytes(byteSize);
      if (el.resSizeCard) el.resSizeCard.title = `Size: ${formatBytes(byteSize)}`;

      // Pretty-format body if it's standard JSON (not SSE event stream)
      if (!contentType.includes('text/event-stream')) {
        try {
          const json = JSON.parse(rawText);
          el.resBodyCode.textContent = JSON.stringify(json, null, 2);
        } catch (e) {
          el.resBodyCode.textContent = rawText || '(Empty Response Body)';
        }
      } else {
        el.resBodyCode.textContent = rawText || '(Empty Stream)';
      }

      // Fetch and display trace profiling
      if (traceId) {
        loadTraceDetail(traceId);
      } else {
        renderEmptyTraceNotice('No x-bungee-trace-id returned. Tracing may be disabled.');
      }

      // Evaluate Assertions
      const activeAssertions = state.activeTest?.assertions ||
                               (state.activeTestAssertions && state.activeTestAssertions.length > 0 ? state.activeTestAssertions : ['status.code == 200']);
      const evalResult = evaluateAssertions(activeAssertions, response, rawText);
      renderAssertionResults(evalResult, traceId);

      // Record test run result if activeTest is loaded
      if (state.activeTest) {
        state.testRunResults.set(state.activeTest.name, {
          running: false,
          passed: evalResult.passed,
          status: response.status,
          durationMs,
          traceId,
          evalResult
        });
        renderProxyTests(state.currentProxyName);
      }

    } catch (err) {
      if (el.resStreamCard) el.resStreamCard.style.display = 'none';
      const durationMs = Math.round(performance.now() - startTime);
      if (el.resDurationPill) el.resDurationPill.textContent = `${durationMs} ms`;
      if (el.resDurationCard) el.resDurationCard.title = `Latency: ${durationMs} ms`;
      if (el.resStatusBadge) el.resStatusBadge.textContent = 'Error';
      if (el.resStatusCard) {
        el.resStatusCard.className = 'res-stat-card status-5xx';
        el.resStatusCard.title = `Error: ${err.message}`;
      }
      el.resBodyCode.textContent = 'Fetch failed:\n' + err.stack;

      // Evaluate Assertions on Error
      const activeAssertions = state.activeTest?.assertions || ['status.code == 200'];
      const evalResult = evaluateAssertions(activeAssertions, null, err.message);
      renderAssertionResults(evalResult, null);

      if (state.activeTest) {
        state.testRunResults.set(state.activeTest.name, {
          running: false,
          passed: false,
          status: 0,
          durationMs,
          evalResult
        });
        renderProxyTests(state.currentProxyName);
      }
    } finally {
      if (el.resStreamCard) el.resStreamCard.style.display = 'none';
      el.btnTesterSend.disabled = false;
      el.btnTesterSendText.textContent = 'Send Request';
      loadRecentTraces();
    }
  }

  // --------------------------------------------------------------------------
  // Trace Profiling Waterfall & Step Inspector
  // --------------------------------------------------------------------------
  function showTracesListView() {
    state.selectedTraceId = null;
    if (el.tracesListView) el.tracesListView.style.display = 'block';
    if (el.traceDetailCard) el.traceDetailCard.style.display = 'none';
    if (el.headerProxyUrls) el.headerProxyUrls.style.display = 'none';
    renderSidebar();
    highlightTraceRow(null);
    el.itemTypeBadge.textContent = 'TRACES';
    el.itemTitleDisplay.textContent = 'Runtime Execution Traces';
    el.itemSubpath.textContent = 'Execution history';
    syncUrl();
  }

  function showTraceDetailView() {
    if (el.tracesListView) el.tracesListView.style.display = 'none';
    if (el.traceDetailCard) el.traceDetailCard.style.display = 'block';
    if (el.headerProxyUrls) el.headerProxyUrls.style.display = 'none';
  }

  async function selectTrace(traceId) {
    state.selectedCategory = 'traces';
    state.selectedTraceId = traceId;

    // Refresh Sidebar active classes
    renderSidebar();

    // Close Test Console and switch to tracesList
    switchTab('tracesList');
    closeSidebarIfNarrow();

    await loadTraceDetail(traceId);
  }

  async function loadTraceDetail(traceId) {
    try {
      showTraceDetailView();
      const res = await fetch(`/api/traces/${traceId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const trace = await res.json();
      state.currentTrace = trace;

      renderTraceWaterfall(trace);
      renderStandaloneTraceDetail(trace);

      // Update Header Meta
      if (el.headerProxyUrls) el.headerProxyUrls.style.display = 'none';
      el.itemTypeBadge.textContent = 'TRACE';
      el.itemTitleDisplay.textContent = `${trace.verb || 'GET'} ${trace.path || '/'}`;
      el.itemSubpath.textContent = `Trace: ${trace.id} • ${trace.durationMs || 0}ms • Status ${trace.status || 200}`;

      highlightTraceRow(traceId);
    } catch (err) {
      console.warn('Failed to load trace detail:', err);
    }
  }

  function getStepVariables(step) {
    if (!step) return {};
    return step.variablesSnapshot || step.variableSnapshots || step.variables || {};
  }

  function formatVariableValueHtml(val) {
    if (val === null) return '<span style="color: var(--text-muted); font-style: italic;">null</span>';
    if (val === undefined) return '<span style="color: var(--text-muted); font-style: italic;">undefined</span>';
    if (typeof val === 'boolean') return `<span style="color: #1a73e8; font-weight: 600;">${val}</span>`;
    if (typeof val === 'number') return `<span style="color: #0d652d; font-weight: 600;">${val}</span>`;
    if (typeof val === 'object') {
      try {
        return `<pre>${escapeHtml(JSON.stringify(val, null, 2))}</pre>`;
      } catch {
        return `<pre>${escapeHtml(String(val))}</pre>`;
      }
    }
    const str = String(val);
    if ((str.startsWith('{') && str.endsWith('}')) || (str.startsWith('[') && str.endsWith(']'))) {
      try {
        const parsed = JSON.parse(str);
        return `<pre>${escapeHtml(JSON.stringify(parsed, null, 2))}</pre>`;
      } catch {}
    }
    return `<span style="word-break: break-all;">${escapeHtml(str)}</span>`;
  }

  function createTraceStepElement(step, idx, onStepSelect) {
    const item = document.createElement('div');
    item.className = 'trace-step-item';
    item.setAttribute('data-step-idx', String(idx));

    const statusClass = step.status || 'SUCCESS';
    const vars = getStepVariables(step);
    const varKeys = Object.keys(vars);
    const varCount = varKeys.length;

    // Header row
    const row = document.createElement('div');
    row.className = 'trace-step-row';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.title = 'Click to open or close step details and variable values';

    row.innerHTML = `
      <div class="trace-step-left">
        <span class="trace-step-chevron">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </span>
        <span class="trace-step-status-dot ${statusClass}"></span>
        <div>
          <div class="trace-step-name">${escapeHtml(step.name)}</div>
          <div class="trace-step-meta">${escapeHtml(step.flow || 'Flow')} • ${escapeHtml(step.policyType || step.type || 'Policy')}</div>
        </div>
      </div>
      <div class="trace-step-right">
        <span class="badge badge-subtle">${statusClass}</span>
        <span class="trace-step-duration">${step.durationMs !== undefined ? step.durationMs + 'ms' : ''}</span>
        <span class="trace-step-vars-badge" title="${varCount} variables captured at this step">${varCount} vars</span>
      </div>
    `;

    // Inline Details panel
    const details = document.createElement('div');
    details.className = 'trace-step-details';
    details.style.display = 'none';

    let metaHtml = '';
    if (step.condition) {
      metaHtml += `
        <div class="trace-step-condition-card">
          <span style="font-weight: 600; color: var(--text-sub);">Condition:</span>
          <code style="background: var(--bg-surface); padding: 2px 6px; border-radius: 3px; border: 1px solid var(--border-light); font-family: var(--font-mono); font-size: 11px;">${escapeHtml(step.condition)}</code>
          <span class="badge ${step.conditionResult ? 'badge-subtle' : 'badge-outline'}" style="font-size: 10px;">${step.conditionResult ? 'Condition Met (TRUE)' : 'Condition False (SKIPPED)'}</span>
        </div>
      `;
    }
    if (step.error) {
      metaHtml += `<div class="trace-step-error-alert">${escapeHtml(step.error)}</div>`;
    }

    let varsTableHtml = '';
    if (varCount === 0) {
      varsTableHtml = `<div style="color: var(--text-muted); font-size: 11px; padding: 6px 0;">No variables captured at this step.</div>`;
    } else {
      varsTableHtml = `
        <table class="trace-step-vars-table">
          <thead>
            <tr>
              <th style="width: 38%;">Variable Name</th>
              <th>Value</th>
              <th style="width: 36px; text-align: center;">Copy</th>
            </tr>
          </thead>
          <tbody>
            ${varKeys.sort().map(k => {
              const val = vars[k];
              const rawStr = typeof val === 'object' && val !== null ? JSON.stringify(val, null, 2) : String(val ?? '');
              return `
                <tr class="trace-var-row" data-var-key="${escapeHtml(k.toLowerCase())}" data-var-val="${escapeHtml(rawStr.toLowerCase().slice(0, 100))}">
                  <td class="trace-var-name">${escapeHtml(k)}</td>
                  <td class="trace-var-val">${formatVariableValueHtml(val)}</td>
                  <td style="text-align: center;">
                    <button class="trace-var-copy-btn" title="Copy variable value" data-copy-val="${escapeHtml(rawStr)}">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    }

    details.innerHTML = `
      ${metaHtml ? `<div class="trace-step-details-meta">${metaHtml}</div>` : ''}
      <div class="trace-step-vars-header">
        <span class="trace-step-vars-title">Variables Snapshot (${varCount})</span>
        ${varCount > 4 ? `<input type="text" class="trace-vars-filter-input" placeholder="Filter variables..." title="Search variable names or values" />` : ''}
      </div>
      <div class="trace-vars-table-wrapper">${varsTableHtml}</div>
    `;

    // Filter input handler
    const filterInput = details.querySelector('.trace-vars-filter-input');
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const rows = details.querySelectorAll('tr.trace-var-row');
        rows.forEach(r => {
          const key = r.getAttribute('data-var-key') || '';
          const val = r.getAttribute('data-var-val') || '';
          if (!query || key.includes(query) || val.includes(query)) {
            r.style.display = '';
          } else {
            r.style.display = 'none';
          }
        });
      });
      filterInput.addEventListener('click', (e) => e.stopPropagation());
    }

    // Copy variable buttons handler
    details.querySelectorAll('.trace-var-copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const textToCopy = btn.getAttribute('data-copy-val') || '';
        navigator.clipboard.writeText(textToCopy);
        const origHtml = btn.innerHTML;
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: var(--status-success);"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => { btn.innerHTML = origHtml; }, 1500);
      });
    });

    // Toggle expand/collapse on clicking row
    const toggleStep = () => {
      const isExpanded = item.classList.toggle('expanded');
      details.style.display = isExpanded ? 'block' : 'none';
    };

    row.addEventListener('click', toggleStep);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleStep();
      }
    });

    item.appendChild(row);
    item.appendChild(details);
    return item;
  }

  function toggleAllStepDetails(container, textEl) {
    if (!container) return;
    const items = container.querySelectorAll('.trace-step-item');
    if (items.length === 0) return;

    const anyCollapsed = Array.from(items).some(it => !it.classList.contains('expanded'));
    items.forEach(it => {
      const details = it.querySelector('.trace-step-details');
      if (anyCollapsed) {
        it.classList.add('expanded');
        if (details) details.style.display = 'block';
      } else {
        it.classList.remove('expanded');
        if (details) details.style.display = 'none';
      }
    });

    if (textEl) {
      textEl.textContent = anyCollapsed ? 'Collapse All' : 'Expand All';
    }
  }

  function renderTraceWaterfall(trace) {
    if (!trace) return;
    const totalDuration = Number(trace.durationMs || 0);
    const targetDuration = Number(trace.target?.durationMs || 0);
    const proxyDuration = Math.max(0, Math.round((totalDuration - targetDuration) * 10) / 10);

    el.traceIdLabel.textContent = `Trace ID: ${trace.id}`;
    el.traceDurationLabel.textContent = `Total Latency: ${totalDuration} ms (${trace.steps?.length || 0} steps)`;
    if (el.traceProxyTimeLabel) el.traceProxyTimeLabel.textContent = `Proxy Processing: ${proxyDuration} ms`;
    if (el.traceTargetTimeLabel) el.traceTargetTimeLabel.textContent = `Target Processing: ${targetDuration} ms`;
    if (el.btnToggleAllStepsText) el.btnToggleAllStepsText.textContent = 'Expand All';

    el.traceTimelineContainer.innerHTML = '';

    const steps = trace.steps || [];
    if (steps.length === 0) {
      renderEmptyTraceNotice('No steps recorded in this trace.');
      return;
    }

    steps.forEach((step, idx) => {
      const stepEl = createTraceStepElement(step, idx);
      el.traceTimelineContainer.appendChild(stepEl);
    });

    // Also append target info if present
    if (trace.target) {
      const targetDiv = document.createElement('div');
      targetDiv.style.cssText = 'margin-top: 12px; padding: 10px 14px; background: var(--bg-surface-subtle); border-radius: var(--radius-sm); border: 1px solid var(--border-light); font-size: var(--font-xs);';
      targetDiv.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 4px;">Target Call: ${escapeHtml(trace.target.name || 'default')}</div>
        <div style="font-family: var(--font-mono); color: var(--text-muted); word-break: break-all;">${escapeHtml(trace.target.url || '')}</div>
        <div style="margin-top: 4px; display: flex; gap: 12px;">
          <span>Status: <strong>${trace.target.status || 200}</strong></span>
          <span>Target Processing: <strong>${trace.target.durationMs || 0}ms</strong></span>
        </div>
      `;
      el.traceTimelineContainer.appendChild(targetDiv);
    }
  }

  function renderHeadersTable(headers) {
    if (!headers || typeof headers !== 'object' || Object.keys(headers).length === 0) {
      return '<div style="color: var(--text-muted); font-style: italic; padding: 4px;">No headers recorded</div>';
    }
    const keys = Object.keys(headers).sort();
    return `<table style="width: 100%; border-collapse: collapse;"><tbody>` +
      keys.map(k => `
        <tr style="border-bottom: 1px solid var(--border-light);">
          <td style="padding: 3px 6px; font-weight: 600; color: var(--text-sub); width: 35%; word-break: break-all; vertical-align: top;">${escapeHtml(k)}</td>
          <td style="padding: 3px 6px; color: var(--text-main); word-break: break-all; vertical-align: top;">${escapeHtml(String(headers[k]))}</td>
        </tr>
      `).join('') +
      `</tbody></table>`;
  }

  function renderPayloadBox(payload, bodyEl, copyBtnEl) {
    if (!bodyEl) return;
    if (payload === undefined || payload === null || (typeof payload === 'string' && payload.trim() === '')) {
      bodyEl.innerHTML = '<span style="color: var(--text-muted); font-style: italic;">(No payload)</span>';
      if (copyBtnEl) copyBtnEl.style.display = 'none';
      return;
    }

    let formatted = '';
    if (typeof payload === 'object') {
      try {
        formatted = JSON.stringify(payload, null, 2);
      } catch {
        formatted = String(payload);
      }
    } else if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload);
        formatted = JSON.stringify(parsed, null, 2);
      } catch {
        formatted = payload;
      }
    } else {
      formatted = String(payload);
    }

    bodyEl.textContent = formatted;
    if (copyBtnEl) {
      copyBtnEl.style.display = 'inline-block';
      copyBtnEl.onclick = () => {
        navigator.clipboard.writeText(formatted);
        const orig = copyBtnEl.textContent;
        copyBtnEl.textContent = 'Copied!';
        setTimeout(() => { copyBtnEl.textContent = orig; }, 1500);
      };
    }
  }

  function renderStandaloneTraceDetail(trace) {
    if (!trace || !el.traceDetailCard) return;

    el.traceDetailCard.style.display = 'block';

    const req = trace.request || {};
    const res = trace.response || {};

    const verb = req.verb || trace.verb || 'GET';
    el.traceDetailMethod.textContent = verb;
    el.traceDetailPath.textContent = req.path || trace.path || '/';

    const status = res.status || trace.status || 200;
    el.traceDetailStatus.textContent = status;
    el.traceDetailStatus.className = 'res-status-badge ' + (status >= 200 && status < 300 ? 'status-2xx' : status >= 400 && status < 500 ? 'status-4xx' : 'status-5xx');

    const totalDuration = Number(trace.durationMs || 0);
    const targetDuration = Number(trace.target?.durationMs || 0);
    const proxyDuration = Math.max(0, Math.round((totalDuration - targetDuration) * 10) / 10);

    el.traceDetailProxy.textContent = `Proxy: ${trace.proxyName || 'proxy'}`;
    el.traceDetailDuration.textContent = `Total Latency: ${totalDuration}ms (${trace.steps?.length || 0} steps)`;
    if (el.traceDetailProxyDuration) el.traceDetailProxyDuration.textContent = `Proxy Processing: ${proxyDuration}ms`;
    if (el.traceDetailTargetDuration) el.traceDetailTargetDuration.textContent = `Target Processing: ${targetDuration}ms`;
    el.traceDetailId.textContent = `ID: ${trace.id}`;
    if (el.btnToggleAllStepsDetailText) el.btnToggleAllStepsDetailText.textContent = 'Expand All';

    // Render Request Details
    if (el.traceReqVerbBadge) el.traceReqVerbBadge.textContent = verb;
    if (el.traceReqUrlDisplay) el.traceReqUrlDisplay.textContent = req.url || req.path || trace.path || '/';
    const reqHeaders = req.headers || {};
    const reqHeaderCount = Object.keys(reqHeaders).length;
    if (el.traceReqHeadersCount) el.traceReqHeadersCount.textContent = reqHeaderCount;
    if (el.traceReqHeadersBody) el.traceReqHeadersBody.innerHTML = renderHeadersTable(reqHeaders);
    renderPayloadBox(req.body, el.traceReqPayloadBody, el.btnCopyReqPayload);

    // Render Response Details
    const resStatusText = res.statusText || (status === 200 ? 'OK' : '');
    if (el.traceResStatusBadge) {
      el.traceResStatusBadge.textContent = `${status} ${resStatusText}`.trim();
      el.traceResStatusBadge.className = 'res-status-badge ' + (status >= 200 && status < 300 ? 'status-2xx' : status >= 400 && status < 500 ? 'status-4xx' : 'status-5xx');
    }
    const resHeaders = res.headers || {};
    const resHeaderCount = Object.keys(resHeaders).length;
    if (el.traceResHeadersCount) el.traceResHeadersCount.textContent = resHeaderCount;
    if (el.traceResHeadersBody) el.traceResHeadersBody.innerHTML = renderHeadersTable(resHeaders);

    const isStreamed = (resHeaders['content-type'] && (
      resHeaders['content-type'].includes('event-stream') ||
      resHeaders['content-type'].includes('ndjson') ||
      resHeaders['content-type'].includes('stream')
    )) || (typeof res.body === 'string' && (res.body.startsWith('data: ') || res.body.includes('\ndata: ')));

    if (el.traceResPayloadTag) {
      el.traceResPayloadTag.style.display = isStreamed ? 'inline-block' : 'none';
    }

    renderPayloadBox(res.body, el.traceResPayloadBody, el.btnCopyResPayload);

    // Render Steps
    el.traceDetailStepsContainer.innerHTML = '';
    const steps = trace.steps || [];
    if (steps.length === 0) {
      el.traceDetailStepsContainer.innerHTML = '<div class="trace-empty-notice">No steps recorded in this trace.</div>';
    } else {
      steps.forEach((step, idx) => {
        const stepEl = createTraceStepElement(step, idx, null);
        el.traceDetailStepsContainer.appendChild(stepEl);
      });
    }

    // Target call
    if (el.traceDetailTargetContainer) {
      if (trace.target) {
        el.traceDetailTargetContainer.innerHTML = `
          <div style="padding: 10px 14px; background: var(--bg-surface-subtle); border-radius: var(--radius-sm); border: 1px solid var(--border-light); font-size: var(--font-xs);">
            <div style="font-weight: 600; margin-bottom: 4px;">Target Call: ${escapeHtml(trace.target.name || 'default')}</div>
            <div style="font-family: var(--font-mono); color: var(--text-muted); word-break: break-all;">${escapeHtml(trace.target.url || '')}</div>
            <div style="margin-top: 4px; display: flex; gap: 12px;">
              <span>Status: <strong>${trace.target.status || 200}</strong></span>
              <span>Target Latency: <strong>${trace.target.durationMs || 0}ms</strong></span>
            </div>
          </div>
        `;
      } else {
        el.traceDetailTargetContainer.innerHTML = '';
      }
    }
  }

  function renderEmptyTraceNotice(msg) {
    el.traceTimelineContainer.innerHTML = `<div class="trace-empty-notice">${escapeHtml(msg)}</div>`;
  }

  // --------------------------------------------------------------------------
  // Trace Export (Apigee Trace JSON, OTEL JSON)
  // --------------------------------------------------------------------------
  async function exportTrace(format) {
    const trace = state.currentTrace;
    if (!trace) {
      alert('No active trace to export. Run a test request first.');
      return;
    }

    try {
      const url = `/api/traces/${trace.id}?format=${format}`;
      const res = await fetch(url);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `trace-${trace.id}-${format}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (e) {
      alert('Failed to export trace: ' + e.message);
    }
  }

  // --------------------------------------------------------------------------
  // Traces History List
  // --------------------------------------------------------------------------
  async function loadRecentTraces() {
    try {
      const res = await fetch('/api/traces');
      if (!res.ok) return;
      const traces = await res.json();
      state.traces = traces;

      el.badgeNavTraces.textContent = traces.length;

      // Update sidebar traces items
      renderRecentTraces(traces);

      // Populate full table in Traces List tab
      renderTracesTable(traces);

    } catch (e) {
      console.warn('Failed to load recent traces:', e);
    }
  }

  function renderRecentTraces(traces) {
    if (!el.navItemsTraces) return;
    el.navItemsTraces.innerHTML = '';
    const traceList = traces || [];
    if (traceList.length === 0) {
      el.navItemsTraces.innerHTML = '<div style="padding: 6px 12px 6px 28px; font-size: var(--font-xs); color: var(--text-muted);">No recent traces</div>';
      return;
    }

    traceList.slice(0, 5).forEach(t => {
      const item = document.createElement('div');
      item.className = 'nav-item';
      if (state.selectedCategory === 'traces' && state.selectedTraceId === t.id) {
        item.classList.add('active');
      }
      item.innerHTML = `
        <span class="nav-item-title">${escapeHtml(t.verb || 'GET')} ${escapeHtml(t.path || '/')}</span>
        <span class="nav-item-sub">${t.durationMs || 0}ms</span>
      `;
      item.addEventListener('click', () => {
        selectTrace(t.id);
      });
      el.navItemsTraces.appendChild(item);
    });
  }

  function renderTracesTable(traces) {
    if (!el.tracesTableBody) return;
    el.tracesTableBody.innerHTML = '';

    if (traces.length === 0) {
      el.tracesTableBody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 32px; font-size: var(--font-sm);">No traces recorded yet. Make calls using the Test Console or directly against the runtime.</td></tr>';
      return;
    }

    traces.forEach(t => {
      const tr = document.createElement('tr');
      if (state.selectedCategory === 'traces' && state.selectedTraceId === t.id) {
        tr.style.backgroundColor = 'var(--bg-surface-hover)';
      }
      const timeStr = new Date(t.timestamp).toLocaleTimeString();
      const statusClass = t.status >= 200 && t.status < 300 ? 'status-2xx' : t.status >= 400 && t.status < 500 ? 'status-4xx' : 'status-5xx';

      tr.innerHTML = `
        <td style="font-family: var(--font-mono); font-size: var(--font-xs);">${timeStr}</td>
        <td><strong>${escapeHtml(t.proxyName || 'proxy')}</strong></td>
        <td><span class="badge badge-subtle">${escapeHtml(t.verb || 'GET')}</span></td>
        <td style="font-family: var(--font-mono); font-size: var(--font-xs);">${escapeHtml(t.path || '/')}</td>
        <td><span class="res-status-badge ${statusClass}">${t.status || 200}</span></td>
        <td style="font-family: var(--font-mono);">${t.durationMs || 0}ms</td>
        <td>${t.stepCount || 0}</td>
        <td>
          <button class="btn btn-secondary btn-sm btn-inspect-trace" data-id="${t.id}">Inspect</button>
        </td>
      `;

      tr.querySelector('.btn-inspect-trace').addEventListener('click', (e) => {
        e.stopPropagation();
        selectTrace(t.id);
      });

      tr.addEventListener('click', () => {
        selectTrace(t.id);
      });
      tr.style.cursor = 'pointer';

      el.tracesTableBody.appendChild(tr);
    });
  }

  function highlightTraceRow(traceId) {
    if (!el.tracesTableBody) return;
    el.tracesTableBody.querySelectorAll('tr').forEach(tr => {
      const btn = tr.querySelector(`.btn-inspect-trace[data-id="${traceId}"]`);
      if (btn) {
        tr.style.backgroundColor = 'var(--bg-surface-hover)';
      } else {
        tr.style.backgroundColor = '';
      }
    });
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // --------------------------------------------------------------------------
  // Event Listeners Setup
  // --------------------------------------------------------------------------
  function setupEventListeners() {
    // Theme toggle
    el.themeToggleBtn.addEventListener('click', toggleTheme);

    // Sidebar responsive toggle & backdrop
    el.sidebarToggleBtn?.addEventListener('click', toggleSidebar);
    el.sidebarBackdrop?.addEventListener('click', closeSidebarIfNarrow);

    window.addEventListener('resize', () => {
      if (window.innerWidth > 850) {
        el.sidebarNav?.classList.remove('open');
        el.sidebarBackdrop?.classList.remove('active');
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.sidebarNav?.classList.contains('open')) {
        closeSidebarIfNarrow();
      }
    });

    // Sidebar search
    el.sidebarSearchInput.addEventListener('input', () => {
      const val = el.sidebarSearchInput.value.trim();
      el.sidebarSearchClear.style.display = val ? 'block' : 'none';
      renderSidebar();
    });

    el.sidebarSearchClear.addEventListener('click', () => {
      el.sidebarSearchInput.value = '';
      el.sidebarSearchClear.style.display = 'none';
      renderSidebar();
    });

    // Sidebar section collapse toggles
    document.querySelectorAll('.nav-section-header').forEach(header => {
      header.addEventListener('click', (e) => {
        const toggleType = header.getAttribute('data-toggle');
        if (toggleType === 'traces') {
          state.selectedCategory = 'traces';
          showTracesListView();
          switchTab('tracesList');
          closeSidebarIfNarrow();
          return;
        }
        const section = header.closest('.nav-section');
        section.classList.toggle('collapsed');
      });
    });

    // Main Tab Switching
    el.tabBtnOverview.addEventListener('click', () => {
      if (state.selectedCategory === 'traces' && state.dataSummary) {
        const firstProxy = state.dataSummary.files?.proxies?.[0];
        if (firstProxy) {
          selectItem('proxies', firstProxy);
        }
      }
      switchTab('overview');
    });
    el.tabBtnYaml.addEventListener('click', () => {
      if (state.selectedCategory === 'traces' && state.dataSummary) {
        const firstProxy = state.dataSummary.files?.proxies?.[0];
        if (firstProxy) {
          selectItem('proxies', firstProxy);
        }
      }
      switchTab('yaml');
    });
    el.tabBtnTester.addEventListener('click', () => {
      const targetProxy = (state.selectedCategory === 'proxies' ? state.selectedItem?.name : null) || state.currentProxyName;
      openTestConsole(null, targetProxy);
    });
    el.btnHeaderTestConsole.addEventListener('click', () => {
      const targetProxy = (state.selectedCategory === 'proxies' ? state.selectedItem?.name : null) || state.currentProxyName;
      openTestConsole(null, targetProxy);
    });

    // Copy & Download YAML
    el.btnCopyYaml.addEventListener('click', () => {
      if (state.selectedItem?.rawYaml) {
        navigator.clipboard.writeText(state.selectedItem.rawYaml);
        const orig = el.btnCopyYaml.querySelector('span').textContent;
        el.btnCopyYaml.querySelector('span').textContent = 'Copied!';
        setTimeout(() => { el.btnCopyYaml.querySelector('span').textContent = orig; }, 1500);
      }
    });

    el.btnDownloadYaml.addEventListener('click', () => {
      if (state.selectedItem?.rawYaml) {
        const blob = new Blob([state.selectedItem.rawYaml], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = state.selectedItem.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    });

    // Tester Subtabs
    el.subtabBtnHeaders.addEventListener('click', () => switchReqSubtab('headers'));
    el.subtabBtnBody.addEventListener('click', () => switchReqSubtab('body'));

    el.resSubtabBtnBody.addEventListener('click', () => switchResSubtab('body'));
    el.resSubtabBtnHeaders.addEventListener('click', () => switchResSubtab('headers'));
    el.resSubtabBtnTrace.addEventListener('click', () => switchResSubtab('trace'));

    // Tester Actions
    el.btnAddHeaderRow.addEventListener('click', () => addHeaderRow('', ''));

    el.btnPresetApiKey.addEventListener('click', () => {
      const key = getFirstUserApiKey();
      if (key) {
        addHeaderRow('x-ai-key', key);
      } else {
        alert('No user API keys found in data/users');
      }
    });

    el.btnPresetOpenAi.addEventListener('click', () => {
      switchReqSubtab('body');
      el.testerBodyTextarea.value = JSON.stringify({
        model: "gemini-3.7-flash",
        messages: [
          { role: "user", content: "Say hello and explain who you are in one sentence." }
        ]
      }, null, 2);
    });

    el.btnFormatJson.addEventListener('click', () => {
      try {
        const parsed = JSON.parse(el.testerBodyTextarea.value);
        el.testerBodyTextarea.value = JSON.stringify(parsed, null, 2);
      } catch (e) {
        alert('Invalid JSON: ' + e.message);
      }
    });

    el.btnTesterSend.addEventListener('click', executeTestRequest);

    // Assertions Subtab & Controls
    if (el.resSubtabBtnAssertions) {
      el.resSubtabBtnAssertions.addEventListener('click', () => switchResSubtab('assertions'));
    }

    if (el.btnResetActiveTest) {
      el.btnResetActiveTest.addEventListener('click', resetActiveTest);
    }

    if (el.btnRunAllProxyTests) {
      el.btnRunAllProxyTests.addEventListener('click', () => {
        if (state.currentProxyName) {
          runAllProxyTests(state.currentProxyName);
        }
      });
    }

    el.btnCopyResponseBody.addEventListener('click', () => {
      navigator.clipboard.writeText(el.resBodyCode.textContent);
      const orig = el.btnCopyResponseBody.textContent;
      el.btnCopyResponseBody.textContent = 'Copied!';
      setTimeout(() => { el.btnCopyResponseBody.textContent = orig; }, 1500);
    });

    // Trace Exports & Step Expansion
    el.btnToggleAllSteps?.addEventListener('click', () => {
      toggleAllStepDetails(el.traceTimelineContainer, el.btnToggleAllStepsText);
    });
    el.btnExportApigee.addEventListener('click', () => exportTrace('apigee'));
    el.btnExportOtel.addEventListener('click', () => exportTrace('otel'));

    // Standalone Trace Detail Actions
    el.btnBackToTracesList?.addEventListener('click', showTracesListView);
    el.btnCloseTraceDetail?.addEventListener('click', showTracesListView);

    el.btnToggleAllStepsDetail?.addEventListener('click', () => {
      toggleAllStepDetails(el.traceDetailStepsContainer, el.btnToggleAllStepsDetailText);
    });
    el.btnExportApigeeDetail?.addEventListener('click', () => exportTrace('apigee'));
    el.btnExportOtelDetail?.addEventListener('click', () => exportTrace('otel'));

    // Traces List Actions
    el.btnClearTraces.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all runtime traces?')) {
        await fetch('/api/traces', { method: 'DELETE' });
        showTracesListView();
        loadRecentTraces();
      }
    });

    el.btnRefreshTraces.addEventListener('click', loadRecentTraces);

    // Snippet Modal Controls
    if (el.btnCloseSnippetModal) {
      el.btnCloseSnippetModal.addEventListener('click', () => el.yamlSnippetModal?.close());
    }
    if (el.btnCloseSnippetBtn) {
      el.btnCloseSnippetBtn.addEventListener('click', () => el.yamlSnippetModal?.close());
    }
    if (el.btnCopySnippet) {
      el.btnCopySnippet.addEventListener('click', () => {
        if (el.snippetModalCode) {
          navigator.clipboard.writeText(el.snippetModalCode.textContent);
          if (el.copySnippetBtnText) {
            el.copySnippetBtnText.textContent = 'Copied!';
            setTimeout(() => {
              if (el.copySnippetBtnText) el.copySnippetBtnText.textContent = 'Copy Snippet';
            }, 1500);
          }
        }
      });
    }

    // Help & Documentation Modal Controls
    if (el.btnHeaderHelp) {
      el.btnHeaderHelp.addEventListener('click', openHelpModal);
    }
    if (el.btnCloseHelpModal) {
      el.btnCloseHelpModal.addEventListener('click', closeHelpModal);
    }
    if (el.btnCloseHelpFooterBtn) {
      el.btnCloseHelpFooterBtn.addEventListener('click', closeHelpModal);
    }

    // Light-dismiss fallback for <dialog> when closedby isn't supported
    if (el.helpModal && !('closedBy' in HTMLDialogElement.prototype)) {
      el.helpModal.addEventListener('click', (event) => {
        if (event.target !== el.helpModal) return;
        const rect = el.helpModal.getBoundingClientRect();
        const isContent = (
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width
        );
        if (!isContent) el.helpModal.close();
      });
    }

    // Keyboard shortcut: Press ? to open Help modal
    document.addEventListener('keydown', (e) => {
      const targetTag = (e.target.tagName || '').toLowerCase();
      const isInput = targetTag === 'input' || targetTag === 'textarea' || e.target.isContentEditable;
      if (!isInput && e.key === '?') {
        e.preventDefault();
        openHelpModal();
      }
    });

    // Browser navigation (Back / Forward) support
    window.addEventListener('popstate', () => {
      restoreResourceFromUrl();
    });

    // Snippet Button click delegation & Jump to Proxy handler
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-snippet');
      if (btn) {
        const snipId = btn.getAttribute('data-snip-id');
        if (snipId) {
          showSnippetModal(snipId);
        }
        return;
      }

      const jumpBtn = e.target.closest('.btn-jump-to-proxy');
      if (jumpBtn) {
        const proxyName = jumpBtn.getAttribute('data-proxy');
        if (proxyName && state.dataSummary?.files?.proxies) {
          const match = state.dataSummary.files.proxies.find(
            p => p === proxyName || p.replace(/\.(yaml|yml)$/, '') === proxyName
          );
          if (match) {
            selectItem('proxies', match);
          }
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // Startup
  // --------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setupEventListeners();
    loadRuntimeData();
    initDefaultHeaders();
  });

})();
