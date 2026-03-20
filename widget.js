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

    await this.fetchAndRender();

    const rerender = async () => {
      await this.fetchAndRender();
    };

    const admitItemObserve = this.cventSdk.observe(ObserveSubject.ADMISSION_ITEM, rerender);
    const regTypeObserve = this.cventSdk.observe(ObserveSubject.REGISTRATION_TYPE, rerender);
    this.unsubCallbacks.push(admitItemObserve.unobserve, regTypeObserve.unobserve);
  }

  disconnectedCallback() {
    this.unsubCallbacks.forEach(unsub => unsub?.());
  }

  async fetchAndRender() {
    const generator = await this.cventSdk.getSessionGenerator('nameAsc', this.configuration?.pageSize ?? 50, {
      byRegistrationTypeAndAdmissionItem: true
    });

    const sessions = [];
    for await (const page of generator) {
      sessions.push(...(page.sessions || []));
    }

    const { startDate, endDate } = this.resolveEffectiveDateRange(sessions);
    const inRangeSessions = sessions.filter(session => this.isSessionInConfiguredRange(session, startDate, endDate));

    const feesBySessionId = await this.fetchFeesBySessionId();

    this.sessions = inRangeSessions.map(session => {
      const fee = feesBySessionId.get(session.id);
      if (!fee) {
        return session;
      }

      const chargePolicyAmount = getApplicableFeeAmount(fee);
      return {
        ...session,
        fee,
        feeAmount: chargePolicyAmount ?? fee.amount
      };
    });
    await this.refreshSessionStatuses();
    this.render();
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
    if (!this.cventSdk.getProductFeesGenerator) {
      return new Map();
    }

    const feesGenerator = await this.cventSdk.getProductFeesGenerator({
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

  async refreshSessionStatuses() {
    const statusEntries = await Promise.all(
      (this.sessions || []).map(async session => {
        try {
          const status = await this.cventSdk.getSessionStatus(session.id);
          return [session.id, status || null];
        } catch (error) {
          return [session.id, null];
        }
      })
    );

    this.sessionStatuses = new Map(statusEntries);
  }

  render() {
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

    this.root.replaceChildren(
      this.createPageTitleSection(),
      this.createCategoryTabs(categories),
      this.createFilterToolbar(),
      this.createMainContent(selectedDaySessions, scheduleEntries),
      this.createRecommendations()
    );
  }

  createPageTitleSection() {
    const header = document.createElement('div');
    header.className = 'page-title-section';
    header.innerHTML = `
      <h2>Build Your Weekend Schedule</h2>
      <p>Browse sessions, refine results, and add your favorites to a live schedule summary.</p>
    `;
    return header;
  }

  createCategoryTabs(categories) {
    const wrap = document.createElement('div');
    wrap.className = 'category-tabs';

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

    return wrap;
  }

  createFilterToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar-wrap';

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

    const typeFilter = this.createSelectControl(
      'Session type',
      this.selectedType,
      [
        ['ALL', 'All'],
        ['SHOW', 'Show'],
        ['WORKSHOP', 'Workshop'],
        ['DINING', 'Dining'],
        ['SPECIAL', 'Special']
      ],
      value => {
        this.selectedType = value;
        this.render();
      }
    );

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
    searchInput.type = 'search';
    searchInput.placeholder = 'Search sessions';
    searchInput.value = this.searchQuery;
    searchInput.oninput = () => {
      this.searchQuery = searchInput.value;
      this.render();
    };
    searchWrap.append(searchInput);

    row.append(dayFilter, typeFilter, sortFilter, searchWrap);
    toolbar.append(compactControls, row);
    return toolbar;
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

  createMainContent(sessions, scheduleEntries) {
    const layout = document.createElement('div');
    layout.className = 'main-layout';

    const leftColumn = document.createElement('div');
    leftColumn.className = 'session-list';
    sessions.forEach(session => {
      const tile = new SessionTile(
        session,
        this.theme,
        async sessionId => {
          if (this.cventSdk.pickSession) {
            const pickResult = await this.cventSdk.pickSession(sessionId);
            if (!pickResult?.success) {
              return { success: false };
            }

            const updatedStatus = await this.cventSdk.getSessionStatus(sessionId);
            this.sessionStatuses.set(sessionId, updatedStatus || null);
            this.render();
            return {
              success: true,
              status: updatedStatus || null
            };
          }
          return { success: false };
        },
        this.sessionStatuses.get(session.id)
      );
      leftColumn.appendChild(tile);
    });

    if (!sessions.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No sessions match the selected filters.';
      leftColumn.appendChild(empty);
    }

    const rightColumn = this.createScheduleSidebar(scheduleEntries);
    layout.append(leftColumn, rightColumn);
    return layout;
  }

  createScheduleSidebar(scheduleEntries) {
    const sidebar = document.createElement('aside');
    sidebar.className = 'schedule-sidebar';

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
                  this.sessionStatuses.set(entry.session.id, updatedStatus || null);
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

    const continueButton = document.createElement('button');
    continueButton.className = 'continue-btn';
    continueButton.textContent = 'Continue';
    continueButton.disabled = !scheduleEntries.length;

    summary.appendChild(continueButton);
    sidebar.appendChild(summary);

    return sidebar;
  }

  createRecommendations() {
    if (!this.configuration?.showUxRecommendations) {
      return document.createElement('div');
    }

    const wrap = document.createElement('aside');
    wrap.className = 'recommendations';
    wrap.innerHTML = `
      <h3>UX/UI recommendations for large session catalogs</h3>
      <ul>
        <li>Add search with typo tolerance and speaker/location indexing.</li>
        <li>Add sticky summary chips for active filters and one-click clear.</li>
        <li>Use progressive loading (infinite scroll or "load more") for 100s of tiles.</li>
        <li>Offer sort options: start time, popularity, availability, and featured.</li>
        <li>Add an agenda conflict indicator before registration confirmation.</li>
      </ul>
    `;
    return wrap;
  }

  getScheduleEntries() {
    return (this.sessions || [])
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
    return start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

  getFilteredAndSortedSessions(sessions) {
    let filtered = [...sessions];

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
      .session-list {
        display: grid;
        gap: 12px;
      }
      .schedule-sidebar {
        position: sticky;
        top: 12px;
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
      .continue-btn {
        width: 100%;
        border: none;
        border-radius: 12px;
        padding: 10px;
        background: #8b1d2c;
        color: #fff;
        font-weight: 700;
      }
      .continue-btn:disabled {
        background: #d1d5db;
        color: #6b7280;
      }
      .empty {
        color: #6b7280;
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
