# Dev, AI & Product — Concept Dictionary

An interactive web app for defining, saving, and exploring technical, AI, and product concepts.
Comes pre-loaded with **64 seeded concepts** across categories like Frontend, ML, LLMs, Product Strategy, Growth, Metrics, and more.

Built with **Vite + React + TypeScript**, with a **d3** knowledge graph and live concept lookups via the Anthropic API.

## Features

- **Look up** any dev, AI, or PM term — get a structured definition (what / why / example), an auto-generated SVG diagram, a Q&A panel, and "Learn next" suggestions.
- **My Concepts** — your personal library. Filter, sort by depth/domain, group by domain, import/export JSON.
- **Knowledge Graph** — d3 force-directed graph of your saved concepts and their related platforms, domains, and concepts. Drag, zoom, click to look up.
- **64 seeded concepts** — auto-populate on first launch. Delete them, edit them, or add your own; deletions persist.

## Setup

You need Node.js 18+ and npm.

```powershell
cd C:\Users\billy\Projects\concept-dictionary
npm install
npm run dev
```

Vite opens [http://localhost:5173](http://localhost:5173).

## Get an Anthropic API key

Live lookups, diagrams, Q&A, and Learn-next suggestions need a key. **Without it, you can still browse the seeded library.**

1. Sign in at [console.anthropic.com](https://console.anthropic.com).
2. Settings → API Keys → Create Key.
3. Copy the key (`sk-ant-…`).
4. In the app, click the **key icon** (top-right of the header) → paste → Save.

The key is stored only in your browser's `localStorage`. To remove it, click the gear icon → **Clear key**.

> **Security note:** This app calls the Anthropic API directly from your browser using the `anthropic-dangerous-direct-browser-access` header. That's fine for personal/local use. If you ever deploy this publicly, route requests through a backend proxy so the key isn't exposed.

## Build & deploy

```powershell
npm run build      # outputs to ./dist
npm run preview    # serves the production build at :4173
```

Deploy `./dist` to any static host. Since you've got `vercel` installed:

```powershell
npm run build
vercel deploy ./dist
```

## Project structure

```
concept-dictionary/
├── index.html              ← Tabler icons CDN + root mount
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── README.md
└── src/
    ├── App.tsx             ← main app (lookup, library, graph, settings)
    ├── concepts.json       ← 64 seed concepts (auto-loaded on first run)
    ├── main.tsx            ← React entry
    ├── styles.css          ← CSS variables (light + dark) and base styles
    └── vite-env.d.ts
```

## Storage keys (localStorage)

| Key | Purpose |
|---|---|
| `concept_dictionary:all_concepts` | The current saved library (JSON array). |
| `concept_dictionary:seed_v1` | One-time seed flag — prevents re-seeding after you delete a concept. |
| `concept_dictionary:anthropic_api_key` | Your API key. |
| `qa:<term>` | Per-concept Q&A history. |

To wipe everything: open DevTools → Application → Local Storage → clear the origin.

## Origin

This is the web-app port of a Claude artifact prototype (`dev-concepts-dictionary.tsx` in OneDrive). The core UI, schema, and graph logic are unchanged; what's adapted is the storage layer (`window.storage` → `localStorage`), the API auth (in-artifact → user-provided key), and the build (standalone React app).
