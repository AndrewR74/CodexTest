class SessionTabsEditor extends HTMLElement {
  constructor({ initialConfiguration = {}, setConfiguration } = {}) {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = initialConfiguration;
    this.setConfig = setConfiguration;
    this.availableSessions = [];
    this.availableCategories = [];

    this.container = document.createElement('div');
    this.container.style.fontFamily = 'Arial, sans-serif';

    const heading = document.createElement('h2');
    heading.textContent = 'Session Date Tabs Widget Settings';

    this.widgetTitleInput = document.createElement('input');
    this.widgetTitleInput.type = 'text';
    this.widgetTitleInput.placeholder = 'Build Your Weekend Schedule';

    this.pageSizeInput = document.createElement('input');
    this.pageSizeInput.type = 'number';
    this.pageSizeInput.min = '20';
    this.pageSizeInput.step = '10';

    this.startDateInput = document.createElement('input');
    this.startDateInput.type = 'date';

    this.endDateInput = document.createElement('input');
    this.endDateInput.type = 'date';

    this.categoryFilterInput = document.createElement('input');
    this.categoryFilterInput.type = 'search';
    this.categoryFilterInput.placeholder = 'Filter categories';

    this.categoryList = document.createElement('div');

    this.preventOverlapInput = document.createElement('input');
    this.preventOverlapInput.type = 'checkbox';

    this.excludedSessionFilterInput = document.createElement('input');
    this.excludedSessionFilterInput.type = 'search';
    this.excludedSessionFilterInput.placeholder = 'Filter sessions by name';

    this.excludedSessionsList = document.createElement('div');

    const widgetTitleLabel = document.createElement('label');
    widgetTitleLabel.textContent = 'Widget title: ';
    widgetTitleLabel.appendChild(this.widgetTitleInput);

    const pageSizeLabel = document.createElement('label');
    pageSizeLabel.textContent = 'Page size (session SDK fetch chunk): ';
    pageSizeLabel.appendChild(this.pageSizeInput);

    const startDateLabel = document.createElement('label');
    startDateLabel.textContent = 'Start date (inclusive): ';
    startDateLabel.appendChild(this.startDateInput);

    const endDateLabel = document.createElement('label');
    endDateLabel.textContent = 'End date (inclusive): ';
    endDateLabel.appendChild(this.endDateInput);

    const categoryLabel = document.createElement('label');
    categoryLabel.textContent = 'Limit to categories:';

    const overlapLabel = document.createElement('label');
    overlapLabel.append(this.preventOverlapInput, document.createTextNode(' Prevent overlapping session registration'));

    const excludedSessionsLabel = document.createElement('label');
    excludedSessionsLabel.textContent = 'Sessions excluded from overlap check:';

    [
      this.widgetTitleInput,
      this.pageSizeInput,
      this.startDateInput,
      this.endDateInput,
      this.categoryFilterInput,
      this.preventOverlapInput,
      this.excludedSessionFilterInput
    ].forEach(input => {
      input.onchange = () => this.pushConfig();
    });

    this.widgetTitleInput.oninput = () => this.pushConfig();
    this.categoryFilterInput.oninput = () => this.renderCategoryOptions();
    this.excludedSessionFilterInput.oninput = () => this.renderExcludedSessionOptions();

    this.container.append(
      heading,
      widgetTitleLabel,
      document.createElement('br'),
      document.createElement('br'),
      pageSizeLabel,
      document.createElement('br'),
      document.createElement('br'),
      startDateLabel,
      document.createElement('br'),
      document.createElement('br'),
      endDateLabel,
      document.createElement('hr'),
      categoryLabel,
      document.createElement('br'),
      this.categoryFilterInput,
      this.categoryList,
      document.createElement('hr'),
      overlapLabel,
      document.createElement('br'),
      document.createElement('br'),
      excludedSessionsLabel,
      document.createElement('br'),
      this.excludedSessionFilterInput,
      this.excludedSessionsList
    );
    this.shadowRoot.append(this.container);

    this.onConfigurationUpdate(this._config);
    this.hydrateOptionData();
  }

  async hydrateOptionData() {
    if (!this.cventSdk?.getSessionGenerator) {
      return;
    }

    try {
      const generator = await this.cventSdk.getSessionGenerator('nameAsc', this._config.pageSize ?? 100, {
        byRegistrationTypeAndAdmissionItem: true
      });

      const sessions = [];
      for await (const page of generator) {
        sessions.push(...(page.sessions || []));
      }

      this.availableSessions = sessions
        .filter(session => session?.id)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      const categoryMap = new Map();
      this.availableSessions.forEach(session => {
        if (session.category?.id && session.category?.name) {
          categoryMap.set(session.category.id, session.category);
        }
      });
      this.availableCategories = [...categoryMap.values()].sort((a, b) => a.name.localeCompare(b.name));
      this.renderCategoryOptions();
      this.renderExcludedSessionOptions();
    } catch (error) {
      this.availableSessions = [];
      this.availableCategories = [];
    }
  }

  onConfigurationUpdate(newConfig) {
    this._config = newConfig || {};
    this.pageSizeInput.value = this._config.pageSize ?? 50;
    this.widgetTitleInput.value = this._config.widgetTitle ?? '';
    this.startDateInput.value = this._config.startDate ?? '';
    this.endDateInput.value = this._config.endDate ?? '';
    this.preventOverlapInput.checked = Boolean(this._config.preventOverlapRegistration);
    this.renderCategoryOptions();
    this.renderExcludedSessionOptions();
  }

  renderCategoryOptions() {
    const selectedCategoryIds = new Set(this._config.allowedCategoryIds || []);
    const filterTerm = this.categoryFilterInput.value.trim().toLowerCase();

    this.categoryList.replaceChildren();
    const visibleCategories = (this.availableCategories || []).filter(category => {
      if (!filterTerm) {
        return true;
      }
      return category.name.toLowerCase().includes(filterTerm);
    });

    if (!visibleCategories.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No categories found.';
      this.categoryList.appendChild(empty);
      return;
    }

    visibleCategories.forEach(category => {
      const row = document.createElement('label');
      row.style.display = 'block';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedCategoryIds.has(category.id);
      checkbox.onchange = () => {
        if (checkbox.checked) {
          selectedCategoryIds.add(category.id);
        } else {
          selectedCategoryIds.delete(category.id);
        }
        this._config.allowedCategoryIds = [...selectedCategoryIds];
        this.pushConfig();
      };
      row.append(checkbox, document.createTextNode(` ${category.name}`));
      this.categoryList.appendChild(row);
    });
  }

  renderExcludedSessionOptions() {
    const selectedSessionIds = new Set(this._config.overlapExcludedSessionIds || []);
    const filterTerm = this.excludedSessionFilterInput.value.trim().toLowerCase();
    this.excludedSessionsList.style.display = this.preventOverlapInput.checked ? 'block' : 'none';
    this.excludedSessionFilterInput.style.display = this.preventOverlapInput.checked ? 'inline-block' : 'none';

    this.excludedSessionsList.replaceChildren();

    if (!this.preventOverlapInput.checked) {
      return;
    }

    const visibleSessions = (this.availableSessions || []).filter(session => {
      if (!filterTerm) {
        return true;
      }
      return (session.name || '').toLowerCase().includes(filterTerm);
    });

    if (!visibleSessions.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No sessions found.';
      this.excludedSessionsList.appendChild(empty);
      return;
    }

    visibleSessions.forEach(session => {
      const row = document.createElement('label');
      row.style.display = 'block';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedSessionIds.has(session.id);
      checkbox.onchange = () => {
        if (checkbox.checked) {
          selectedSessionIds.add(session.id);
        } else {
          selectedSessionIds.delete(session.id);
        }
        this._config.overlapExcludedSessionIds = [...selectedSessionIds];
        this.pushConfig();
      };
      row.append(checkbox, document.createTextNode(` ${session.name}`));
      this.excludedSessionsList.appendChild(row);
    });
  }

  pushConfig() {
    if (!this.setConfig) {
      return;
    }

    this.setConfig({
      ...this._config,
      pageSize: Number(this.pageSizeInput.value) || 50,
      widgetTitle: this.widgetTitleInput.value || '',
      startDate: this.startDateInput.value || '',
      endDate: this.endDateInput.value || '',
      preventOverlapRegistration: this.preventOverlapInput.checked,
      allowedCategoryIds: this._config.allowedCategoryIds || [],
      overlapExcludedSessionIds: this._config.overlapExcludedSessionIds || []
    });
  }
}

export default SessionTabsEditor;
