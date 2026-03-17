class ExampleCustomEditor extends HTMLElement {
  setConfiguration(configuration) {
    this._config = configuration;
    this.dispatchEvent(
      new CustomEvent('configurationChanged', {
        detail: configuration,
        bubbles: true,
        composed: true
      })
    );
  }

  connectedCallback() {
    this._config = this._config || {};
    this.render();
  }

  render() {
    this.innerHTML = '';

    const title = document.createElement('h2');
    title.textContent = 'Session Tile Widget Settings';

    const maxSelection = this.createNumberField('Max selected sessions', 'maxSelections', this._config.maxSelections ?? 3, 1, 10);
    const pageSize = this.createNumberField('Session page size', 'pageSize', this._config.pageSize ?? 200, 20, 500);
    const hint = document.createElement('p');
    hint.textContent = 'Categories are dynamically loaded from available sessions and can be multi-selected in the live widget.';
    hint.style.fontSize = '12px';

    this.append(title, maxSelection, pageSize, hint);
  }

  createNumberField(labelText, key, value, min, max) {
    const wrapper = document.createElement('label');
    wrapper.style.display = 'grid';
    wrapper.style.gap = '6px';
    wrapper.style.marginBottom = '12px';

    const label = document.createElement('span');
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = min;
    input.max = max;
    input.value = value;

    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      const nextValue = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
      this.setConfiguration({
        ...this._config,
        [key]: nextValue
      });
    });

    wrapper.append(label, input);
    return wrapper;
  }
}

export default ExampleCustomEditor;
