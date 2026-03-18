class SessionTabsEditor extends HTMLElement {
  constructor({ initialConfiguration = {}, setConfiguration } = {}) {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = initialConfiguration;
    this.setConfig = setConfiguration;

    this.container = document.createElement('div');
    this.container.style.fontFamily = 'Arial, sans-serif';

    const heading = document.createElement('h2');
    heading.textContent = 'Session Date Tabs Widget Settings';

    this.pageSizeInput = document.createElement('input');
    this.pageSizeInput.type = 'number';
    this.pageSizeInput.min = '20';
    this.pageSizeInput.step = '10';

    this.uxToggle = document.createElement('input');
    this.uxToggle.type = 'checkbox';

    this.startDateInput = document.createElement('input');
    this.startDateInput.type = 'date';

    this.endDateInput = document.createElement('input');
    this.endDateInput.type = 'date';

    const pageSizeLabel = document.createElement('label');
    pageSizeLabel.textContent = 'Page size (session SDK fetch chunk): ';
    pageSizeLabel.appendChild(this.pageSizeInput);

    const uxLabel = document.createElement('label');
    uxLabel.textContent = ' Show UX recommendations panel';
    uxLabel.prepend(this.uxToggle);

    const startDateLabel = document.createElement('label');
    startDateLabel.textContent = 'Start date (inclusive): ';
    startDateLabel.appendChild(this.startDateInput);

    const endDateLabel = document.createElement('label');
    endDateLabel.textContent = 'End date (inclusive): ';
    endDateLabel.appendChild(this.endDateInput);

    this.pageSizeInput.onchange = () => this.pushConfig();
    this.uxToggle.onchange = () => this.pushConfig();
    this.startDateInput.onchange = () => this.pushConfig();
    this.endDateInput.onchange = () => this.pushConfig();

    this.container.append(
      heading,
      pageSizeLabel,
      document.createElement('br'),
      document.createElement('br'),
      startDateLabel,
      document.createElement('br'),
      document.createElement('br'),
      endDateLabel,
      document.createElement('br'),
      document.createElement('br'),
      uxLabel
    );
    this.shadowRoot.append(this.container);
  }

  onConfigurationUpdate(newConfig) {
    this._config = newConfig || {};
    this.pageSizeInput.value = this._config.pageSize ?? 50;
    this.uxToggle.checked = this._config.showUxRecommendations ?? true;
    this.startDateInput.value = this._config.startDate ?? '';
    this.endDateInput.value = this._config.endDate ?? '';
  }

  pushConfig() {
    if (!this.setConfig) {
      return;
    }

    this.setConfig({
      ...this._config,
      pageSize: Number(this.pageSizeInput.value) || 50,
      showUxRecommendations: !!this.uxToggle.checked,
      startDate: this.startDateInput.value || '',
      endDate: this.endDateInput.value || ''
    });
  }
}

export default SessionTabsEditor;
