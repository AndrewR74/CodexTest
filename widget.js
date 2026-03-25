import { SessionTile } from './SessionTile.js';

const ObserveSubject = {
  REGISTRATION_TYPE: 'REGISTRATION_TYPE',
  ADMISSION_ITEM: 'ADMISSION_ITEM'
};

const dateKey = value => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const prettyDate = value => {
  const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = dateOnlyMatch
    ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)))
    : new Date(value);

  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });
};

export default class extends HTMLElement {
  unsubCallbacks = [];
  selectedCategoryId = '';
  selectedDate = 'ALL';
  selectedType = 'ALL';
  sortBy = 'START_TIME';
  searchQuery = '';
  sessionStatuses = new Map();
  showMobileFilters = false;
  isLoading = false;
  loadingMessage = 'Loading sessions and fees...';
  statusLoadVersion = 0;
  statusFetchDelayMs = 50;
  sessionTilesById = new Map();
  renderedSessionIds = [];
  statusFetchQueue = [];
  pendingStatusSessionIds = new Set();
  isProcessingStatusQueue = false;
  statusObserver = null;
  navigator = null;
  currentRegistrationTypeId = '';
  nextNavigationAttemptListener = null;
  bypassNextNavigationGuard = false;
  registeredStatusCodes = new Set(['SELECTED', 'WAITLISTED', 'INCLUDED', 'BUNDLED']);

  constructor({ configuration, theme }) {
    super();
    this.configuration = configuration;
    this.theme = theme;
    this.attachShadow({ mode: 'open' });

    if (!customElements.get('session-browser-tile')) {
      customElements.define('session-browser-tile', SessionTile);
    }
  }

  async connectedCallback() {
    this.root = document.createElement('section');
    this.root.className = 'widget-root';
    this.shadowRoot.append(this.createStyles(), this.root);

    this.initializeLayout();
    this.initNavigatorValidation();
    this.attachNextNavigationGuard();

    const rerender = async () => {
      if (this.configuration?.hideMyScheduleBox) {
        await this.refreshVisibleSessionStatusesOnly();
        return;
      }
      await this.fetchAndRender();
    };

    const admitItemObserve = this.cventSdk.observe(ObserveSubject.ADMISSION_ITEM, rerender);
    const regTypeObserve = this.cventSdk.observe(ObserveSubject.REGISTRATION_TYPE, regTypePayload => {
      this.currentRegistrationTypeId = this.extractRegistrationTypeId(regTypePayload);
      rerender();
    });
    this.currentRegistrationTypeId = this.extractRegistrationTypeId(regTypeObserve?.value);
    this.unsubCallbacks.push(admitItemObserve.unobserve, regTypeObserve.unobserve);

    await this.fetchAndRender();
  }

  disconnectedCallback() {
    this.disconnectStatusObserver();
    this.unsubCallbacks.forEach(unsub => unsub?.());
    this.detachNextNavigationGuard();
  }

  async fetchAndRender() {
    const loadVersion = ++this.statusLoadVersion;
    this.isLoading = true;
    this.loadingMessage = 'Loading sessions and fees...';
    this.allSessions = [];
    this.sessions = [];
    this.sessionStatuses = new Map();
    this.render();

    const generator = await this.cventSdk.getSessionGenerator('nameAsc', this.configuration?.pageSize ?? 50, {
      byRegistrationTypeAndAdmissionItem: true
    });
    const feesBySessionIdPromise = this.fetchFeesBySessionId();

    const sessions = [];
    for await (const page of generator) {
      const pageSessions = page.sessions || [];
      sessions.push(...pageSessions);
    }

    const { startDate, endDate } = this.resolveEffectiveDateRange(sessions);
    const sessionsWithDateFilter = sessions.map(session => ({
      session,
      inConfiguredRange: this.isSessionInConfiguredRange(session, startDate, endDate)
    }));

    const feesBySessionId = await feesBySessionIdPromise;
    this.loadingMessage = 'Loading registration statuses...';
    this.allSessions = sessionsWithDateFilter.map(({ session, inConfiguredRange }) => {
      const fee = feesBySessionId.get(session.id);
      return {
        ...session,
        inConfiguredRange,
        fee,
        feeAmount: fee ? getApplicableFeeAmount(fee) ?? fee.amount : session.feeAmount
      };
    });
    this.statusFetchQueue = [];
    this.pendingStatusSessionIds = new Set();
    this.sessions = [];
    this.render();

    const configuredSessions = this.getConfiguredSessions(this.allSessions);
    this.sessions = configuredSessions;
    this.isLoading = false;
    this.render();
  }

  async initNavigatorValidation() {
    if (!this.cventSdk?.getNavigator) {
      return;
    }

    try {
      this.navigator = await this.cventSdk.getNavigator();
      this.applyNavigationValidity();
    } catch (error) {
      this.navigator = null;
    }
  }

  extractRegistrationTypeId(regTypePayload) {
    if (!regTypePayload) {
      return '';
    }

    if (typeof regTypePayload === 'string') {
      return regTypePayload;
    }

    return regTypePayload.registrationTypeId || regTypePayload.id || '';
  }

  filterSessionsByConfiguredCategories(sessions) {
    const configuredCategories = this.configuration?.allowedCategoryIds || [];
    if (!configuredCategories.length) {
      return sessions;
    }

    const allowedIds = new Set(configuredCategories);
    return sessions.filter(session => allowedIds.has(session.category?.id));
  }

  getConfiguredSessions(sessions) {
    const inDateRange = (sessions || []).filter(session => session.inConfiguredRange !== false);
    const openForRegistrationSessions = inDateRange.filter(session => this.isSessionOpenForRegistration(session));
    return this.filterSessionsByConfiguredCategories(openForRegistrationSessions);
  }

  isSessionOpenForRegistration(session) {
    return session?.isOpenForRegistration !== false;
  }

