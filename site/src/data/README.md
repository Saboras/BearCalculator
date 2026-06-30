# `alliances.json` — canonical alliances dataset (MVP-1)

Hand-maintained flat file holding the Kingdom 1516 major alliances. It is the **single source** for the Alliance Finder in MVP-1 and the **seed import** for the MVP-2 Directus `alliances` collection — so the field shape must stay exactly as below (AD-18 / AR-16).

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
| `official` | string \| `null` | The alliance leader's in-game name (placeholder). Maps to a Directus user at the MVP-2 seed. Not shown publicly. |

## Time convention — important

All times (`bear_trap_1`, `bear_trap_2`, `peak`) are stored as **24-hour `"HH:MM"` strings in UTC** (in-game/server time). They are **times-of-day** (the Bear Trap is a recurring daily event — no date is stored). Conversion to a visitor's local time happens **only in the Finder**, never here.

When editing: enter the UTC time. If you read a time in your local timezone, convert it to UTC first.

## Current data

The current rows are the real NAP-5 alliances (UTC, confirmed 2026-06-30). `peak` is not yet known and is `null` for every row — add it later when available; until then the Finder ranks by the two Bear Trap times only.
