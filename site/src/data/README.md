# `alliances.json` — alliances seed + pre-launch fallback

Hand-maintained flat file holding the Kingdom 1516 major alliances.

**Source of truth (MVP-2, Story 4.3):** the Alliance Finder now sources its data from the **Directus `alliances` collection at build time** (SSG) whenever a read token is configured (`DIRECTUS_TOKEN` — see `src/lib/directus-build.ts`). This file is:

- the **seed import** for that Directus collection (its rows were imported in Story 4.1), and
- the **fallback source** the build uses when no read token is set — which keeps CI and local builds green before the VPS + token exist. With a token, this file is not read.

Either way the **field shape must stay exactly as below** (AD-18 / AR-16) — the Finder reads the identical flat shape from both sources, so `finder.astro` / `AllianceCard` never change (AR-17).

## Shape

A JSON array of alliance objects. Each object has exactly these keys:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Display name / tag, e.g. `"ROK"`. |
| `slug` | string | Lowercase kebab-case, unique, **immutable**. The token the Finder passes to the apply form (AR-17). |
| `bear_trap_1` | `"HH:MM"` \| `null` | First Bear Trap time. |
| `bear_trap_2` | `"HH:MM"` \| `null` | Second Bear Trap time. Two independent scalars — attending **one** suffices ("two, OR" semantics, AR-12). |
| `peak` | `"HH:MM"` \| `null` | Single peak-activity time. **Not a range.** |
| `farm_alliance` | string \| `null` | The optional secondary "farm" alliance's name; `null` if none. |
| `official` | string \| `null` | The alliance leader's in-game name (seed placeholder only). In Directus this is a `directus_users` M2O relation, **not** a name. The build-time read deliberately does **not** select it (avoids leaking a user id into public HTML); the Finder maps it to `null`. Never shown publicly. |

## Time convention — important

All times (`bear_trap_1`, `bear_trap_2`, `peak`) are stored as **24-hour `"HH:MM"` strings in UTC** (in-game/server time). They are **times-of-day** (the Bear Trap is a recurring daily event — no date is stored). Conversion to a visitor's local time happens **only in the Finder**, never here.

When editing: enter the UTC time. If you read a time in your local timezone, convert it to UTC first.

In Directus the three time fields are the `time` type. The Data Studio's editor stores an edited value at seconds precision (`HH:MM:SS`); the build-time read normalizes it back to `HH:MM` (`src/data/alliances.ts` → `normalizeTime`), so downstream everything stays `HH:MM`.

## Current data

The current rows are the real NAP-5 alliances (UTC, confirmed 2026-06-30). `peak` is not yet known and is `null` for every row — add it later when available; until then the Finder ranks by the two Bear Trap times only.
