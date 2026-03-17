class SessionTabsEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

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

    const pageSizeLabel = document.createElement('label');
    pageSizeLabel.textContent = 'Page size (session SDK fetch chunk): ';
    pageSizeLabel.appendChild(this.pageSizeInput);

    const uxLabel = document.createElement('label');
    uxLabel.textContent = ' Show UX recommendations panel';
    uxLabel.prepend(this.uxToggle);

    this.pageSizeInput.onchange = () => this.pushConfig();
    this.uxToggle.onchange = () => this.pushConfig();

    this.container.append(heading, pageSizeLabel, document.createElement('br'), document.createElement('br'), uxLabel);
    this.shadowRoot.append(this.container);
  }

  onConfigurationUpdate(newConfig) {
    this._config = newConfig || {};
    this.pageSizeInput.value = this._config.pageSize ?? 50;
    this.uxToggle.checked = this._config.showUxRecommendations ?? true;
  }

  pushConfig() {
    this.setConfiguration({
      ...this._config,
      pageSize: Number(this.pageSizeInput.value) || 50,
      showUxRecommendations: !!this.uxToggle.checked
    });
  }
}

export default SessionTabsEditor;
