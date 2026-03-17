import { FeaturedSession } from './FeaturedSession.js';

const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_SELECTIONS = 3;
const DEFAULT_VISIBLE_TILE_BATCH = 60;

class SessionTabsWidget extends HTMLElement {
  constructor(cventSdk, theme, configuration) {
    super();
    this.cventSdk = cventSdk;
    this.theme = theme;
    this.configuration = configuration || {};

    this.sessions = [];
    this.filteredSessions = [];
    this.selectedSessionIds = new Set();
    this.selectedCategories = new Set();
    this.activeDateKey = null;
    this.searchQuery = '';
    this.visibleTileCount = DEFAULT_VISIBLE_TILE_BATCH;

    this.attachShadow({ mode: 'open' });
  }

  async connectedCallback() {
    this.renderScaffold();
    await this.loadSessions();
    this.applyFilters();
  }

  get maxSelections() {
    return Number(this.configuration?.maxSelections) || DEFAULT_MAX_SELECTIONS;
  }

  async loadSessions() {
    const sessionGenerator = await this.cventSdk.getSessionGenerator(
      'nameAsc',
      Number(this.configuration?.pageSize) || DEFAULT_PAGE_SIZE,
      { byRegistrationTypeAndAdmissionItem: true }
    );

    if (sessionGenerator?.[Symbol.asyncIterator]) {
      for await (const session of sessionGenerator) {
        this.sessions.push(session);
      }
      return;
    }

    if (typeof sessionGenerator?.next === 'function') {
      let result = await sessionGenerator.next();
      while (!result.done) {
        if (Array.isArray(result.value)) {
          this.sessions.push(...result.value);
        } else if (result.value) {
          this.sessions.push(result.value);
        }
        result = await sessionGenerator.next();
      }
      return;
    }

    if (typeof sessionGenerator?.getNext === 'function') {
      let nextBatch = await sessionGenerator.getNext();
      while (nextBatch?.length) {
        this.sessions.push(...nextBatch);
        nextBatch = await sessionGenerator.getNext();
      }
    }
  }

