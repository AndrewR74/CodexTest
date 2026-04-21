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

const getTimeRangeLabel = session => {
  const start = new Date(session.startDateTime);
  const end = new Date(session.endDateTime);
  const day = start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const startTime = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const endTime = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return `${day} · ${startTime} - ${endTime}`;
};

export class SessionTile extends HTMLElement {
  constructor(session, theme, onRegisterClick, selectionStatus) {
    super();
    this.session = session;
    this.theme = theme || defaultTheme;
    this.onRegisterClick = onRegisterClick;
    this.selectionStatus = selectionStatus;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    const s = this.session;
    const isStatusPending = this.selectionStatus === undefined;
    const card = document.createElement('article');
    card.className = 'tile';

    const content = document.createElement('div');
    content.className = 'content';

    const name = document.createElement('h3');
    name.className = 'title';
    name.textContent = isStatusPending ? '• • •' : s.name;
    if (isStatusPending) {
      name.setAttribute('aria-label', 'Loading session');
    }
    setStylesOnElement({ ...defaultTheme.header3, ...this.theme.header3, margin: '0 0 8px' }, name);

    const desc = document.createElement('p');
    desc.className = 'description';
    desc.innerHTML = isStatusPending ? '' : s.description || 'No description available.';
    setStylesOnElement({ ...defaultTheme.paragraph, ...this.theme.paragraph, margin: '0 0 8px', fontSize: '0.92rem' }, desc);

    const location = document.createElement('p');
    location.textContent = s.location?.name ? `Location: ${s.location.name}` : 'Location: TBA';
    setStylesOnElement({ ...defaultTheme.altParagraph, ...this.theme.altParagraph, margin: '0 0 10px', fontSize: '0.82rem' }, location);

    const badgeRow = document.createElement('div');
    badgeRow.className = 'badge-row';

    this.statusBadge = document.createElement('span');
    this.statusBadge.hidden = true;
    badgeRow.appendChild(this.statusBadge);

    if (s.category?.name) {
      const typeBadge = document.createElement('span');
      typeBadge.className = 'badge neutral';
      typeBadge.textContent = `Type: ${s.category.name}`;
      badgeRow.appendChild(typeBadge);
    }

    this.priceBadge = document.createElement('span');
    this.priceBadge.className = 'badge price';
    this.priceBadge.textContent = this.getFeeLabel(s);
    badgeRow.appendChild(this.priceBadge);

    content.append(name, desc, location, badgeRow);

    const actionPanel = document.createElement('div');
    actionPanel.className = 'action-panel';

    const datetime = document.createElement('p');
    datetime.className = 'datetime';
    datetime.textContent = getTimeRangeLabel(s);

    this.actionButton = document.createElement('button');
    this.actionButton.className = 'register-btn';
    this.updateActionButton(this.actionButton, this.getActionButtonState());
    this.actionButton.onclick = async () => {
      this.actionButton.disabled = true;
      this.actionButton.textContent = 'Processing...';

      const result = await this.onRegisterClick?.(s.id);
      if (!result?.success) {
        this.updateActionButton(this.actionButton, this.getActionButtonState());
        return;
      }

      this.updateSelectionStatus(result.status || this.selectionStatus);
    };

    actionPanel.append(datetime, this.actionButton);
    card.append(content, actionPanel);

    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        content-visibility: auto;
        contain-intrinsic-size: 176px;
      }
      .tile {
        border: 1px solid #e8e8ec;
        border-radius: 16px;
        padding: 12px;
        background: #fff;
        box-shadow: 0 8px 22px rgba(31, 41, 55, 0.07);
        display: grid;
        grid-template-columns: 1fr 180px;
        gap: 14px;
        align-items: center;
      }
      .badge-row {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .badge {
        border-radius: 999px;
        padding: 4px 9px;
        font-size: 12px;
        line-height: 1.2;
      }
      .badge.included {
        background: #dcfce7;
        color: #166534;
      }
      .badge.waitlist {
        background: #fef3c7;
        color: #92400e;
      }
      .badge.neutral {
        background: #f3f4f6;
        color: #374151;
      }
      .badge.price {
        background: #fee2e2;
        color: #991b1b;
      }
      .action-panel {
        text-align: right;
      }
      .datetime {
        margin: 0 0 10px;
        font-size: 0.85rem;
        color: #4b5563;
      }
      .register-btn {
        width: 100%;
        border: none;
        border-radius: 999px;
        padding: 10px 12px;
        background: #8b1d2c;
        color: #fff;
        font-weight: 700;
        cursor: pointer;
      }
      .register-btn.tone-register,
      .register-btn.tone-registered,
      .register-btn.tone-waitlist,
      .register-btn.tone-remove {
        background: #8b1d2c;
      }
      .register-btn.tone-included,
      .register-btn.tone-loading,
      .register-btn.tone-unavailable {
        background: #9ca3af;
      }
      .register-btn:disabled {
        opacity: 0.9;
        cursor: not-allowed;
      }
      .title {
        min-height: 1.2em;
      }
      .title[aria-label="Loading session"] {
        letter-spacing: 0.35rem;
        color: #9ca3af;
        animation: pulse 1.2s ease-in-out infinite;
      }
      .description:empty {
        min-height: 1.1em;
      }
      @keyframes pulse {
        0%,
        100% {
          opacity: 0.45;
        }
        50% {
          opacity: 1;
        }
      }
      @media (max-width: 760px) {
        .tile {
          grid-template-columns: 1fr;
        }
        .action-panel {
          text-align: left;
        }
      }
    `;

    this.shadowRoot.append(style, card);
    this.refreshStatusPresentation();
  }

  getStatusCode() {
    if (typeof this.selectionStatus === 'string') {
      return this.selectionStatus;
    }
    return this.selectionStatus?.status || null;
  }

  updateActionButton(button, actionState) {
    button.textContent = actionState.text;
    button.disabled = actionState.disabled;
    button.className = `register-btn tone-${actionState.tone}`;
  }

  updateSelectionStatus(selectionStatus) {
    this.selectionStatus = selectionStatus;
    this.refreshStatusPresentation();
  }

  refreshStatusPresentation() {
    if (this.actionButton) {
      this.updateActionButton(this.actionButton, this.getActionButtonState());
    }

    if (!this.statusBadge || !this.priceBadge) {
      return;
    }

    const statusCode = this.getStatusCode();
    this.statusBadge.hidden = true;

    if (statusCode === 'WAITLISTED' || statusCode === 'WAITLIST_AVAILABLE') {
      this.statusBadge.hidden = false;
      this.statusBadge.className = 'badge waitlist';
      this.statusBadge.textContent = 'Waitlist';
    } else if (statusCode === 'INCLUDED' || statusCode === 'BUNDLED') {
      this.statusBadge.hidden = false;
      this.statusBadge.className = 'badge included';
      this.statusBadge.textContent = 'Included';
    }

    this.priceBadge.textContent = this.getFeeLabel(this.session);
  }

  getActionButtonState() {
    if (this.selectionStatus === undefined) {
      return { text: 'Loading status...', disabled: true, tone: 'loading' };
    }

    const status = this.getStatusCode();

    if (status === 'SELECTED') {
      return { text: 'Remove', disabled: false, tone: 'remove' };
    }

    if (status === 'WAITLISTED') {
      return { text: 'Leave Waitlist', disabled: false, tone: 'waitlist' };
    }

    if (status === 'WAITLIST_AVAILABLE') {
      return { text: 'Join Waitlist', disabled: false, tone: 'waitlist' };
    }

    if (status === 'OPEN' || status === 'OPEN_FROM_WAITLIST') {
      return { text: 'Add to schedule', disabled: false, tone: 'register' };
    }

    if (status === 'INCLUDED' || status === 'BUNDLED') {
      return { text: 'Included', disabled: true, tone: 'included' };
    }

    return { text: 'Unavailable', disabled: true, tone: 'unavailable' };
  }

  getFeeLabel(session) {
    const status = this.getStatusCode();
    if (status === 'INCLUDED' || status === 'BUNDLED') {
      return 'Included';
    }

    const amount =
      session.feeAmount ??
      session.price ??
      session.fee?.amount ??
      session.fee?.chargePolicies?.find(policy => policy.isActive)?.amount;

    if (amount === undefined || amount === null || Number(amount) === 0) {
      return 'Free';
    }

    return `$${Number(amount).toFixed(2)} add-on`;
  }
}
