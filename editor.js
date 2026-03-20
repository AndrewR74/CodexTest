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

    this.startDateInput = document.createElement('input');
    this.startDateInput.type = 'date';

    this.endDateInput = document.createElement('input');
    this.endDateInput.type = 'date';

    const pageSizeLabel = document.createElement('label');
    pageSizeLabel.textContent = 'Page size (session SDK fetch chunk): ';
    pageSizeLabel.appendChild(this.pageSizeInput);

    const startDateLabel = document.createElement('label');
    startDateLabel.textContent = 'Start date (inclusive): ';
    startDateLabel.appendChild(this.startDateInput);

    const endDateLabel = document.createElement('label');
    endDateLabel.textContent = 'End date (inclusive): ';
    endDateLabel.appendChild(this.endDateInput);

    this.pageSizeInput.onchange = () => this.pushConfig();
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
      endDateLabel
    );
    this.shadowRoot.append(this.container);

    this.onConfigurationUpdate(this._config);
  }

  onConfigurationUpdate(newConfig) {
    this._config = newConfig || {};
    this.pageSizeInput.value = this._config.pageSize ?? 50;
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
      startDate: this.startDateInput.value || '',
      endDate: this.endDateInput.value || ''
    });
  }
}

export default SessionTabsEditor;
