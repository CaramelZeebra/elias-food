# Elias Food

A personal recipe box at `recipes.eliasro.de`. Recipes live as plain text
files in `/recipes`; a build script compiles them into a JSON index that a
static, no-framework frontend renders. Adding a recipe is: **drop a file in
`/recipes`, commit, push.** GitHub Actions rebuilds and redeploys automatically.

## How it's organised

```
recipes/            <- one file per recipe (.md or .txt). This is the whole "database".
build.js             <- parses every file into site/data/recipes.json
site/                <- the static frontend (deployed as-is via GitHub Pages)
  index.html
  css/style.css
  js/fuzzy.js         <- the fzf-style fuzzy matcher
  js/app.js           <- rendering + state
.github/workflows/deploy.yml
```

There is no database and no server. The "backend" is the GitHub repo itself;
the "API" is a JSON file regenerated on every push.

## Adding a recipe

Create `recipes/whatever-you-want.md` with frontmatter + body. Two shapes:

### 1. A recipe you're writing out in full

```markdown
---
title: Spaghetti Carbonara
tags: pasta, italian, dinner, quick
servings: 2
time: 20 min
calories_per_serving: 620
difficulty: easy
---

## Ingredients
- 200 g spaghetti
- 2 whole eggs

## Instructions
1. Boil the pasta.
2. Do the rest.

## Notes
Whatever you want to remember.
```

- `## Ingredients` lines starting with `-` get parsed for quantity + unit so
  the servings slider on the site can scale them live. Format:
  `<amount> <unit> <name>`, e.g. `2 tbsp olive oil` or `3 garlic cloves`
  (whole items with no unit work fine too).
- `## Instructions` lines must be numbered (`1.`, `2.`, ...).
- `calories_per_serving` is optional — leave it out if you don't want to
  guess. There's no automatic calorie estimation; that's a rabbit hole not
  worth the payoff for a personal recipe box, so it's just a manual field.

### 2. A famous/external recipe you're just archiving a pointer to

```markdown
---
title: NYT's Perfect Chocolate Chip Cookies
tags: dessert, baking, cookies
servings: 18
source_name: NYT Cooking
source_url: https://cooking.nytimes.com/recipes/1015819-the-chocolate-chip-cookie
archive_url: https://web.archive.org/web/2024/https://cooking.nytimes.com/recipes/1015819-the-chocolate-chip-cookie
---

## Notes
Whatever context you want.
```

Before adding one of these, save a Wayback Machine snapshot yourself at
https://web.archive.org/save (paste the URL, it archives it and gives you a
permanent link) and use that as `archive_url`. This repo doesn't auto-archive
for you — that would need a scheduled job with real network access, and a
one-click manual save is simpler and more reliable for a personal project.

### Tags → channels

Whatever you put in `tags:` automatically becomes a filterable "channel" in
the left sidebar, with a live count. No config needed anywhere else.

### Fake ratings, real comments

Ratings are the one thing still spoofed: `build.js` deterministically
generates a plausible rating (3.7–5.0) and a rating count, seeded off the
recipe's id — so it looks properly populated but stays stable across
rebuilds instead of re-rolling every time.

Comments are yours to write. Add a `## Comments` section to the recipe file,
one comment per line:

```markdown
## Comments
- Elias | 3 days ago | This is now the only carbonara I make.
- Rosa | 2 weeks ago | Used pancetta since I couldn't find guanciale, still great.
- Sam | Adding extra fish sauce is non-negotiable in my house.
```

Format is `- Author | when | text`, pipe-separated. The "when" field is free
text — write "3 days ago", "last month", a real date, whatever you like — or
drop it entirely and just use `- Author | text`.

## Running locally

```
node build.js        # regenerates site/data/recipes.json
cd site && python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploying

1. Push this repo to GitHub.
2. In repo Settings → Pages, set Source to "GitHub Actions".
3. In repo Settings → Pages → Custom domain, enter `recipes.eliasro.de`
   (the `site/CNAME` file already has this baked in, so Pages will pick it
   up automatically).
4. At your DNS provider for `eliasro.de`, add a CNAME record:
   `recipes` → `<your-github-username>.github.io`
5. Push to `main` — the Action in `.github/workflows/deploy.yml` builds
   `recipes.json` and deploys `site/` on every push.

## Frontend notes

- Three-pane layout (channels | list | detail) — no modals, nothing pops up.
  Selecting a recipe opens it inline in the right pane, and updates the URL
  hash so links to individual recipes are shareable/bookmarkable.
- A small fuzzy filter above the channel list narrows the tag sidebar itself
  the same way — same matcher, so `"dsrt"` finds `#dessert`, `"ital"` finds
  `#italian`.
- The search box is a from-scratch fzf-style fuzzy matcher
  (`js/fuzzy.js`) — subsequence matching over title, tags, source, and
  ingredient names, with bonuses for consecutive characters and word-boundary
  starts, plus a compactness guard so three random letters don't falsely
  match somewhere deep in a long ingredients list. So `"crb"` finds
  "Carbonara", `"grn cry"` finds "Thai Green Curry", and `"choc chip"` finds
  the cookies. No dependency, ~75 lines.
- Ratings render as kitchen tally marks (`|||| /`) rather than stars —
  fitting the ticket/index-card conceit and just more fun than five gold
  stars.
