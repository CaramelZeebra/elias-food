(function () {
  'use strict';

  const state = {
    recipes: [],
    tags: [],           // [{tag, count}]
    activeTags: new Set(), // empty = "all"; can hold several (Cmd/Ctrl+click to combine)
    query: '',
    tagQuery: '',
    selectedId: null,
    kbIndex: -1,          // index of keyboard-focused row in the currently rendered list
  };

  const els = {
    app: document.querySelector('.app'),
    railList: document.getElementById('rail-list'),
    railSearch: document.getElementById('rail-search'),
    recipeCount: document.getElementById('recipe-count'),
    search: document.getElementById('search'),
    resultCount: document.getElementById('result-count'),
    filterRow: document.getElementById('filter-row'),
    recipeList: document.getElementById('recipe-list'),
    detailPane: document.getElementById('detail-pane'),
    detailEmpty: document.getElementById('detail-empty'),
    recipeCard: document.getElementById('recipe-card'),
    backBtn: document.getElementById('back-btn'),
  };

  // ---- boot -----------------------------------------------------------------
  fetch('data/recipes.json')
    .then((r) => r.json())
    .then((data) => {
      state.recipes = data.recipes;
      state.tags = computeTagCounts(data.recipes);
      els.recipeCount.textContent = data.recipes.length;
      renderRail();
      renderFilterRow();
      renderList();

      const hashId = location.hash.replace('#', '');
      if (hashId && state.recipes.some((r) => r.id === hashId)) {
        selectRecipe(hashId);
      }
    })
    .catch((err) => {
      els.recipeList.innerHTML = `<li class="list-error">Could not load recipes.json — did the build script run? (${err.message})</li>`;
    });

  window.addEventListener('hashchange', () => {
    const hashId = location.hash.replace('#', '');
    if (hashId) selectRecipe(hashId, { skipHash: true });
  });

  els.backBtn.addEventListener('click', () => {
    els.app.classList.remove('detail-open');
    els.search.focus();
  });

  // ---- global keyboard shortcuts: "/" to search, ↑↓ to move, ↵ to open -------
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement.tagName;
    const inField = tag === 'INPUT' || tag === 'TEXTAREA';

    if (e.key === '/' && !inField) {
      e.preventDefault();
      els.search.focus();
      els.search.select();
      return;
    }
    if (e.key === 'Escape') {
      if (document.activeElement === els.search || document.activeElement === els.railSearch) {
        document.activeElement.blur();
      } else if (els.app.classList.contains('detail-open')) {
        els.app.classList.remove('detail-open');
      }
      return;
    }
    // Arrow nav works while typing in the main search box, or with nothing focused
    const navAllowed = document.activeElement === els.search || !inField;
    if (!navAllowed) return;

    const rows = [...els.recipeList.querySelectorAll('.recipe-row')];
    if (!rows.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.kbIndex = Math.min(state.kbIndex + 1, rows.length - 1);
      focusRow(rows);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.kbIndex = Math.max(state.kbIndex - 1, 0);
      focusRow(rows);
    } else if (e.key === 'Enter' && document.activeElement === els.search) {
      const targetRow = rows[state.kbIndex] || rows[0];
      if (targetRow) selectRecipe(targetRow.dataset.id);
    }
  });

  function focusRow(rows) {
    rows.forEach((r) => r.classList.remove('kb-focus'));
    const row = rows[state.kbIndex];
    if (!row) return;
    row.classList.add('kb-focus');
    row.scrollIntoView({ block: 'nearest' });
  }

  function computeTagCounts(recipes) {
    const map = new Map();
    recipes.forEach((r) => r.tags.forEach((t) => map.set(t, (map.get(t) || 0) + 1)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
  }

  // ---- rail (channels) -------------------------------------------------------
  function renderRail() {
    const noneSelected = state.activeTags.size === 0;
    const allItem = `
      <li>
        <button class="rail-item ${noneSelected ? 'active' : ''}" data-tag="all">
          <span class="rail-hash">#</span>all-recipes
          <span class="rail-badge">${state.recipes.length}</span>
        </button>
      </li>`;

    let tagList = state.tags;
    let matchPositions = new Map(); // tag -> positions for highlighting
    if (state.tagQuery.trim()) {
      const scored = [];
      for (const t of state.tags) {
        const m = fuzzyMatch(state.tagQuery, t.tag);
        if (m) { scored.push({ ...t, score: m.score }); matchPositions.set(t.tag, m.positions); }
      }
      scored.sort((a, b) => b.score - a.score);
      tagList = scored;
    }

    const items = tagList.map(({ tag, count }) => `
      <li>
        <button class="rail-item ${state.activeTags.has(tag) ? 'active' : ''}" data-tag="${tag}">
          <span class="rail-hash">#</span>${matchPositions.has(tag) ? highlightMatch(tag, matchPositions.get(tag)) : escapeHtml(tag)}
          <span class="rail-badge">${count}</span>
        </button>
      </li>`).join('');

    const noMatch = state.tagQuery.trim() && !tagList.length
      ? `<li class="rail-empty">No channels match.</li>` : '';

    els.railList.innerHTML = allItem + items + noMatch;

    els.railList.querySelectorAll('.rail-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tag = btn.dataset.tag;
        if (tag === 'all') {
          state.activeTags.clear();
        } else if (e.metaKey || e.ctrlKey) {
          // Cmd/Ctrl+click: add or remove this channel from the current combination.
          if (state.activeTags.has(tag)) state.activeTags.delete(tag);
          else state.activeTags.add(tag);
        } else {
          // Plain click: browse just this one channel.
          state.activeTags = new Set([tag]);
        }
        renderRail();
        renderFilterRow();
        renderList();
      });
    });
  }

  let railDebounce;
  els.railSearch.addEventListener('input', () => {
    clearTimeout(railDebounce);
    railDebounce = setTimeout(() => {
      state.tagQuery = els.railSearch.value;
      renderRail();
    }, 30);
  });

  // ---- quick filter chips (difficulty / type, teams "pinned filters" style) --
  function renderFilterRow() {
    const chips = [
      { key: 'quick', label: '⏱ under 30 min', test: (r) => r.time && /\b([0-2]?\d)\s*min/i.test(r.time) && parseInt(r.time, 10) <= 30 },
      { key: 'easy', label: '● easy', test: (r) => r.difficulty === 'easy' },
      { key: 'external', label: '↗ archived link', test: (r) => r.isExternal },
    ];
    els.filterRow.innerHTML = chips.map((c) => `
      <button class="chip" data-chip="${c.key}">${c.label}</button>
    `).join('');
    els.filterRow.querySelectorAll('.chip').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('chip-active');
        renderList();
      });
    });
  }

  function activeChipTests() {
    const defs = {
      quick: (r) => r.time && /\b([0-2]?\d)\s*min/i.test(r.time) && parseInt(r.time, 10) <= 30,
      easy: (r) => r.difficulty === 'easy',
      external: (r) => r.isExternal,
    };
    return [...els.filterRow.querySelectorAll('.chip-active')].map((el) => defs[el.dataset.chip]);
  }

  // ---- search input -----------------------------------------------------------
  let debounceHandle;
  els.search.addEventListener('input', () => {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      state.query = els.search.value;
      state.kbIndex = state.query ? 0 : -1; // jump to top match as you type, like a real fuzzy finder
      renderList();
    }, 30); // fast — this is meant to feel instant
  });

  // ---- list pane --------------------------------------------------------------
  function renderList() {
    let pool = state.recipes;
    if (state.activeTags.size) pool = pool.filter((r) => r.tags.some((t) => state.activeTags.has(t)));
    activeChipTests().forEach((test) => { pool = pool.filter(test); });

    const results = fuzzySearchRecipes(state.query, pool);
    els.resultCount.textContent = results.length;

    if (!results.length) {
      els.recipeList.innerHTML = `<li class="list-empty">No matches for “${escapeHtml(state.query)}”. Fuzzy find rewards initials — try fewer letters.</li>`;
      return;
    }

    els.recipeList.innerHTML = results.map(({ recipe, positions, field }, i) => {
      const titleHtml = field === 'title' ? highlightMatch(recipe.title, positions) : escapeHtml(recipe.title);
      const isActive = recipe.id === state.selectedId;
      const isKbFocus = i === state.kbIndex;
      return `
        <li>
          <button class="recipe-row ${isActive ? 'active' : ''} ${isKbFocus ? 'kb-focus' : ''}" data-id="${recipe.id}">
            <div class="recipe-row-main">
              <span class="recipe-row-title">${titleHtml}</span>
              <span class="recipe-row-tags">${recipe.tags.slice(0, 3).map((t) => `#${escapeHtml(t)}`).join(' ')}</span>
            </div>
            <div class="recipe-row-meta">
              ${tally(recipe.rating)}
              <span class="recipe-row-rating-num">${recipe.rating.toFixed(1)}</span>
              ${recipe.isExternal ? '<span class="ext-badge" title="Linked + archived">↗</span>' : ''}
            </div>
          </button>
        </li>`;
    }).join('');

    const rowEls = els.recipeList.querySelectorAll('.recipe-row');
    rowEls.forEach((btn, i) => {
      btn.addEventListener('click', () => selectRecipe(btn.dataset.id));
      btn.addEventListener('mouseenter', () => {
        state.kbIndex = i;
        rowEls.forEach((r) => r.classList.remove('kb-focus'));
        btn.classList.add('kb-focus');
      });
    });
  }

  // ---- detail pane --------------------------------------------------------------
  function selectRecipe(id, opts) {
    const recipe = state.recipes.find((r) => r.id === id);
    if (!recipe) return;
    state.selectedId = id;
    if (!(opts && opts.skipHash)) location.hash = id;
    renderList(); // to update active row highlight

    const activeRow = els.recipeList.querySelector('.recipe-row.active');
    if (activeRow) {
      state.kbIndex = [...els.recipeList.querySelectorAll('.recipe-row')].indexOf(activeRow);
      if (!(opts && opts.skipScrollIntoView)) activeRow.scrollIntoView({ block: 'nearest' });
    }

    renderDetail(recipe);
    els.app.classList.add('detail-open'); // no-op on desktop widths, switches the mobile view

    // Reset scroll both now and on the next frame — some browsers (notably
    // Safari) don't honour focus({preventScroll:true}) and force-scroll the
    // focused title into view a frame later, which silently undoes a single
    // synchronous reset and leaves the card looking "stuck" below the fold.
    els.detailPane.scrollTop = 0;
    requestAnimationFrame(() => { els.detailPane.scrollTop = 0; });
  }

  function renderDetail(recipe) {
    els.detailEmpty.hidden = true;
    els.recipeCard.hidden = false;
    els.recipeCard.classList.remove('fade-in');
    void els.recipeCard.offsetWidth; // restart the animation on every open, including re-selecting the same recipe
    els.recipeCard.classList.add('fade-in');

    const baseServings = recipe.servings || 1;

    els.recipeCard.innerHTML = `
      <header class="card-header">
        <div class="card-eyebrow">${recipe.tags.map((t) => `#${escapeHtml(t)}`).join(' ')}</div>
        <h1 class="card-title">${escapeHtml(recipe.title)}</h1>
        <div class="card-stats">
          ${recipe.time ? `<span class="stat"><b>${escapeHtml(recipe.time)}</b><small>time</small></span>` : ''}
          ${recipe.difficulty ? `<span class="stat"><b>${escapeHtml(cap(recipe.difficulty))}</b><small>difficulty</small></span>` : ''}
          ${recipe.caloriesPerServing ? `<span class="stat" id="cal-stat"><b>${recipe.caloriesPerServing}</b><small>kcal / serving*</small></span>` : ''}
          <span class="stat rating-stat">${tally(recipe.rating)}<small>${recipe.rating.toFixed(1)} · ${recipe.ratingCount} home cooks</small></span>
        </div>
        ${recipe.caloriesPerServing ? '<p class="card-footnote">*rough estimate, not a lab measurement — don\'t @ me</p>' : ''}
      </header>

      ${recipe.isExternal ? renderExternal(recipe) : renderIngredientsAndSteps(recipe, baseServings)}

      ${recipe.notes ? `<section class="card-section"><h2>Notes</h2><p class="notes">${escapeHtml(recipe.notes).replace(/\n/g, '<br/>')}</p></section>` : ''}

      ${renderComments(recipe)}
    `;

    if (!recipe.isExternal && recipe.ingredients.length) {
      wireServingsControl(recipe, baseServings);
    }

    const titleEl = els.recipeCard.querySelector('.card-title');
    if (titleEl) { titleEl.setAttribute('tabindex', '-1'); titleEl.focus({ preventScroll: true }); }
  }

  function renderExternal(recipe) {
    const hasSource = !!recipe.sourceUrl;
    const hasArchive = !!recipe.archiveUrl;
    const intro = hasSource
      ? "This one lives on the original site — kept here as a pointer plus a safeguarded copy."
      : "No live page for this one — the archived copy below is the only record of it.";
    return `
      <section class="card-section external-block">
        <h2>Source</h2>
        <p>${intro}</p>
        <div class="external-links">
          ${hasSource ? `<a class="ext-link" href="${recipe.sourceUrl}" target="_blank" rel="noopener">↗ Open on ${escapeHtml(recipe.sourceName || 'source site')}</a>` : ''}
          ${hasArchive ? `<a class="ext-link ext-link-archive" href="${recipe.archiveUrl}" target="_blank" rel="noopener">🗄 Open archived copy</a>` : ''}
        </div>
      </section>`;
  }

  function renderIngredientsAndSteps(recipe, baseServings) {
    const ingredientsHtml = recipe.ingredients.map((ing, i) => `
      <li class="ingredient-row" data-qty="${ing.qty ?? ''}" data-unit="${escapeHtml(ing.unit || '')}" data-name="${escapeHtml(ing.name)}">
        <span class="ing-qty" data-ing-index="${i}">${formatQty(ing.qty)}</span>
        <span class="ing-unit">${escapeHtml(ing.unit)}</span>
        <span class="ing-name">${escapeHtml(ing.name)}</span>
      </li>`).join('');

    const stepsHtml = recipe.instructions.map((step, i) => `
      <li><span class="step-num">${i + 1}</span><span class="step-text">${escapeHtml(step)}</span></li>`).join('');

    return `
      <section class="card-section servings-block">
        <div class="servings-control">
          <label for="servings-input">Servings</label>
          <button type="button" class="servings-btn" id="servings-dec">−</button>
          <input type="number" id="servings-input" min="1" max="50" value="${baseServings}" />
          <button type="button" class="servings-btn" id="servings-inc">+</button>
        </div>
      ${recipe.ingredients.length ? `
      <div class="card-columns">
        <div>
          <h2>Ingredients</h2>
          <ul class="ingredient-list" id="ingredient-list">${ingredientsHtml}</ul>
        </div>
        <div>
          <h2>Method</h2>
          <ol class="step-list">${stepsHtml}</ol>
        </div>
      </div>` : ''}
      </section>`;
  }

  function wireServingsControl(recipe, baseServings) {
    const input = document.getElementById('servings-input');
    const dec = document.getElementById('servings-dec');
    const inc = document.getElementById('servings-inc');
    const rows = () => els.recipeCard.querySelectorAll('.ingredient-row');

    function applyServings(n) {
      n = Math.max(1, Math.min(50, n));
      input.value = n;
      const ratio = n / baseServings;
      rows().forEach((row) => {
        const qty = row.dataset.qty;
        const qtyEl = row.querySelector('.ing-qty');
        if (qty === '') { return; }
        qtyEl.textContent = formatQty(Number(qty) * ratio);
      });
    }

    dec.addEventListener('click', () => applyServings(Number(input.value) - 1));
    inc.addEventListener('click', () => applyServings(Number(input.value) + 1));
    input.addEventListener('input', () => applyServings(Number(input.value) || 1));
  }

  function renderComments(recipe) {
    if (!recipe.comments || !recipe.comments.length) return '';
    return `
      <section class="card-section comments-block">
        <h2>Comments</h2>
        <ul class="comment-list">
          ${recipe.comments.map((c) => `
            <li class="comment">
              <div class="comment-avatar">${escapeHtml((c.author || '?')[0])}</div>
              <div class="comment-body">
                <div class="comment-meta"><b>${escapeHtml(c.author || 'Anonymous')}</b>${c.when ? `<span>${escapeHtml(c.when)}</span>` : ''}</div>
                <p>${escapeHtml(c.text)}</p>
              </div>
            </li>`).join('')}
        </ul>
      </section>`;
  }

  // ---- helpers ------------------------------------------------------------------
  function tally(rating) {
    // spoof rating rendered as kitchen tally marks instead of stars — 0 to 5 scale
    const full = Math.round(rating);
    let marks = '';
    for (let i = 0; i < full; i++) marks += (i % 5 === 4) ? '/' : '|';
    return `<span class="tally" title="${rating.toFixed(1)} / 5">${marks || '·'}</span>`;
  }

  function formatQty(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '';
    const rounded = Math.round(n * 100) / 100;
    if (Number.isInteger(rounded)) return String(rounded);
    // prefer common fractions for a recipe-card feel
    const fracs = { 0.25: '¼', 0.5: '½', 0.75: '¾', 0.33: '⅓', 0.67: '⅔' };
    const whole = Math.floor(rounded);
    const frac = Math.round((rounded - whole) * 100) / 100;
    const closest = Object.keys(fracs).reduce((a, b) => Math.abs(b - frac) < Math.abs(a - frac) ? b : a, '0.25');
    if (Math.abs(closest - frac) < 0.06) {
      return whole ? `${whole}${fracs[closest]}` : fracs[closest];
    }
    return String(rounded);
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
})();