  resolveEffectiveDateRange(sessions) {
    const sessionDateKeys = sessions.map(session => dateKey(session.startDateTime)).sort();
    const firstSessionDate = sessionDateKeys[0] || '';
    const lastSessionDate = sessionDateKeys[sessionDateKeys.length - 1] || '';

    const configStartDate = this.normalizeDateInput(this.configuration?.startDate);
    const configEndDate = this.normalizeDateInput(this.configuration?.endDate);

    return {
      startDate: configStartDate || firstSessionDate,
      endDate: configEndDate || lastSessionDate
    };
  }

  normalizeDateInput(value) {
    if (!value || typeof value !== 'string') {
      return '';
    }

    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
  }

  isSessionInConfiguredRange(session, startDate, endDate) {
    const sessionDay = dateKey(session.startDateTime);

    if (startDate && sessionDay < startDate) {
      return false;
    }

    if (endDate && sessionDay > endDate) {
      return false;
    }

    return true;
  }

  async fetchFeesBySessionId() {
    const getFeesGenerator =
      this.cventSdk.getApplicableProductFeesGenerator || this.cventSdk.getProductFeesGenerator;

    if (!getFeesGenerator) {
      return new Map();
    }

    const feesGenerator = await getFeesGenerator.call(this.cventSdk, {
      filter: 'isActive = 1 and productType = "Session"',
      pageSize: this.configuration?.feesPageSize ?? 200
    });

    const feesBySessionId = new Map();

    for await (const page of feesGenerator) {
      const feeRecords = page?.records || page?.productFees || [];

      for (const fee of feeRecords) {
        const productId = fee.productId;

        if (!productId) {
          continue;
        }

        const existingFee = feesBySessionId.get(productId);
        if (!existingFee || (fee.isDefault && !existingFee.isDefault)) {
          feesBySessionId.set(productId, fee);
        }
      }
    }

    return feesBySessionId;
  }

  async fetchSessionStatusesSequentially(sessions, { loadVersion, delayMs = 0 } = {}) {
    const sortedSessions = this.sortSessionsByStartDateAsc(sessions || []);
    sortedSessions.forEach(session => this.queueStatusFetch(session.id));
    await this.processQueuedStatusFetches({ loadVersion, delayMs });
  }

  sortSessionsByStartDateAsc(sessions) {
    return [...sessions].sort((left, right) => {
      const leftStart = Number(new Date(left.startDateTime));
      const rightStart = Number(new Date(right.startDateTime));
      const leftValue = Number.isFinite(leftStart) ? leftStart : Number.POSITIVE_INFINITY;
      const rightValue = Number.isFinite(rightStart) ? rightStart : Number.POSITIVE_INFINITY;

      if (leftValue !== rightValue) {
        return leftValue - rightValue;
      }

      return String(left.id || '').localeCompare(String(right.id || ''));
    });
  }

  async refreshVisibleSessionStatusesOnly() {
    const loadVersion = ++this.statusLoadVersion;
    this.sessionStatuses = new Map();
    this.statusFetchQueue = [];
    this.pendingStatusSessionIds = new Set();
    this.sessionTilesById.forEach(tile => {
      tile.updateSelectionStatus(undefined);
    });
    this.enqueueVisibleSessionStatusFetches();
    await this.processQueuedStatusFetches({ loadVersion, delayMs: this.statusFetchDelayMs });
    if (this.statusLoadVersion !== loadVersion) {
      return;
    }
  }

  render() {
    if (!this.layoutInitialized) {
      this.initializeLayout();
    }

    const allSessions = this.sessions || [];
    const categories = this.getUniqueCategories(allSessions);
    if (this.selectedCategoryId && !categories.find(category => category.id === this.selectedCategoryId)) {
      this.selectedCategoryId = '';
    }

    const filteredSessions = this.getFilteredAndSortedSessions(allSessions);
    const selectedDaySessions =
      this.selectedDate === 'ALL'
        ? filteredSessions
        : filteredSessions.filter(session => dateKey(session.startDateTime) === this.selectedDate);

    const scheduleEntries = this.getScheduleEntries();
    this.mainLayout.classList.toggle('single-column', Boolean(this.configuration?.hideMyScheduleBox));
    this.updateCategoryTabs(categories);
    this.updateFilterToolbar();
    this.updateMainContent(selectedDaySessions, scheduleEntries);
    this.updateRuleStatusMessage();
    this.applyNavigationValidity();
  }

  initializeLayout() {
    if (this.layoutInitialized) {
      return;
    }

    this.pageTitleSection = this.createPageTitleSection();
    this.categoryTabs = document.createElement('div');
    this.categoryTabs.className = 'category-tabs';
    this.toolbarWrap = document.createElement('div');
    this.toolbarWrap.className = 'toolbar-wrap';
    this.mainLayout = document.createElement('div');
    this.mainLayout.className = 'main-layout';
    this.sessionList = document.createElement('div');
    this.sessionList.className = 'session-list';
    this.scheduleSidebar = document.createElement('aside');
    this.scheduleSidebar.className = 'schedule-sidebar';
    this.mainLayout.appendChild(this.sessionList);
    if (!this.configuration?.hideMyScheduleBox) {
      this.mainLayout.appendChild(this.scheduleSidebar);
    }
    this.root.append(this.pageTitleSection, this.categoryTabs, this.toolbarWrap, this.mainLayout);
    this.layoutInitialized = true;
  }

  createPageTitleSection() {
    const header = document.createElement('div');
    header.className = 'page-title-section';
    const widgetTitle = this.configuration?.widgetTitle || 'Build Your Weekend Schedule';
    this.ruleMessage = document.createElement('p');
    this.ruleMessage.className = 'rule-message';
    header.innerHTML = `
      <h2>${widgetTitle}</h2>
      <p>Browse sessions, refine results, and add your favorites to a live schedule summary.</p>
    `;
    header.appendChild(this.ruleMessage);
    return header;
  }

  normalizeRegistrationCategoryRules() {
    const rules = this.configuration?.registrationCategoryRules;
    if (!Array.isArray(rules)) {
      return [];
    }

    return rules
      .map(rule => ({
        registrationTypeId: typeof rule?.registrationTypeId === 'string' ? rule.registrationTypeId.trim() : '',
        categoryId: typeof rule?.categoryId === 'string' ? rule.categoryId.trim() : '',
        minSessions: Number(rule?.minSessions)
      }))
      .filter(rule => rule.registrationTypeId && rule.categoryId && Number.isFinite(rule.minSessions) && rule.minSessions > 0);
  }