  renderScaffold() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          color: #111827;
          font-family: Arial, sans-serif;
        }

        .container {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .filters {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 12px;
          align-items: end;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field label {
          font-size: 0.875rem;
          font-weight: 600;
        }

        .search-input,
        .category-button {
          border: 1px solid #d1d5db;
          border-radius: 10px;
          min-height: 42px;
          padding: 10px 12px;
          box-sizing: border-box;
          background: #fff;
          width: 100%;
          font-size: 0.95rem;
        }

        .category-filter {
          position: relative;
        }

        .category-button {
          text-align: left;
          cursor: pointer;
        }

        .category-menu {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          width: 100%;
          max-height: 280px;
          overflow: auto;
          background: #fff;
          border: 1px solid #d1d5db;
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
          padding: 8px;
          z-index: 20;
          display: none;
        }

        .category-filter.open .category-menu {
          display: block;
        }

        .category-option {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          border-radius: 8px;
          cursor: pointer;
        }

        .category-option:hover {
          background: #f3f4f6;
        }

        .tabs {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 4px;
        }

        .tab {
          border: 1px solid #d1d5db;
          background: #fff;
          border-radius: 999px;
          padding: 10px 14px;
          cursor: pointer;
          white-space: nowrap;
          font-weight: 600;
        }

        .tab.active {
          background: ${this.configuration?.customColors?.background || this.theme?.palette?.secondary || '#eef4ff'};
          border-color: ${this.theme?.palette?.primary || '#016AE1'};
        }

        .status-row {
          font-size: 0.875rem;
          color: #374151;
          display: flex;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 8px;
        }

        .tiles {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 12px;
        }

        .empty {
          padding: 20px;
          border: 1px dashed #d1d5db;
          border-radius: 10px;
          color: #6b7280;
        }

        .load-more {
          border: 1px solid #d1d5db;
          border-radius: 10px;
          background: #fff;
          min-height: 42px;
          cursor: pointer;
          font-weight: 600;
        }

        @media (max-width: 640px) {
          .tiles {
            grid-template-columns: 1fr;
          }
        }
      </style>
      <div class="container">
        <div class="filters">
          <div class="field">
            <label>Search sessions</label>
            <input class="search-input" type="search" placeholder="Search by title, location, speaker" />
          </div>
          <div class="field category-filter">
            <label>Filter categories</label>
            <button class="category-button" type="button">All categories</button>
            <div class="category-menu"></div>
          </div>
        </div>
        <div class="tabs"></div>
        <div class="status-row">
          <span class="results-summary">Loading sessions...</span>
          <span class="selection-summary">Selected 0/${this.maxSelections}</span>
        </div>
        <div class="tiles"></div>
        <button class="load-more" type="button" hidden>Load more sessions</button>
      </div>
    `;

    this.shadowRoot.querySelector('.search-input').addEventListener('input', event => {
      this.searchQuery = event.target.value.trim().toLowerCase();
      this.visibleTileCount = DEFAULT_VISIBLE_TILE_BATCH;
      this.applyFilters();
    });

    this.shadowRoot.querySelector('.category-button').addEventListener('click', () => {
      this.shadowRoot.querySelector('.category-filter').classList.toggle('open');
    });

    this.shadowRoot.querySelector('.load-more').addEventListener('click', () => {
      this.visibleTileCount += DEFAULT_VISIBLE_TILE_BATCH;
      this.renderTiles();
    });

    this.shadowRoot.addEventListener('click', event => {
      if (!event.composedPath().some(node => node?.classList?.contains?.('category-filter'))) {
        this.shadowRoot.querySelector('.category-filter').classList.remove('open');
      }
    });
  }

  applyFilters() {
    this.filteredSessions = this.sessions.filter(session => {
      const categoryName = session.category?.name || 'Uncategorized';
      const matchesCategory = !this.selectedCategories.size || this.selectedCategories.has(categoryName);
      const haystack = [session.name, session.location?.name || '', categoryName, ...(session.speakers || []).map(s => s.name)]
        .join(' ')
        .toLowerCase();
      const matchesSearch = !this.searchQuery || haystack.includes(this.searchQuery);
      return matchesCategory && matchesSearch;
    });

    const grouped = this.groupByDate(this.filteredSessions);
    const firstDateKey = Object.keys(grouped)[0] || null;
    if (!this.activeDateKey || !grouped[this.activeDateKey]) {
      this.activeDateKey = firstDateKey;
    }

    this.renderCategoryMenu();
    this.renderTabs(grouped);
    this.renderTiles();
    this.updateSummary();
  }

  groupByDate(sessionList) {
    return sessionList.reduce((acc, session) => {
      const dateKey = this.getDateKey(session.startDateTime);
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(session);
      return acc;
    }, {});
  }

  getDateKey(dateValue) {
    const date = new Date(dateValue);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  renderCategoryMenu() {
    const menu = this.shadowRoot.querySelector('.category-menu');
    const categories = [...new Set(this.sessions.map(session => session.category?.name || 'Uncategorized'))].sort();

    menu.innerHTML = '';
    categories.forEach(category => {
      const option = document.createElement('label');
      option.className = 'category-option';
      option.innerHTML = `<input type="checkbox" ${this.selectedCategories.has(category) ? 'checked' : ''} /> <span>${category}</span>`;
      option.querySelector('input').addEventListener('change', event => {
        if (event.target.checked) {
          this.selectedCategories.add(category);
        } else {
          this.selectedCategories.delete(category);
        }
        this.visibleTileCount = DEFAULT_VISIBLE_TILE_BATCH;
        this.applyFilters();
      });
      menu.append(option);
    });

    const label = this.shadowRoot.querySelector('.category-button');
    label.textContent = this.selectedCategories.size ? `${this.selectedCategories.size} categories selected` : 'All categories';
  }

  renderTabs(groupedSessions) {
    const tabs = this.shadowRoot.querySelector('.tabs');
    tabs.innerHTML = '';

    Object.entries(groupedSessions).forEach(([dateKey, sessions]) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `tab ${this.activeDateKey === dateKey ? 'active' : ''}`;
      tab.textContent = `${dateKey} (${sessions.length})`;
      tab.addEventListener('click', () => {
        this.activeDateKey = dateKey;
        this.visibleTileCount = DEFAULT_VISIBLE_TILE_BATCH;
        this.renderTabs(groupedSessions);
        this.renderTiles();
      });
      tabs.append(tab);
    });
  }

  renderTiles() {
    const tileContainer = this.shadowRoot.querySelector('.tiles');
    const grouped = this.groupByDate(this.filteredSessions);
    const activeSessions = grouped[this.activeDateKey] || [];
    const visibleSessions = activeSessions.slice(0, this.visibleTileCount);

    tileContainer.innerHTML = '';

    if (!visibleSessions.length) {
      tileContainer.innerHTML = '<div class="empty">No sessions found for this filter combination.</div>';
    } else {
      visibleSessions.forEach(session => {
        const tile = new FeaturedSession(session, this.theme, {
          isSelected: this.selectedSessionIds.has(session.id),
          onToggle: () => this.toggleSelection(session.id)
        });
        tileContainer.append(tile);
      });
    }

    const loadMore = this.shadowRoot.querySelector('.load-more');
    loadMore.hidden = activeSessions.length <= visibleSessions.length;
    loadMore.textContent = `Load more sessions (${activeSessions.length - visibleSessions.length} remaining)`;

    this.updateSummary();
  }

  toggleSelection(sessionId) {
    if (this.selectedSessionIds.has(sessionId)) {
      this.selectedSessionIds.delete(sessionId);
      this.renderTiles();
      return;
    }

    if (this.selectedSessionIds.size >= this.maxSelections) {
      return;
    }

    this.selectedSessionIds.add(sessionId);
    this.renderTiles();
  }

  updateSummary() {
    const grouped = this.groupByDate(this.filteredSessions);
    const activeCount = (grouped[this.activeDateKey] || []).length;
    const totalCount = this.filteredSessions.length;

    this.shadowRoot.querySelector('.results-summary').textContent =
      `${totalCount} sessions found • ${activeCount} in current date tab`;
    this.shadowRoot.querySelector('.selection-summary').textContent =
      `Selected ${this.selectedSessionIds.size}/${this.maxSelections}`;
  }
}

export default SessionTabsWidget;
