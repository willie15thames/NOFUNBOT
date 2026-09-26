# V84 Architecture Intent

## Product identity
This bot is now architected as a **Server Management + Setup Wizard + Personality AI Bot**.

It still supports league workflows when a template or module calls for them, but the core product is no longer league-only.

## Core pillars
- Server management
- Live setup wizard
- Template-aware channel/category building
- Personality AI with audience-aware tones
- Optional competitive / league modules
- Safe onboarding and moderation rails

## Template system direction
Each main template can now branch into subtemplates so server builds become more precise without requiring a full reset.

Examples:
- Gaming -> COD / GTA / Sports Gaming
- Sports -> NFL / NBA / Soccer
- Educational -> Coding / Cybersecurity / Language
- Movie -> Movies / Anime / Wrestling
- Fandom -> Anime / Star Wars / Marvel / Disney
- Professional -> Career / Startup / Cyber Ops

## Editing direction
After build, the setup wizard is intended to stay useful as a live configuration panel.
That means template, subtemplate, identity, rules, tones, and modular lanes can be adjusted without rebuilding the whole server.

## Data direction
Adding or editing a subserver/module should not wipe its data.
Deletion should be the only destructive action that removes module-specific data.