  getActiveRegistrationRule() {
    const currentRegistrationTypeId = this.currentRegistrationTypeId;
    if (!currentRegistrationTypeId) {
      return null;
    }

    const rules = this.normalizeRegistrationCategoryRules();
    return rules.find(rule => rule.registrationTypeId === currentRegistrationTypeId) || null;
  }

  getSelectedCountForCategory(categoryId) {
    return (this.allSessions || []).filter(session => {
      if (session.category?.id !== categoryId) {
        return false;
      }
      const statusCode = this.getStatusCodeForSession(session.id);
      return ['SELECTED', 'WAITLISTED', 'INCLUDED', 'BUNDLED'].includes(statusCode);
    }).length;
  }

  getStatusCacheStorageKey() {
    const registrationType = this.currentRegistrationTypeId || 'ALL';
    const widgetId = this.configuration?.widgetInstanceId || this.configuration?.widgetId || 'default';
    const scope = `${window.location.pathname}|${registrationType}|${widgetId}`;
    return `session-browser:registered-session-ids:${scope}`;
  }

  getCachedRegisteredSessionIds() {
    try {
      const raw = window.localStorage.getItem(this.getStatusCacheStorageKey());
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string' && value) : [];
    } catch (error) {
      return [];
    }
  }

  setCachedRegisteredSessionIds(sessionIds) {
    try {
      const uniqueIds = [...new Set((sessionIds || []).filter(value => typeof value === 'string' && value))];
      window.localStorage.setItem(this.getStatusCacheStorageKey(), JSON.stringify(uniqueIds));
    } catch (error) {
      // no-op
    }
  }

  updateCachedRegisteredSessionId(sessionId, status) {
    if (!sessionId) {
      return;
    }

    const currentIds = new Set(this.getCachedRegisteredSessionIds());
    const statusCode = typeof status === 'string' ? status : status?.status;
    if (this.registeredStatusCodes.has(statusCode)) {
      currentIds.add(sessionId);
    } else {
      currentIds.delete(sessionId);
    }
    this.setCachedRegisteredSessionIds([...currentIds]);
  }

  setSessionStatus(sessionId, status) {
    this.sessionStatuses.set(sessionId, status || null);
    this.updateCachedRegisteredSessionId(sessionId, status || null);
  }

  getRuleStatus() {
    const activeRule = this.getActiveRegistrationRule();
    if (!activeRule) {
      return { hasRule: false, isValid: true, message: '' };
    }

    const categoryName =
      (this.allSessions || []).find(session => session.category?.id === activeRule.categoryId)?.category?.name ||
      'the required category';
    const selectedCount = this.getSelectedCountForCategory(activeRule.categoryId);
    const isValid = selectedCount >= activeRule.minSessions;
    const sessionsLabel = activeRule.minSessions === 1 ? 'session' : 'sessions';
    return {
      hasRule: true,
      isValid,
      message: `Required: select at least ${activeRule.minSessions} ${sessionsLabel} from ${categoryName}. (${selectedCount}/${activeRule.minSessions} selected)`
    };
  }

  updateRuleStatusMessage() {
    if (!this.ruleMessage) {
      return;
    }

    const ruleStatus = this.getRuleStatus();
    this.ruleMessage.textContent = ruleStatus.message;
    this.ruleMessage.classList.toggle('visible', Boolean(ruleStatus.hasRule && !ruleStatus.isValid));
    this.ruleMessage.classList.toggle('invalid', Boolean(ruleStatus.hasRule && !ruleStatus.isValid));
  }

  applyNavigationValidity() {
    if (!this.navigator?.setIsValid) {
      return;
    }

    const ruleStatus = this.getRuleStatus();
    this.navigator.setIsValid(ruleStatus.isValid);
  }

  attachNextNavigationGuard() {
    if (this.nextNavigationAttemptListener) {
      return;
    }

    this.nextNavigationAttemptListener = async event => {
      if (this.bypassNextNavigationGuard) {
        return;
      }

      const actionable = event.target?.closest?.('button, a, [role="button"], input[type="button"], input[type="submit"]');
      if (!actionable) {
        return;
      }

      const label = (actionable.textContent || actionable.value || '').trim().toLowerCase();
      const ariaLabel = (actionable.getAttribute?.('aria-label') || '').trim().toLowerCase();
      const isNextAction =
        /\b(next|continue|review|checkout)\b/.test(label) || /\b(next|continue|review|checkout)\b/.test(ariaLabel);

      if (!isNextAction) {
        return;
      }

      const initialRuleStatus = this.getRuleStatus();
      if (!initialRuleStatus.hasRule || initialRuleStatus.isValid) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      const finalRuleStatus = await this.validateRuleBeforeNavigation();
      if (finalRuleStatus.isValid) {
        this.retryNavigationAction(actionable);
        return;
      }

      this.showRuleRequirementModal(finalRuleStatus.message);
    };

    document.addEventListener('click', this.nextNavigationAttemptListener, true);
  }

  detachNextNavigationGuard() {
    if (!this.nextNavigationAttemptListener) {
      return;
    }

    document.removeEventListener('click', this.nextNavigationAttemptListener, true);
    this.nextNavigationAttemptListener = null;
  }

  showRuleRequirementModal(ruleMessage) {
    if (this.ruleRequirementModalOverlay) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'conflict-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'conflict-modal';
    modal.innerHTML = `
      <h3>Selection Requirement</h3>
      <p>${ruleMessage}</p>
      <p>Please satisfy this requirement before moving to the next page.</p>
    `;

    const buttonRow = document.createElement('div');
    buttonRow.className = 'conflict-modal-actions';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-btn primary';
    closeBtn.textContent = 'OK';
    closeBtn.onclick = () => {
      overlay.remove();
      this.ruleRequirementModalOverlay = null;
    };

    buttonRow.appendChild(closeBtn);
    modal.appendChild(buttonRow);
    overlay.appendChild(modal);
    this.shadowRoot.appendChild(overlay);
    this.ruleRequirementModalOverlay = overlay;
  }

