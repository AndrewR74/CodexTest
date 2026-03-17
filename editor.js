class ExampleCustomEditor extends HTMLElement {

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
        colorPicker.type = 'color';
        colorPicker.value = initialValue;

        colorPicker.onchange = () => {
            const newConfig = {
                ...this._config,
                customColors: { ...this._config?.customColors }
            };
            newConfig.customColors[colorCode] = colorPicker.value;
            this.setConfiguration(newConfig);
        };

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
            button.style.border = '2px solid #016AE1';
            button.style.borderRadius = '8px';
        }

        button.style.margin = '0px 0px 0px 10px';
        container.append(colorName, colorPicker, button);
        return container;
    }

    createThemeOverrides() {
        const themeHeader = document.createElement('h2');
        themeHeader.textContent = 'Theme';
        themeHeader.style.fontFamily = 'Rubik';

        this.themeOverrideContainer.replaceChildren(
            themeHeader,
            this.createColorPicker('Background Color', 'background', this._config?.customColors?.background ?? '#FFFFFF')
        );
    }

    connectedCallback() {
        this.createFeesToggle();
        this.createThemeOverrides();
    }
}

export default ExampleCustomEditor;