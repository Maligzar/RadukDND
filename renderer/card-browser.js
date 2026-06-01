'use strict';

const CardBrowser = (() => {
  let currentCategory = 'spells';
  let currentCards = [];
  let selectedCard = null;
  let isExpanded = false;
  let cache = { spells: null, items: null, creatures: null };
  let filterOptions = [];

  const DOM = {
    sidebar: document.querySelector('.sidebar'),
    toggleBtn: document.getElementById('toggleBtn'),
    searchInput: document.getElementById('searchInput'),
    filterSelect: document.getElementById('filterSelect'),
    cardListContainer: document.getElementById('cardListContainer'),
    cardDetailContainer: document.getElementById('cardDetailContainer'),
    sidebarIcons: Array.from(document.querySelectorAll('.sidebar-icon')),
  };

  // ─────────────────────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────────────────────
  function init() {
    setupEventListeners();
    loadCategory('spells');
  }

  function setupEventListeners() {
    DOM.toggleBtn.addEventListener('click', toggleSidebar);
    DOM.sidebarIcons.forEach(icon => {
      icon.addEventListener('click', () => switchCategory(icon.dataset.category));
    });
    DOM.searchInput.addEventListener('input', () => filterAndRender());
    DOM.filterSelect.addEventListener('change', () => filterAndRender());
  }

  // ─────────────────────────────────────────────────────────────
  // Sidebar toggle
  // ─────────────────────────────────────────────────────────────
  function toggleSidebar() {
    isExpanded = !isExpanded;
    if (isExpanded) {
      DOM.sidebar.classList.add('expanded');
      DOM.toggleBtn.textContent = '»';
    } else {
      DOM.sidebar.classList.remove('expanded');
      DOM.toggleBtn.textContent = '«';
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Category switching
  // ─────────────────────────────────────────────────────────────
  function switchCategory(category) {
    currentCategory = category;
    DOM.sidebarIcons.forEach(icon => icon.classList.remove('active'));
    document.querySelector(`[data-category="${category}"]`).classList.add('active');
    loadCategory(category);
  }

  // ─────────────────────────────────────────────────────────────
  // Data loading — fetch from 5e.tools or fallback
  // ─────────────────────────────────────────────────────────────
  async function loadCategory(category) {
    if (cache[category]) {
      currentCards = cache[category];
      updateFilters();
      filterAndRender();
      return;
    }

    showLoading();

    try {
      let cards = [];
      switch (category) {
        case 'spells':
          cards = await fetchSpells();
          break;
        case 'items':
          cards = await fetchItems();
          break;
        case 'creatures':
          cards = await fetchCreatures();
          break;
      }
      cache[category] = cards;
      currentCards = cards;
      updateFilters();
      filterAndRender();
    } catch (error) {
      console.error(`[CardBrowser] Error loading ${category}:`, error);
      showError(`Failed to load ${category}`);
    }
  }

  async function fetchSpells() {
    // 5e.tools API or fetch from JSON
    try {
      const response = await fetch('https://5e.tools/data/spells/index.json');
      if (!response.ok) throw new Error('Failed to fetch spells');
      const index = await response.json();
      const spells = [];

      // Load spell data from 5e.tools
      for (const book of Object.keys(index)) {
        const bookData = await fetch(`https://5e.tools/data/spells/${book}.json`);
        if (bookData.ok) {
          const data = await bookData.json();
          if (data.spell) {
            spells.push(
              ...data.spell.map(s => ({
                id: `${s.name}-${s.source || 'core'}`,
                name: s.name,
                level: s.level ?? 0,
                school: s.school || 'evocation',
                castingTime: s.time?.[0]?.number + ' ' + s.time?.[0]?.unit || 'action',
                range: s.range?.type === 'point' ? s.range.distance?.amount + ' ' + s.range.distance?.type || 'Self' : 'Touch',
                components: (s.components || []).join(', '),
                duration: s.duration?.[0]?.type || 'Instantaneous',
                description: s.entries?.map(e => typeof e === 'string' ? e : '').join('\n') || '',
                source: s.source || 'core',
                type: 'spell',
              }))
            );
          }
        }
      }
      return spells.slice(0, 300); // Limit for performance
    } catch (error) {
      console.warn('[CardBrowser] 5e.tools fetch failed, using fallback', error);
      return getFallbackSpells();
    }
  }

  async function fetchItems() {
    // 5e.tools items
    try {
      const response = await fetch('https://5e.tools/data/items-base.json');
      if (!response.ok) throw new Error('Failed to fetch items');
      const data = await response.json();
      return (data.item || []).map(item => ({
        id: `${item.name}-${item.source || 'core'}`,
        name: item.name,
        rarity: item.rarity || 'common',
        type: item.type || 'generic',
        description: item.entries?.map(e => typeof e === 'string' ? e : '').join('\n') || '',
        source: item.source || 'core',
        type: 'item',
      })).slice(0, 300);
    } catch (error) {
      console.warn('[CardBrowser] Items fetch failed, using fallback', error);
      return getFallbackItems();
    }
  }

  async function fetchCreatures() {
    // Placeholder — would fetch from 5e.tools bestiaries
    return [
      {
        id: 'placeholder-creature',
        name: 'Creature Database (Coming Soon)',
        cr: '--',
        type: 'information',
        description: 'Creature search will be available in a future update.',
        type: 'creature',
      },
    ];
  }

  // ─────────────────────────────────────────────────────────────
  // Fallback data (for offline use)
  // ─────────────────────────────────────────────────────────────
  function getFallbackSpells() {
    return [
      {
        id: 'fireball',
        name: 'Fireball',
        level: 3,
        school: 'evocation',
        castingTime: '1 action',
        range: '150 feet',
        components: 'V, S, M',
        duration: 'Instantaneous',
        description: 'A bright streak flashes from your pointing finger to a point of your choice within range...',
        type: 'spell',
      },
      {
        id: 'magic-missile',
        name: 'Magic Missile',
        level: 1,
        school: 'evocation',
        castingTime: '1 action',
        range: '120 feet',
        components: 'V, S',
        duration: 'Instantaneous',
        description: 'You hurl a mote of fire at a creature or object you can see within range...',
        type: 'spell',
      },
      {
        id: 'cure-wounds',
        name: 'Cure Wounds',
        level: 1,
        school: 'evocation',
        castingTime: '1 action',
        range: 'Touch',
        components: 'V, S',
        duration: 'Instantaneous',
        description: 'A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier...',
        type: 'spell',
      },
    ];
  }

  function getFallbackItems() {
    return [
      {
        id: 'longsword',
        name: 'Longsword',
        rarity: 'common',
        type: 'weapon',
        description: 'A martial melee weapon with a long blade, dealing 1d8 damage (1d10 if two-handed).',
        type: 'item',
      },
      {
        id: 'plate-armor',
        name: 'Plate Armor',
        rarity: 'common',
        type: 'armor',
        description: 'Heavy armor providing AC 18, giving disadvantage on Stealth checks.',
        type: 'item',
      },
    ];
  }

  // ─────────────────────────────────────────────────────────────
  // Filter & render
  // ─────────────────────────────────────────────────────────────
  function updateFilters() {
    const filterSet = new Set();
    currentCards.forEach(card => {
      if (currentCategory === 'spells' && card.level !== undefined) {
        filterSet.add(`Level ${card.level}`);
      } else if (currentCategory === 'items' && card.rarity) {
        filterSet.add(card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1));
      }
    });

    filterOptions = Array.from(filterSet).sort();
    DOM.filterSelect.innerHTML = '<option value="">All</option>';
    filterOptions.forEach(filter => {
      const opt = document.createElement('option');
      opt.value = filter;
      opt.textContent = filter;
      DOM.filterSelect.appendChild(opt);
    });
  }

  function filterAndRender() {
    const searchTerm = DOM.searchInput.value.toLowerCase();
    const filterTerm = DOM.filterSelect.value;

    let filtered = currentCards.filter(card => {
      const matchSearch = !searchTerm || card.name.toLowerCase().includes(searchTerm);
      let matchFilter = !filterTerm;

      if (filterTerm && currentCategory === 'spells') {
        matchFilter = filterTerm === `Level ${card.level}`;
      } else if (filterTerm && currentCategory === 'items') {
        matchFilter = filterTerm === (card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1));
      }

      return matchSearch && matchFilter;
    });

    if (filtered.length === 0) {
      renderEmpty();
    } else {
      renderCardList(filtered);
    }
  }

  function renderCardList(cards) {
    DOM.cardListContainer.innerHTML = '';
    cards.forEach(card => {
      const item = document.createElement('div');
      item.className = 'card-item';
      if (selectedCard?.id === card.id) item.classList.add('selected');
      item.textContent = card.name;
      item.addEventListener('click', () => selectCard(card));
      DOM.cardListContainer.appendChild(item);
    });
  }

  function selectCard(card) {
    selectedCard = card;
    renderCardList(currentCards);
    renderCardDetail(card);
  }

  function renderCardDetail(card) {
    if (!card) {
      DOM.cardDetailContainer.innerHTML = '<div class="empty-state">Select a card to view details</div>';
      return;
    }

    let html = `<div class="card">
      <div class="card-title">${card.name}</div>`;

    if (currentCategory === 'spells') {
      html += `
        <div class="card-meta">
          <span><strong>Level:</strong> ${card.level}</span>
          <span><strong>School:</strong> ${card.school}</span>
          <span><strong>Casting:</strong> ${card.castingTime}</span>
        </div>
        <div class="card-section">
          <div class="card-section-title">Details</div>
          <div class="card-description">
            <strong>Range:</strong> ${card.range}<br>
            <strong>Components:</strong> ${card.components}<br>
            <strong>Duration:</strong> ${card.duration}
          </div>
        </div>
        <div class="card-section">
          <div class="card-section-title">Description</div>
          <div class="card-description">${card.description}</div>
        </div>
      `;
    } else if (currentCategory === 'items') {
      html += `
        <div class="card-meta">
          <span><strong>Type:</strong> ${card.type}</span>
          <span><strong>Rarity:</strong> ${card.rarity}</span>
        </div>
        <div class="card-section">
          <div class="card-section-title">Description</div>
          <div class="card-description">${card.description}</div>
        </div>
      `;
    } else {
      html += `
        <div class="card-section">
          <div class="card-description">${card.description}</div>
        </div>
      `;
    }

    html += '</div>';
    DOM.cardDetailContainer.innerHTML = html;
  }

  function renderEmpty() {
    DOM.cardListContainer.innerHTML = '<div class="empty-state">No results found</div>';
    DOM.cardDetailContainer.innerHTML = '<div class="empty-state">No card selected</div>';
  }

  function showLoading() {
    DOM.cardListContainer.innerHTML = '<div class="loading">Loading cards...</div>';
    DOM.cardDetailContainer.innerHTML = '<div class="loading">Loading...</div>';
  }

  function showError(message) {
    DOM.cardListContainer.innerHTML = `<div class="empty-state">${message}</div>`;
    DOM.cardDetailContainer.innerHTML = `<div class="empty-state">${message}</div>`;
  }

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────
  return { init };
})();

// Start on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => CardBrowser.init());
} else {
  CardBrowser.init();
}