  getCategorySessionIdsWithUnloadedStatuses(categoryId) {
    if (!categoryId) {
      return [];
    }

    return (this.allSessions || [])
      .filter(session => session.category?.id === categoryId)
      .map(session => session.id)
      .filter(sessionId => !this.sessionStatuses.has(sessionId));
  }

  async validateRuleBeforeNavigation() {
    const activeRule = this.getActiveRegistrationRule();
    if (!activeRule) {
      return { hasRule: false, isValid: true, message: '' };
    }

    const unloadedSessionIds = this.getCategorySessionIdsWithUnloadedStatuses(activeRule.categoryId);
    if (unloadedSessionIds.length) {
      const cachedRegisteredIds = this.getCachedRegisteredSessionIds();
      const prioritizedIds = cachedRegisteredIds.filter(sessionId => unloadedSessionIds.includes(sessionId));
      const remainingIds = unloadedSessionIds.filter(sessionId => !prioritizedIds.includes(sessionId));
      const statusLoadOrder = [...prioritizedIds, ...remainingIds];
      const loadingOverlay = this.showRequirementCheckLoadingModal();
      try {
        const statusCheck = await this.loadStatusesForSessionsUntilRuleSatisfied(statusLoadOrder);
        if (statusCheck?.isValid) {
          this.render();
          return statusCheck;
        }
      } finally {
        loadingOverlay.remove();
      }
    }

    this.render();
    return this.getRuleStatus();
  }

  async loadStatusesForSessionsUntilRuleSatisfied(sessionIds) {
    for (const sessionId of sessionIds) {
      if (!sessionId || this.sessionStatuses.has(sessionId)) {
        continue;
      }

      try {
        const status = await this.cventSdk.getSessionStatus(sessionId);
        this.setSessionStatus(sessionId, status || null);
      } catch (error) {
        this.setSessionStatus(sessionId, null);
      }

      this.updateSessionTileStatus(sessionId);
      const ruleStatus = this.getRuleStatus();
      if (ruleStatus.isValid) {
        return ruleStatus;
      }
    }

    return this.getRuleStatus();
  }

  showRequirementCheckLoadingModal() {
    const overlay = document.createElement('div');
    overlay.className = 'conflict-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'conflict-modal';
    modal.innerHTML = `
      <h3>Checking Requirements</h3>
      <img
        class="loading-gif"
        src="data:image/gif;base64,R0lGODlhEAAQAPIAAP///wAAAMLCwkJCQmZmZv///wAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAAACwAAAAAEAAQAAADMwi63P4wyklrE2MIOggZnAdOmGYJRbExwroUmrYxWQAAIfkEBQoAAAAsAAAAABAAEAAAAzMIutz+MMpJaxNjCDoIGZwHTphmCUWxMcK6FJq2MVkAACH5BAUKAAAALAAAAAAQABAAAAMzCLrc/jDKSWsTYwg6CBmcB06YZglFsTHCuhSatjFZAAA7"
        alt="Checking requirements"
      />
      <p>We are checking requirements. Please wait as this could take 30 seconds.</p>
      <progress></progress>
    `;

    overlay.appendChild(modal);
    this.shadowRoot.appendChild(overlay);
    return overlay;
  }

  retryNavigationAction(actionable) {
    this.bypassNextNavigationGuard = true;
    try {
      actionable.click?.();
    } finally {
      setTimeout(() => {
        this.bypassNextNavigationGuard = false;
      }, 0);
    }
  }


  updateCategoryTabs(categories) {
    const wrap = this.categoryTabs;
    wrap.replaceChildren();
    const allButton = document.createElement('button');
    allButton.className = `category-pill ${!this.selectedCategoryId ? 'active' : ''}`;
    allButton.textContent = 'All Categories';
    allButton.onclick = () => {
      this.selectedCategoryId = '';
      this.render();
    };
    wrap.appendChild(allButton);

    categories.forEach(category => {
      const button = document.createElement('button');
      button.className = `category-pill ${this.selectedCategoryId === category.id ? 'active' : ''}`;
      button.textContent = category.name;
      button.onclick = () => {
        this.selectedCategoryId = category.id;
        this.render();
      };
      wrap.appendChild(button);
    });

  }

  updateFilterToolbar() {
    const toolbar = this.toolbarWrap;
    const shouldKeepSearchFocus = this.shadowRoot.activeElement?.classList?.contains('search-input');
    const previousSelectionStart = shouldKeepSearchFocus ? this.shadowRoot.activeElement.selectionStart : null;
    const previousSelectionEnd = shouldKeepSearchFocus ? this.shadowRoot.activeElement.selectionEnd : null;
    toolbar.replaceChildren();
    const compactControls = document.createElement('div');
    compactControls.className = 'compact-controls';

    const filtersButton = document.createElement('button');
    filtersButton.className = 'compact-btn';
    filtersButton.textContent = this.showMobileFilters ? 'Hide Filters' : 'Filters';
    filtersButton.onclick = () => {
      this.showMobileFilters = !this.showMobileFilters;
      this.render();
    };

    const sortButton = document.createElement('button');
    sortButton.className = 'compact-btn';
    sortButton.textContent = 'Sort';
    sortButton.onclick = () => {
      const options = ['START_TIME', 'NAME', 'PRICE'];
      const currentIndex = options.indexOf(this.sortBy);
      this.sortBy = options[(currentIndex + 1) % options.length];
      this.render();
    };

    compactControls.append(filtersButton, sortButton);

    const row = document.createElement('div');
    row.className = `toolbar ${this.showMobileFilters ? 'show-mobile' : ''}`;

    const dayFilter = this.createSelectControl('Day', this.selectedDate, this.getDayFilterOptions(), value => {
      this.selectedDate = value;
      this.render();
    });

    const typeOptions = this.getSessionTypeOptions();
    if (this.selectedType !== 'ALL' && !typeOptions.find(([value]) => value === this.selectedType)) {
      this.selectedType = 'ALL';
    }
    const typeFilter = this.createSelectControl('Session type', this.selectedType, typeOptions, value => {
      this.selectedType = value;
      this.render();
    });

    const sortFilter = this.createSelectControl(
      'Sort',
      this.sortBy,
      [
        ['START_TIME', 'Start time'],
        ['NAME', 'Name'],
        ['PRICE', 'Price']
      ],
      value => {
        this.sortBy = value;
        this.render();
      }
    );

    const searchWrap = document.createElement('label');
    searchWrap.className = 'search-wrap';
    const searchInput = document.createElement('input');
    searchInput.className = 'search-input';
    searchInput.type = 'search';
    searchInput.placeholder = 'Search sessions';
    searchInput.value = this.searchQuery;
    searchInput.oninput = () => {
      this.searchQuery = searchInput.value;
      this.renderSessionResults();
    };
    searchWrap.append(searchInput);

    row.append(dayFilter, typeFilter, sortFilter, searchWrap);
    toolbar.append(compactControls, row);

    if (shouldKeepSearchFocus) {
      searchInput.focus();
      if (typeof previousSelectionStart === 'number' && typeof previousSelectionEnd === 'number') {
        searchInput.setSelectionRange(previousSelectionStart, previousSelectionEnd);
      }
    }
  }

