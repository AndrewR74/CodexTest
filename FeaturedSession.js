export class FeaturedSession extends HTMLElement {
  constructor(session, theme, interactions) {
    super();
    this.session = session;
    this.theme = theme || {};
    this.interactions = interactions || {};
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    if (!this.session) {
      return;
    }

    const category = this.session.category?.name || 'Uncategorized';
    const location = this.session.location?.name || 'Location TBD';
    const selectedClass = this.interactions.isSelected ? 'selected' : '';
    const buttonLabel = this.interactions.isSelected ? 'Remove' : 'Add';

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .tile {
          border: 1px solid #d1d5db;
          border-radius: 12px;
          background: ${this.theme?.palette?.background || '#ffffff'};
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          height: 100%;
          box-sizing: border-box;
        }

        .tile.selected {
          border-color: ${this.theme?.palette?.primary || '#016AE1'};
          box-shadow: 0 0 0 1px ${this.theme?.palette?.primary || '#016AE1'};
        }

        .meta {
          font-size: 0.8rem;
          color: #6b7280;
        }

        .title {
          margin: 0;
          font-size: 1rem;
          line-height: 1.3;
        }

        .description {
          margin: 0;
          color: #374151;
          font-size: 0.9rem;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .tag {
          font-size: 0.75rem;
          background: #f3f4f6;
          border-radius: 999px;
          padding: 4px 8px;
        }

        .action {
          margin-top: auto;
          min-height: 40px;
          border: 0;
          border-radius: 10px;
          cursor: pointer;
          font-weight: 600;
          background: ${this.theme?.palette?.primary || '#016AE1'};
          color: #fff;
        }
      </style>
      <article class="tile ${selectedClass}">
        <p class="meta">${this.formatTime(this.session.startDateTime)} - ${this.formatTime(this.session.endDateTime)}</p>
        <h3 class="title">${this.session.name}</h3>
        <div class="tags">
          <span class="tag">${category}</span>
          <span class="tag">${location}</span>
        </div>
        <p class="description">${this.session.description || ''}</p>
        <button type="button" class="action">${buttonLabel}</button>
      </article>
    `;

    this.shadowRoot.querySelector('.action').addEventListener('click', () => {
      this.interactions?.onToggle?.();
    });
  }

  formatTime(dateValue) {
    return new Date(dateValue).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
}
