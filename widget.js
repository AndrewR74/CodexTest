import { FeaturedSession } from './FeaturedSession.js';
gap: 6px;
      }

      .field label {
    font - size: 0.875rem;
    font - weight: 600;
}

      .search - input,
      .availability - select,
      .category - button {
    border: 1px solid #d1d5db;
    border - radius: 10px;
    min - height: 42px;
    padding: 10px 12px;
    box - sizing: border - box;
    background: #fff;
    width: 100 %;
}

      .category - filter {
    position: relative;
}

      .category - button {
    text - align: left;
    cursor: pointer;
}

      .category - menu {
    position: absolute;
    top: calc(100 % + 6px);
    left: 0;
    width: 100 %;
    max - height: 280px;
    overflow: auto;
    background: #fff;
    border: 1px solid #d1d5db;
    border - radius: 12px;
    box - shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
    padding: 8px;
    z - index: 20;
    display: none;
}

      .category - filter.open.category - menu {
    display: block;
}

      .category - option {
    display: flex;
    align - items: center;
    gap: 10px;
    padding: 8px;
    border - radius: 8px;
}

      .category - option:hover {
    background: #f3f4f6;
}

      .tabs {
    display: flex;
    gap: 8px;
    overflow - x: auto;
    padding - bottom: 4px;
}

      .tab {
    border: 1px solid #d1d5db;
    background: #fff;
    border - radius: 999px;
    padding: 10px 14px;
    cursor: pointer;
    white - space: nowrap;
    font - weight: 600;
}

      .tab.active {
    background: ${ this.configuration?.customColors?.background || this.theme?.palette?.secondary || '#eef4ff' };
    border - color: ${ this.theme?.palette?.primary || '#016AE1' };
}
}