  createSelectControl(labelText, value, options, onChange) {
    const label = document.createElement('label');
    label.className = 'control';

    const title = document.createElement('span');
    title.textContent = labelText;

    const select = document.createElement('select');
    options.forEach(([optionValue, optionLabel]) => {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionLabel;
      option.selected = optionValue === value;
      select.appendChild(option);
    });

    select.onchange = () => onChange(select.value);
    label.append(title, select);
    return label;
  }

  updateMainContent(sessions, scheduleEntries) {
    const leftColumn = this.sessionList;
    leftColumn.replaceChildren();
    this.sessionTilesById = new Map();
    this.renderedSessionIds = [];
    this.ensureStatusObserver();

    sessions.forEach(session => {
      const tile = new SessionTile(
        session,
        this.theme,
        async sessionId => this.handleSessionAction(sessionId),
        this.sessionStatuses.get(session.id)
      );
      tile.dataset.sessionId = session.id;
      this.sessionTilesById.set(session.id, tile);
      this.renderedSessionIds.push(session.id);
      leftColumn.appendChild(tile);
      this.statusObserver?.observe(tile);
    });

    if (!sessions.length && !this.isLoading) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No sessions match the selected filters.';
      leftColumn.appendChild(empty);
    }

    if (this.isLoading) {
      leftColumn.appendChild(this.createLoadingState());
    }

