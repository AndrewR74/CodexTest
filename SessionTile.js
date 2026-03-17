const defaultTheme = {
  header3: { fontFamily: 'Arial, sans-serif', color: '#111827' },
  paragraph: { fontFamily: 'Arial, sans-serif', color: '#374151' },
  altParagraph: { fontFamily: 'Arial, sans-serif', color: '#6b7280' }
};

const setStylesOnElement = (styles, element) => {
  Object.entries(styles).forEach(([key, value]) => {
    element.style[key] = value;
  });
};

export class SessionTile extends HTMLElement {
  constructor(session, theme, onRegisterClick) {
    super();
    this.session = session;
    this.theme = theme || defaultTheme;
    this.onRegisterClick = onRegisterClick;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    const s = this.session;
    const card = document.createElement('article');
    card.className = 'tile';

    const name = document.createElement('h3');
    name.textContent = s.name;
    setStylesOnElement({ ...defaultTheme.header3, ...this.theme.header3, margin: '0 0 8px' }, name);

    const meta = document.createElement('p');
    const start = new Date(s.startDateTime);
    const end = new Date(s.endDateTime);
    meta.textContent = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString(
      [],
      { hour: '2-digit', minute: '2-digit' }
    )}${s.location?.name ? ` • ${s.location.name}` : ''}`;
    setStylesOnElement({ ...defaultTheme.altParagraph, ...this.theme.altParagraph, margin: '0 0 8px', fontSize: '0.85rem' }, meta);

    const desc = document.createElement('p');
    desc.textContent = s.description || 'No description available.';
    setStylesOnElement({ ...defaultTheme.paragraph, ...this.theme.paragraph, margin: '0 0 12px', fontSize: '0.9rem' }, desc);

    const badgeRow = document.createElement('div');
    badgeRow.className = 'badge-row';

    if (s.category?.name) {
      const category = document.createElement('span');
      category.className = 'badge';
      category.textContent = s.category.name;
      badgeRow.appendChild(category);
    }

    if (s.isFeatured) {
      const featured = document.createElement('span');
      featured.className = 'badge featured';
      featured.textContent = 'Featured';
      badgeRow.appendChild(featured);
    }

    const actionButton = document.createElement('button');
    actionButton.className = 'register-btn';
    actionButton.textContent = s.isOpenForRegistration ? 'Register' : s.isWaitlistEnabled ? 'Join Waitlist' : 'Unavailable';
    actionButton.disabled = !s.isOpenForRegistration && !s.isWaitlistEnabled;
    actionButton.onclick = () => this.onRegisterClick?.(s.id);

    const style = document.createElement('style');
    style.textContent = `
      .tile {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 12px;
        background: #fff;
        display: flex;
        flex-direction: column;
        min-height: 220px;
      }
      .badge-row {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .badge {
        background: #eff6ff;
        color: #1d4ed8;
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 12px;
      }
      .badge.featured {
        background: #fffbeb;
        color: #92400e;
      }
      .register-btn {
        margin-top: auto;
        width: 100%;
        border: none;
        border-radius: 8px;
        padding: 10px;
        background: #2563eb;
        color: #fff;
        font-weight: 600;
        cursor: pointer;
      }
      .register-btn:disabled {
        background: #9ca3af;
        cursor: not-allowed;
      }
    `;

    card.append(name, meta, desc, badgeRow, actionButton);
    this.shadowRoot.append(style, card);
  }
}
