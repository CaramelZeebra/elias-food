/**
 * Tiny fzf-style fuzzy matcher.
 * Scores a query as a subsequence of target, rewarding:
 *  - consecutive character runs
 *  - matches at word boundaries (start of word, after - _ space)
 *  - matches early in the string
 * Returns { score, positions } or null if query isn't a subsequence.
 */
function fuzzyMatch(query, target) {
  if (!query) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let qi = 0;
  let score = 0;
  let consecutive = 0;
  const positions = [];

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      let bonus = 1;
      const prevChar = t[ti - 1];
      const isBoundary = ti === 0 || prevChar === ' ' || prevChar === '-' || prevChar === '_' || prevChar === '/';
      if (isBoundary) bonus += 3;
      if (consecutive > 0) bonus += Math.min(consecutive, 4) * 2;
      bonus += Math.max(0, 2 - ti / 20); // slight preference for earlier matches
      score += bonus;
      positions.push(ti);
      consecutive++;
      qi++;
    } else {
      consecutive = 0;
    }
  }

  if (qi < q.length) return null; // not all query chars matched in order

  // Reject matches that are too scattered to be a meaningful fuzzy hit —
  // e.g. 3 random letters coincidentally appearing 40 characters apart in a
  // long concatenated ingredients string. Real fzf-style matching tolerates
  // some spread (typos, abbreviations) but not an arbitrarily loose spread.
  const span = positions[positions.length - 1] - positions[0] + 1;
  const maxSpan = Math.max(8, q.length * 5);
  if (span > maxSpan) return null;

  return { score, positions };
}

/**
 * Fuzzy-search a list of recipes across several weighted fields.
 * Returns results sorted best-first, each with the recipe + score + which
 * field matched (for highlighting).
 */
function fuzzySearchRecipes(query, recipes) {
  if (!query.trim()) {
    return recipes.map((r) => ({ recipe: r, score: 0, field: null, positions: [] }));
  }
  const results = [];
  for (const r of recipes) {
    const candidates = [
      { field: 'title', text: r.title, weight: 3 },
      { field: 'tags', text: r.tags.join(' '), weight: 1.5 },
      { field: 'source', text: r.sourceName || '', weight: 1 },
      { field: 'ingredients', text: (r.ingredients || []).map((i) => i.name).join(' '), weight: 0.8 },
    ];
    let best = null;
    for (const c of candidates) {
      if (!c.text) continue;
      const m = fuzzyMatch(query, c.text);
      if (m && (!best || m.score * c.weight > best.score)) {
        best = { score: m.score * c.weight, field: c.field, positions: m.positions };
      }
    }
    if (best) results.push({ recipe: r, ...best });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

/** Wrap matched character positions of `text` in <mark> for highlighting. */
function highlightMatch(text, positions) {
  if (!positions || !positions.length) return escapeHtml(text);
  const posSet = new Set(positions);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = escapeHtml(text[i]);
    out += posSet.has(i) ? `<mark>${ch}</mark>` : ch;
  }
  return out;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