    if (!this.configuration?.hideMyScheduleBox) {
      this.updateScheduleSidebar(scheduleEntries);
    }
  }

  updateSessionTileStatus(sessionId) {
    if (this.configuration?.hideClosedUnavailableSessions) {
      this.renderSessionResults();
      this.updateRuleStatusMessage();
      this.applyNavigationValidity();
      return;
    }

    const tile = this.sessionTilesById.get(sessionId);
    if (!tile) {
      return;
    }
    tile.updateSelectionStatus(this.sessionStatuses.get(sessionId));
    if (!this.configuration?.hideMyScheduleBox && this.scheduleSidebar) {
      this.updateScheduleSidebar(this.getScheduleEntries());
    }
  }

  async handleSessionAction(sessionId) {
    if (!this.cventSdk.pickSession) {
      return { success: false };
    }

    const session = (this.allSessions || []).find(item => item.id === sessionId);
    const currentStatus = this.getStatusCodeForSession(sessionId);
    const isRegisterAction = ['OPEN', 'OPEN_FROM_WAITLIST', 'WAITLIST_AVAILABLE'].includes(currentStatus);

    if (isRegisterAction && this.configuration?.preventOverlapRegistration && session) {
      const conflict = await this.findOverlappingSelectedSession(session);
      if (conflict) {
        const shouldSwap = await this.showConflictModal(conflict, session);
        if (!shouldSwap) {
          return { success: false };
        }

        await this.cventSdk.pickSession(conflict.id);
        const updatedConflictStatus = await this.cventSdk.getSessionStatus(conflict.id);
        this.setSessionStatus(conflict.id, updatedConflictStatus || null);
      }
    }

    const pickResult = await this.cventSdk.pickSession(sessionId);
    if (!pickResult?.success) {
      return { success: false };
    }

    const updatedStatus = await this.cventSdk.getSessionStatus(sessionId);
    this.setSessionStatus(sessionId, updatedStatus || null);
    this.render();
    return {
      success: true,
      status: updatedStatus || null
    };
  }

  async findOverlappingSelectedSession(targetSession) {
    const excludedIds = new Set(this.configuration?.overlapExcludedSessionIds || []);
    if (excludedIds.has(targetSession.id)) {
      return null;
    }

    const overlappingSessions = (this.allSessions || []).filter(session => {
      if (session.id === targetSession.id || excludedIds.has(session.id)) {
        return false;
      }
      return this.sessionsOverlap(session, targetSession);
    });

    for (const session of overlappingSessions) {
      const status = await this.getLoadedStatusCodeForSession(session.id);
      if (['SELECTED', 'WAITLISTED', 'INCLUDED', 'BUNDLED'].includes(status)) {
        return session;
      }
    }

    return null;
  }

  async getLoadedStatusCodeForSession(sessionId) {
    if (!this.sessionStatuses.has(sessionId)) {
      try {
        const status = await this.cventSdk.getSessionStatus(sessionId);
        this.setSessionStatus(sessionId, status || null);
      } catch (error) {
        this.setSessionStatus(sessionId, null);
      }
    }

    return this.getStatusCodeForSession(sessionId);
  }

  sessionsOverlap(sessionA, sessionB) {
    const aStart = new Date(sessionA.startDateTime).getTime();
    const aEnd = new Date(sessionA.endDateTime).getTime();
    const bStart = new Date(sessionB.startDateTime).getTime();
    const bEnd = new Date(sessionB.endDateTime).getTime();

    return aStart < bEnd && bStart < aEnd;
  }

  showConflictModal(conflictingSession, selectedSession) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'conflict-modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'conflict-modal';
      modal.innerHTML = `
        <h3>Session Conflict</h3>
        <p>
          You are already registered for <strong>${conflictingSession.name}</strong>, which overlaps with
          <strong>${selectedSession.name}</strong>.
        </p>
        <p>Do you want to unregister from the conflicting session and register for this one?</p>
      `;

      const buttonRow = document.createElement('div');
      buttonRow.className = 'conflict-modal-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'modal-btn neutral';
      cancelBtn.textContent = 'Keep current registration';
      cancelBtn.onclick = () => {
        overlay.remove();
        resolve(false);
      };

      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'modal-btn primary';
      confirmBtn.textContent = 'Switch sessions';
      confirmBtn.onclick = () => {
        overlay.remove();
        resolve(true);
      };

      buttonRow.append(cancelBtn, confirmBtn);
      modal.appendChild(buttonRow);
      overlay.appendChild(modal);
      this.shadowRoot.appendChild(overlay);
    });
  }

  createLoadingState() {
    const loading = document.createElement('div');
    loading.className = 'loading-state';
    loading.innerHTML = `
      <img
        class="loading-gif"
        src="data:image/gif;base64,R0lGODlhEAAQAPIAAP///wAAAMLCwkJCQmZmZv///wAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAAACwAAAAAEAAQAAADMwi63P4wyklrE2MIOggZnAdOmGYJRbExwroUmrYxWQAAIfkEBQoAAAAsAAAAABAAEAAAAzMIutz+MMpJaxNjCDoIGZwHTphmCUWxMcK6FJq2MVkAACH5BAUKAAAALAAAAAAQABAAAAMzCLrc/jDKSWsTYwg6CBmcB06YZglFsTHCuhSatjFZAAA7"
        alt="Loading"
      />
      <p>${this.loadingMessage}</p>
      <progress></progress>
    `;
    return loading;
  }

  updateScheduleSidebar(scheduleEntries) {
    const sidebar = this.scheduleSidebar;
    sidebar.replaceChildren();

    const heading = document.createElement('h3');
    heading.textContent = `My Schedule (${scheduleEntries.length})`;
    sidebar.appendChild(heading);

    if (!scheduleEntries.length) {
      const empty = document.createElement('p');
      empty.className = 'schedule-empty';
      empty.textContent = 'Add sessions to build your weekend plan.';
      sidebar.appendChild(empty);
    } else {
      const grouped = scheduleEntries.reduce((acc, entry) => {
        if (!acc[entry.day]) {
          acc[entry.day] = [];
        }
        acc[entry.day].push(entry);
        return acc;
      }, {});

      Object.keys(grouped)
        .sort((a, b) => new Date(a) - new Date(b))
        .forEach(day => {
          const dayGroup = document.createElement('section');
          dayGroup.className = 'schedule-day';

          const dayTitle = document.createElement('h4');
          dayTitle.textContent = prettyDate(day);
          dayGroup.appendChild(dayTitle);

          grouped[day]
            .sort((a, b) => new Date(a.session.startDateTime) - new Date(b.session.startDateTime))
            .forEach(entry => {
              const row = document.createElement('div');
              row.className = 'schedule-item';

              const left = document.createElement('div');
              left.className = 'schedule-item-meta';
              left.innerHTML = `
                <p class="time">${entry.time}</p>
                <p class="name">${entry.session.name}</p>
                <span class="mini-badge ${entry.isIncluded ? 'included' : 'price'}">${entry.label}</span>
              `;

              const removeBtn = document.createElement('button');
              removeBtn.className = 'remove-btn';
              removeBtn.textContent = 'Remove';
              removeBtn.onclick = async () => {
                if (this.cventSdk.pickSession) {
                  await this.cventSdk.pickSession(entry.session.id);
                  const updatedStatus = await this.cventSdk.getSessionStatus(entry.session.id);
                  this.setSessionStatus(entry.session.id, updatedStatus || null);
                  this.render();
                }
              };

              row.append(left, removeBtn);
              dayGroup.appendChild(row);
            });

          sidebar.appendChild(dayGroup);
        });
    }

    const summary = document.createElement('div');
    summary.className = 'schedule-summary';
    const total = scheduleEntries.reduce((sum, entry) => sum + (entry.isIncluded ? 0 : entry.amount), 0);
    summary.innerHTML = `<p>Session add-on total: <strong>$${total.toFixed(2)}</strong></p>`;
    sidebar.appendChild(summary);
  }

  getScheduleEntries() {
    return (this.allSessions || [])
      .filter(session => {
        const code = this.getStatusCodeForSession(session.id);
        return ['SELECTED', 'WAITLISTED', 'INCLUDED', 'BUNDLED'].includes(code);
      })
      .map(session => {
        const amount = this.resolveSessionAmount(session);
        const isIncluded = amount === 0 || ['INCLUDED', 'BUNDLED'].includes(this.getStatusCodeForSession(session.id));
        return {
          session,
          day: dateKey(session.startDateTime),
          time: this.getSessionTimeLabel(session),
          amount,
          isIncluded,
          label: isIncluded ? 'Included' : `$${amount.toFixed(2)} add-on`
        };
      });
  }

  getStatusCodeForSession(sessionId) {
    const status = this.sessionStatuses.get(sessionId);
    if (typeof status === 'string') {
      return status;
    }
    return status?.status || '';
  }

  getSessionTimeLabel(session) {
    const start = new Date(session.startDateTime);
    const end = new Date(session.endDateTime);
    return `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })}`;
  }

  resolveSessionAmount(session) {
    const amount =
      session.feeAmount ??
      session.price ??
      session.fee?.amount ??
      session.fee?.chargePolicies?.find(policy => policy.isActive)?.amount;
    if (amount === undefined || amount === null) {
      return 0;
    }
    return Number(amount) || 0;
  }

  getDayFilterOptions() {
    const days = [...new Set((this.sessions || []).map(session => dateKey(session.startDateTime)).filter(Boolean))].sort();
    return [['ALL', 'All days'], ...days.map(day => [day, prettyDate(day)])];
  }

  getSessionTypeOptions() {
    const sessionsInSelectedDate =
      this.selectedDate === 'ALL'
        ? this.sessions || []
        : (this.sessions || []).filter(session => dateKey(session.startDateTime) === this.selectedDate);
    const typeValues = [...new Set(sessionsInSelectedDate.map(session => (session.type || '').toUpperCase()).filter(Boolean))];
    const labelForType = type => type.charAt(0) + type.slice(1).toLowerCase();
    const sortedOptions = typeValues.sort().map(type => [type, labelForType(type)]);
    return [['ALL', 'All'], ...sortedOptions];
  }

  renderSessionResults() {
    const filteredSessions = this.getFilteredAndSortedSessions(this.sessions || []);
    const selectedDaySessions =
      this.selectedDate === 'ALL'
        ? filteredSessions
        : filteredSessions.filter(session => dateKey(session.startDateTime) === this.selectedDate);
    const scheduleEntries = this.getScheduleEntries();
    this.updateMainContent(selectedDaySessions, scheduleEntries);
  }

  getFilteredAndSortedSessions(sessions) {
    let filtered = [...sessions];

    if (this.configuration?.hideClosedUnavailableSessions) {
      filtered = filtered.filter(session => !this.isClosedOrUnavailableSession(session.id));
    }

    if (this.selectedCategoryId) {
      filtered = filtered.filter(session => session.category?.id === this.selectedCategoryId);
    }

    if (this.selectedType !== 'ALL') {
      filtered = filtered.filter(session => (session.type || '').toUpperCase() === this.selectedType);
    }

    const search = this.searchQuery.trim().toLowerCase();
    if (search) {
      filtered = filtered.filter(session => {
        const haystack = [session.name, session.description, session.location?.name, session.category?.name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      });
    }

    filtered.sort((a, b) => {
      if (this.sortBy === 'NAME') {
        return a.name.localeCompare(b.name);
      }

      if (this.sortBy === 'PRICE') {
        return this.resolveSessionAmount(a) - this.resolveSessionAmount(b);
      }

      return new Date(a.startDateTime) - new Date(b.startDateTime);
    });

    return filtered;
  }

  isClosedOrUnavailableSession(sessionId) {
    if (!this.sessionStatuses.has(sessionId)) {
      return false;
    }

    const statusCode = this.getStatusCodeForSession(sessionId);
    return ['CLOSED', 'UNAVAILABLE'].includes(statusCode);
  }

  getUniqueCategories(sessions) {
    const map = new Map();
    sessions.forEach(session => {
      if (session.category?.id) {
        map.set(session.category.id, session.category);
      }
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .widget-root {
        font-family: Arial, sans-serif;
        background: #f8f5f4;
        border-radius: 20px;
        padding: 20px;
        color: #111827;
      }
      .page-title-section {
        text-align: center;
        margin-bottom: 16px;
      }
      .page-title-section h2 {
        margin: 0;
        font-size: clamp(1.6rem, 3vw, 2.25rem);
      }
      .page-title-section p {
        margin: 10px auto 0;
        max-width: 720px;
        color: #4b5563;
      }
      .rule-message {
        display: none;
        margin: 12px auto 0;
        max-width: 720px;
        border-radius: 12px;
        padding: 10px 12px;
        background: #eff6ff;
        color: #1d4ed8;
        font-weight: 600;
      }
      .rule-message.visible {
        display: block;
      }
      .rule-message.invalid {
        background: #fef2f2;
        color: #b91c1c;
      }
      .category-tabs {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        padding-bottom: 8px;
        margin-bottom: 14px;
      }
      .category-pill {
        border: 1px solid #d6d3d1;
        background: #fff;
        color: #7f1d1d;
        border-radius: 999px;
        padding: 10px 16px;
        font-weight: 700;
        white-space: nowrap;
        cursor: pointer;
      }
      .category-pill.active {
        background: #8b1d2c;
        color: #fff;
        border-color: #8b1d2c;
      }
      .toolbar-wrap {
        margin-bottom: 16px;
      }
      .compact-controls {
        display: none;
        gap: 8px;
        margin-bottom: 8px;
      }
      .compact-btn {
        border: 1px solid #d1d5db;
        background: #fff;
        border-radius: 999px;
        padding: 8px 14px;
        font-weight: 700;
        color: #374151;
      }
      .toolbar {
        display: flex;
        gap: 10px;
        align-items: end;
      }
      .control {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 0.8rem;
        color: #6b7280;
      }
      .control select,
      .search-wrap input {
        border: 1px solid #d1d5db;
        background: #fff;
        border-radius: 12px;
        padding: 10px 12px;
        min-width: 160px;
      }
      .search-wrap {
        margin-left: auto;
      }
      .search-wrap input {
        min-width: 260px;
      }
      .main-layout {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
        gap: 16px;
        align-items: start;
      }
      .main-layout.single-column {
        grid-template-columns: minmax(0, 1fr);
      }
      .session-list {
        display: grid;
        gap: 12px;
        max-height: 100vh;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .schedule-sidebar {
        position: sticky;
        top: 170px;
        background: #fff;
        border: 1px solid #ececec;
        border-radius: 16px;
        box-shadow: 0 14px 28px rgba(31, 41, 55, 0.08);
        padding: 14px;
      }
      .schedule-sidebar h3 {
        margin: 0 0 12px;
      }
      .schedule-empty {
        margin: 0;
        color: #6b7280;
      }
      .schedule-day {
        border-top: 1px solid #f1f5f9;
        padding-top: 10px;
        margin-top: 10px;
      }
      .schedule-day h4 {
        margin: 0 0 8px;
        color: #4b5563;
      }
      .schedule-item {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 0;
      }
      .schedule-item .time,
      .schedule-item .name {
        margin: 0;
      }
      .schedule-item .time {
        font-size: 0.8rem;
        color: #6b7280;
      }
      .schedule-item .name {
        font-size: 0.88rem;
      }
      .mini-badge {
        display: inline-block;
        margin-top: 4px;
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 0.74rem;
      }
      .mini-badge.included {
        background: #dcfce7;
        color: #166534;
      }
      .mini-badge.price {
        background: #fee2e2;
        color: #991b1b;
      }
      .remove-btn {
        border: none;
        background: transparent;
        color: #991b1b;
        cursor: pointer;
        font-weight: 700;
      }
      .schedule-summary {
        border-top: 1px solid #e5e7eb;
        margin-top: 12px;
        padding-top: 12px;
      }
      .schedule-summary p {
        margin: 0 0 10px;
      }
      .empty {
        color: #6b7280;
      }
      .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 120px;
        background: #fff;
        border: 1px solid #ececec;
        border-radius: 12px;
      }
      .loading-gif {
        width: 28px;
        height: 28px;
      }
      .loading-state p {
        margin: 0;
        color: #4b5563;
      }
      .loading-state progress {
        width: min(280px, 75%);
        height: 10px;
      }
      .conflict-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }
      .conflict-modal {
        width: min(460px, calc(100% - 24px));
        border-radius: 14px;
        background: #fff;
        padding: 18px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.22);
      }
      .conflict-modal h3 {
        margin: 0 0 10px;
      }
      .conflict-modal p {
        margin: 0 0 10px;
      }
      .conflict-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 12px;
      }
      .modal-btn {
        border: none;
        border-radius: 999px;
        padding: 9px 14px;
        cursor: pointer;
        font-weight: 700;
      }
      .modal-btn.neutral {
        background: #e5e7eb;
        color: #374151;
      }
      .modal-btn.primary {
        background: #8b1d2c;
        color: #fff;
      }
      .recommendations {
        margin-top: 16px;
        border-top: 1px solid #e5e7eb;
        padding-top: 12px;
        color: #374151;
      }
      @media (max-width: 920px) {
        .main-layout {
          grid-template-columns: 1fr;
        }
        .schedule-sidebar {
          position: static;
        }
      }
      @media (max-width: 760px) {
        .toolbar {
          display: none;
          flex-direction: column;
          align-items: stretch;
        }
        .toolbar.show-mobile {
          display: flex;
        }
        .compact-controls {
          display: flex;
        }
        .search-wrap {
          margin-left: 0;
        }
        .search-wrap input,
        .control select {
          width: 100%;
          min-width: 0;
        }
      }
    `;
    return style;
  }

  ensureStatusObserver() {
    if (this.statusObserver) {
      this.statusObserver.disconnect();
    }

    this.statusObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) {
            return;
          }

          const sessionId = entry.target?.dataset?.sessionId;
          if (!sessionId) {
            return;
          }

          const sessionIdsToFetch = this.getSessionIdsToFetchInAdvance(sessionId, 3);
          sessionIdsToFetch.forEach(nextSessionId => {
            const tile = this.sessionTilesById.get(nextSessionId);
            if (tile) {
              this.statusObserver?.unobserve(tile);
            }
            this.queueStatusFetch(nextSessionId);
          });
        });
        this.processQueuedStatusFetches({ loadVersion: this.statusLoadVersion, delayMs: this.statusFetchDelayMs });
      },
      { root: null, threshold: 0.1, rootMargin: '120px 0px' }
    );
  }

  disconnectStatusObserver() {
    if (this.statusObserver) {
      this.statusObserver.disconnect();
      this.statusObserver = null;
    }
  }

  enqueueVisibleSessionStatusFetches() {
    this.sessionTilesById.forEach((tile, sessionId) => {
      const rect = tile.getBoundingClientRect();
      const isVisible = rect.bottom >= 0 && rect.top <= window.innerHeight;
      if (isVisible) {
        this.queueStatusFetch(sessionId);
      }
    });
  }

  queueStatusFetch(sessionId) {
    if (!sessionId || this.sessionStatuses.has(sessionId) || this.pendingStatusSessionIds.has(sessionId)) {
      return;
    }

    this.pendingStatusSessionIds.add(sessionId);
    this.statusFetchQueue.push(sessionId);
  }

  getSessionIdsToFetchInAdvance(sessionId, additionalAheadCount = 0) {
    const visibleSessionIndex = this.renderedSessionIds.indexOf(sessionId);
    if (visibleSessionIndex === -1) {
      return [sessionId];
    }

    const maxIndex = Math.min(this.renderedSessionIds.length - 1, visibleSessionIndex + additionalAheadCount);
    return this.renderedSessionIds.slice(visibleSessionIndex, maxIndex + 1);
  }

  async processQueuedStatusFetches({ loadVersion, delayMs = 0 } = {}) {
    if (this.isProcessingStatusQueue) {
      return;
    }

    this.isProcessingStatusQueue = true;
    try {
      while (this.statusFetchQueue.length) {
        if (this.statusLoadVersion !== loadVersion) {
          return;
        }

        const sessionId = this.statusFetchQueue.shift();
        this.pendingStatusSessionIds.delete(sessionId);

        try {
          const status = await this.cventSdk.getSessionStatus(sessionId);
          this.setSessionStatus(sessionId, status || null);
        } catch (error) {
          this.setSessionStatus(sessionId, null);
        }

        if (this.statusLoadVersion !== loadVersion) {
          return;
        }

        this.updateSessionTileStatus(sessionId);
        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }
    } finally {
      this.isProcessingStatusQueue = false;
    }
  }
}

const getApplicableFeeAmount = fee => {
  const now = Date.now();
  const activeChargePolicies = (fee?.chargePolicies || [])
    .filter(policy => policy.isActive)
    .filter(policy => new Date(policy.effectiveUntil).getTime() + 24 * 60 * 60 * 1000 > now)
    .sort((a, b) => new Date(a.effectiveUntil).getTime() - new Date(b.effectiveUntil).getTime());

  if (!activeChargePolicies.length) {
    return null;
  }

  return activeChargePolicies[0].amount;
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
