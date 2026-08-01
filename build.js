#!/usr/bin/env node
/**
 * Elias Food — build script
 * Parses every file in /recipes into a single JSON index consumed by the
 * static frontend in /site. No dependencies — pure Node stdlib.
 *
 * Adding a recipe = drop a new .md file in /recipes and commit. Nothing else
 * to touch. The GitHub Action re-runs this on every push.
 */
const fs = require('fs');
const path = require('path');

const RECIPES_DIR = path.join(__dirname, 'recipes');
const OUT_DIR = path.join(__dirname, 'site', 'data');
const OUT_FILE = path.join(OUT_DIR, 'recipes.json');

// ---- fake-but-stable rating generator ---------------------------------------
// Seeded off the filename so the same recipe always gets the same "fake"
// rating — it just looks spoof-real rather than re-rolling on every build.
// Comments are NOT generated — you write those yourself, see parseComments().
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
function fakeRating(seedStr) {
  const rand = seededRandom(hashSeed(seedStr));
  const rating = Math.round((3.7 + rand() * 1.3) * 10) / 10; // 3.7–5.0
  const ratingCount = 8 + Math.floor(rand() * 240);
  return { rating, ratingCount };
}

// ---- tiny frontmatter parser ------------------------------------------------
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const [, fmBlock, body] = match;
  const meta = {};
  fmBlock.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) return;
    const key = m[1].trim();
    let val = m[2].trim();
    if (key === 'tags') {
      meta.tags = val.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    } else if (/^-?\d+(\.\d+)?$/.test(val)) {
      meta[key] = Number(val);
    } else {
      meta[key] = val;
    }
  });
  return { meta, body: body.trim() };
}

// ---- ingredient line parser (for servings scaling) -------------------------
// Matches a leading quantity (supports fractions like "1/2" and decimals),
// an optional unit, and the rest as the ingredient name.
const UNIT_WORDS = ['g','kg','ml','l','cl','tsp','tbsp','cup','cups','oz','lb','pinch','clove','cloves','whole','cs','cc'];
function parseIngredientLine(line) {
  const cleaned = line.replace(/^-+\s*/, '').trim();
  const m = cleaned.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ-]*)?\s*(.*)$/);
  if (!m) return { qty: null, unit: '', name: cleaned, raw: cleaned };
  let [, qtyStr, unit, rest] = m;
  let qty;
  if (qtyStr.includes(' ')) {
    const [whole, frac] = qtyStr.split(' ');
    const [n, d] = frac.split('/').map(Number);
    qty = Number(whole) + n / d;
  } else if (qtyStr.includes('/')) {
    const [n, d] = qtyStr.split('/').map(Number);
    qty = n / d;
  } else {
    qty = Number(qtyStr);
  }
  unit = unit || '';
  if (unit && !UNIT_WORDS.includes(unit.toLowerCase())) {
    // it wasn't actually a unit — fold it back into the name
    rest = `${unit} ${rest}`.trim();
    unit = '';
  }
  return { qty, unit, name: rest.trim(), raw: cleaned };
}

// ---- markdown section extraction (very small, only what we need) ----------
function extractSection(body, heading) {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, 'im');
  const match = body.match(re);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const nextHeading = rest.search(/^##\s+/m);
  return (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ---- comments, written by you in the recipe file ---------------------------
// Format inside a "## Comments" section, one per line:
//   - Alex | 2 days ago | Made this exactly as written, worth it.
// The "when" field is free text (optional) — write whatever you like, or
// drop it and just use "- Alex | Great with extra garlic."
function parseComments(section) {
  if (!section) return [];
  return section
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-'))
    .map((l) => l.replace(/^-+\s*/, ''))
    .map((line) => {
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length >= 3) return { author: parts[0], when: parts[1], text: parts.slice(2).join(' | ') };
      if (parts.length === 2) return { author: parts[0], when: null, text: parts[1] };
      return { author: null, when: null, text: parts[0] };
    });
}

// ---- main build -------------------------------------------------------------
function build() {
  if (!fs.existsSync(RECIPES_DIR)) {
    console.error('No /recipes directory found.');
    process.exit(1);
  }
  const files = fs.readdirSync(RECIPES_DIR).filter((f) => /\.(md|txt)$/i.test(f));
  const recipes = files.map((file) => {
    const filePath = path.join(RECIPES_DIR, file);
    const raw = fs.readFileSync(filePath, 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    const id = meta.slug || slugify(meta.title || file.replace(/\.(md|txt)$/i, ''));

    const ingredientsSection = extractSection(body, 'Ingredients');
    const instructionsSection = extractSection(body, 'Instructions');
    const notesSection = extractSection(body, 'Notes');
    const commentsSection = extractSection(body, 'Comments');

    const ingredients = ingredientsSection
      ? ingredientsSection.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('-')).map(parseIngredientLine)
      : [];
    const instructions = instructionsSection
      ? instructionsSection.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d+\./.test(l)).map((l) => l.replace(/^\d+\.\s*/, ''))
      : [];
    const comments = parseComments(commentsSection);

    const isExternal = !!meta.source_url;
    const { rating, ratingCount } = fakeRating(id);

    return {
      id,
      file,
      title: meta.title || file,
      tags: meta.tags || [],
      servings: meta.servings || null,
      time: meta.time || null,
      difficulty: meta.difficulty || null,
      caloriesPerServing: meta.calories_per_serving || null,
      isExternal,
      sourceName: meta.source_name || null,
      sourceUrl: meta.source_url || null,
      archiveUrl: meta.archive_url || null,
      ingredients,
      instructions,
      notes: notesSection || null,
      rating,
      ratingCount,
      comments,
    };
  });

  recipes.sort((a, b) => a.title.localeCompare(b.title));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), recipes }, null, 2));
  console.log(`Built ${recipes.length} recipes -> ${OUT_FILE}`);
}

build();
