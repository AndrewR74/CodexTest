import { SessionTile } from './SessionTile.js';

const ObserveSubject = {
  REGISTRATION_TYPE: 'REGISTRATION_TYPE',
  ADMISSION_ITEM: 'ADMISSION_ITEM'
};

const dateKey = value => new Date(value).toISOString().slice(0, 10);

const prettyDate = value =>
  new Date(value).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

export default class extends HTMLElement {
  unsubCallbacks = [];
  selectedCategoryIds = new Set();
  selectedDate = '';
  sessionStatuses = new Map();
  viewMode = 'tile';

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
          return [session.id, status?.status || null];
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
    this.pruneUnavailableCategorySelections(categories);

    const filteredSessions = this.filterSessionsByCategories(allSessions);
    const grouped = this.groupSessionsByDate(filteredSessions);
    const availableDates = Object.keys(grouped).sort((a, b) => new Date(a) - new Date(b));

    if (!this.selectedDate || !grouped[this.selectedDate]) {
      this.selectedDate = availableDates[0] || '';
    }

    this.root.replaceChildren(
      this.createHeader(),
      this.createToolbar(categories),
      this.createDateTabs(availableDates),
      this.createTilesContainer(grouped[this.selectedDate] || []),
      this.createRecommendations()
    );
  }

  createHeader() {
    const header = document.createElement('div');
    header.className = 'header';

    const copy = document.createElement('div');
    copy.innerHTML = '<h2>Browse Sessions</h2><p>Select a date tab and refine results by category.</p>';

    const viewButton = document.createElement('button');
    viewButton.className = 'view-toggle-btn';
    viewButton.textContent = this.viewMode === 'tile' ? 'Switch to List View' : 'Switch to Tile View';
    viewButton.onclick = () => {
      this.viewMode = this.viewMode === 'tile' ? 'list' : 'tile';
      this.render();
    };

    header.append(copy, viewButton);
    return header;
  }

  createToolbar(categories) {
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    const categoryWrap = document.createElement('details');
    categoryWrap.className = 'category-filter';

    const summary = document.createElement('summary');
    summary.textContent = this.selectedCategoryIds.size
      ? `Category filter (${this.selectedCategoryIds.size} selected)`
      : 'Category filter';

    const options = document.createElement('div');
    options.className = 'category-options';

    categories.forEach(cat => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = this.selectedCategoryIds.has(cat.id);
      checkbox.onchange = () => {
        if (checkbox.checked) {
          this.selectedCategoryIds.add(cat.id);
        } else {
          this.selectedCategoryIds.delete(cat.id);
        }
        this.render();
      };
      label.append(checkbox, document.createTextNode(` ${cat.name}`));
      options.appendChild(label);
    });

    categoryWrap.append(summary, options);
    toolbar.append(categoryWrap);
    return toolbar;
  }

  createDateTabs(dates) {
    const tabs = document.createElement('div');
    tabs.className = 'tabs';

    dates.forEach(date => {
      const btn = document.createElement('button');
      btn.className = `tab ${date === this.selectedDate ? 'active' : ''}`;
      btn.textContent = prettyDate(date);
      btn.onclick = () => {
        this.selectedDate = date;
        this.render();
      };
      tabs.appendChild(btn);
    });

    return tabs;
  }

  createTilesContainer(sessionsForDate) {
    const container = document.createElement('div');
    container.className = this.viewMode === 'tile' ? 'tiles-grid tile-mode' : 'tiles-grid list-mode';

    sessionsForDate.forEach(session => {
      const tile = new SessionTile(
        session,
        this.theme,
        async sessionId => {
          if (this.cventSdk.pickSession) {
            await this.cventSdk.pickSession(sessionId);
            await this.fetchAndRender();
          }
        },
        this.sessionStatuses.get(session.id)
      );
      container.appendChild(tile);
    });

    if (!sessionsForDate.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No sessions match the selected filters.';
      container.appendChild(empty);
    }

    return container;
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

  groupSessionsByDate(sessions) {
    return sessions.reduce((acc, session) => {
      const key = dateKey(session.startDateTime);
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(session);
      return acc;
    }, {});
  }

  filterSessionsByCategories(sessions) {
    if (!this.selectedCategoryIds.size) {
      return sessions;
    }

    return sessions.filter(session => session.category?.id && this.selectedCategoryIds.has(session.category.id));
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

  pruneUnavailableCategorySelections(categories) {
    const categoryIds = new Set(categories.map(category => category.id));
    this.selectedCategoryIds.forEach(categoryId => {
      if (!categoryIds.has(categoryId)) {
        this.selectedCategoryIds.delete(categoryId);
      }
    });
  }

  createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .widget-root { font-family: Arial, sans-serif; }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
      }
      .header h2 { margin: 0; }
      .header p { margin: 8px 0 12px; color: #4b5563; }
      .view-toggle-btn {
        border: 1px solid #2563eb;
        background: #eff6ff;
        color: #1d4ed8;
        border-radius: 8px;
        padding: 10px 14px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .toolbar { margin-bottom: 12px; }
      .category-filter {
        width: min(100%, 460px);
        border: 1px solid #d1d5db;
        border-radius: 10px;
        padding: 6px 10px;
        background: #f9fafb;
      }
      .category-filter summary {
        cursor: pointer;
        font-size: 1rem;
        font-weight: 700;
        color: #111827;
      }
      .category-options {
        margin-top: 12px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 10px;
        padding: 10px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #fff;
      }
      .category-options label {
        font-size: 0.95rem;
      }
      .category-options input {
        transform: scale(1.1);
      }
      .tabs {
        display: flex;
        overflow-x: auto;
        gap: 8px;
        padding-bottom: 8px;
        margin-bottom: 12px;
      }
      .tab {
        border: 1px solid #d1d5db;
        border-radius: 999px;
        padding: 8px 12px;
        background: white;
        white-space: nowrap;
      }
      .tab.active { background: #1d4ed8; color: white; border-color: #1d4ed8; }
      .tiles-grid {
        display: grid;
        gap: 12px;
      }
      .tiles-grid.tile-mode {
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      }
      .tiles-grid.list-mode {
        grid-template-columns: 1fr;
      }
      .empty { color: #6b7280; }
      .recommendations {
        margin-top: 16px;
        border-top: 1px solid #e5e7eb;
        padding-top: 12px;
        color: #374151;
      }
      @media (max-width: 640px) {
        .header {
          flex-direction: column;
          align-items: stretch;
        }
        .view-toggle-btn {
          align-self: flex-start;
        }
        .tiles-grid.tile-mode { grid-template-columns: 1fr; }
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
