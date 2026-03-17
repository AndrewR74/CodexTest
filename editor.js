class ExampleCustomEditor extends HTMLElement {
  constructor({ setConfiguration, initialConfiguration }) {
    super();
    this.setConfiguration = setConfiguration;

    if (!initialConfiguration) {
      setConfiguration({ featuredSessionIds: [], showFees: false });
    } else {
      // initialize the local config state with the initial value
      this._config = initialConfiguration ?? {};
    }

    // header
    const header = document.createElement('h2');
    header.textContent = "Select which sessions you'd like to feature: ";
    header.style.margin = '0';
    header.style.fontFamily = 'Rubik';

    // sub header
    const subHeader = document.createElement('p');
    subHeader.textContent = '(limit 3)';
    subHeader.style.margin = '0';
    subHeader.style.fontFamily = 'Rubik';

    // create some sections to contain the various configuration options that will be created later
    this.themeOverrideContainer = document.createElement('div');
    this.sessionSelectorContainer = document.createElement('div');
    this.feesToggleContainer = document.createElement('div');

    // Create a shadow root
    this.attachShadow({ mode: 'open' });
    // add our elements to shadow dom
    this.shadowRoot.append(
      header,
      subHeader,
      this.sessionSelectorContainer,
      this.feesToggleContainer,
      this.themeOverrideContainer
    );
  }

  onConfigurationUpdate(newConfig) {
    // keep track of the configuration in our class variable
    this._config = newConfig;
    // refresh the UI after a configuration change
    this.createSessionSelectors();
    this.createFeesToggle();
    this.createThemeOverrides();
  }

  createFeesToggle = () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'feesCheckbox';
    checkbox.name = 'feesCheckbox';
    if (this._config?.showFees) {
      checkbox.setAttribute('checked', '');
    }
    const handleCheckboxChange = () => {
      this.setConfiguration({ ...this._config, showFees: !!checkbox.checked });
    };

    checkbox.addEventListener('change', handleCheckboxChange);
    const label = document.createElement('label');
    label.setAttribute('for', 'feesCheckbox');

    label.textContent = 'Show session fees';

    this.feesToggleContainer.replaceChildren(checkbox, label);
  };

  // button that selects/deselects a session
  onClickSession = sessionId => {
    const featuredSessionIds = [...(this._config?.featuredSessionIds ?? [])];

    const sessionIdIndex = featuredSessionIds.findIndex(id => {
      return sessionId === id;
    });

    if (sessionIdIndex === -1) {
      // this sessionId was not already selected, add it and maintain the limit of 3 featured sessions
      featuredSessionIds.push(sessionId);
      if (featuredSessionIds.length > 3) {
        featuredSessionIds.shift();
      }
    } else {
      // this sessionId was found in the selected ids, remove it
      featuredSessionIds.splice(sessionIdIndex, 1);
    }

    // keep all of our other config fields, overwrite `featuredSessionIds`
    this.setConfiguration({ ...this._config, featuredSessionIds });
  };

  // create/refresh the session selection override ui
  createSessionSelectors = () => {
    const allSessions = this.sessionDetails ?? [];
    const featuredSessionIds = this._config?.featuredSessionIds ?? [];

    // create a button for every session
    const newSessionButtons = allSessions.map(session => {
      const button = document.createElement('button');
      button.textContent = session.name;
      button.onclick = () => {
        this.onClickSession(session.id);
      };
      button.style.display = 'block';
      button.style.width = '100%';
      button.style.height = '32px';
      button.style.margin = '20px 20px 20px 0px';
      button.style.fontFamily = 'Rubik';

      if (featuredSessionIds.includes(session.id)) {
        // style the button as already selected
        button.style.border = '2px solid #016AE1';
        button.style.borderRadius = '8px';
      }
      return button;
    });

    this.sessionSelectorContainer.replaceChildren(...newSessionButtons);
  };

  // creates an element that edits the configuration to add a custom color
  // can also remove a custom color from the configuration if the event theme should be used
  createColorPicker(title, colorCode, initialValue) {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'flex-end';
    container.style.marginBottom = '10px';

    const colorName = document.createElement('p');
    colorName.textContent = title;
    colorName.style.margin = '0px 10px 0px 0px';

    const colorPicker = document.createElement('input');
    colorPicker.style.width = '32px';
    colorPicker.style.height = '32px';
    colorPicker.style.padding = '2px';
    colorPicker.setAttribute('type', 'color');
    colorPicker.setAttribute('value', initialValue);

    colorPicker.onchange = () => {
      const newConfig = {
        ...this._config,
        customColors: { ...this._config?.customColors }
      };
      newConfig.customColors[colorCode] = colorPicker.value;
      this.setConfiguration(newConfig);
    };

    // clear the config setting for this color code if we should use the event theme.
    const button = document.createElement('button');
    button.textContent = 'Use Event Theme';
    button.onclick = () => {
      const newConfig = {
        ...this._config,
        customColors: { ...this._config?.customColors }
      };
      newConfig.customColors[colorCode] = undefined;
      this.setConfiguration(newConfig);
    };

    if (!this._config?.customColors || this._config?.customColors[colorCode] === undefined) {
      // style as selected
      button.style.border = '2px solid #016AE1';
      button.style.borderRadius = '8px';
    }

    button.style.margin = '0px 0px 0px 10px';

    container.append(colorName, colorPicker, button);
    return container;
  }

  // create/refresh the theme override ui
  createThemeOverrides() {
    const themeHeader = document.createElement('h2');
    themeHeader.textContent = 'Theme: ';
    themeHeader.style.fontFamily = 'Rubik';

    this.themeOverrideContainer.replaceChildren(
      themeHeader,
      this.createColorPicker('Background Color', 'background', this._config?.customColors?.background ?? '#FFFFFF')
    );
  }

  async connectedCallback() {
    // get information about every session
    // NOTE: this method supports pagination, using it will improve the performance of your site when dealing with a large number of sessions
    const sessionGenerator = await this.getSessionGenerator('nameAsc', 20);
    const sessions = [];
    for await (const page of sessionGenerator) {
      sessions.push(...page.sessions);
    }

    // store this in a class variable so that `createSessionSelectors` can use it
    this.sessionDetails = sessions;

    // create the editor UI
    this.createSessionSelectors();
    this.createFeesToggle();
    this.createThemeOverrides();
  }
}
export default ExampleCustomEditor;
