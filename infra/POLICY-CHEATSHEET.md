# Policy-Spickzettel — wer darf was? (Owner-Kurzreferenz)

Klartext-Übersicht für die Account-Pflege im Studio. Die technische Wahrheit mit allen
Details steht in `roles-and-policies.md` — dieser Zettel ist die Alltagsversion.

**Grundprinzip:** Jeder Leader-Account hat die Rolle **„Leader"** (nur die Login-Hülle,
kann allein nichts) plus eine oder mehrere **Policies** — die eigentlichen Fähigkeiten.
Die Website-Adminfläche (`kingdom1516.vip/admin`) zeigt jedem automatisch genau die
Tabs, für die seine Policies reichen.

**Studio-Plätze:** Die Gratis-Stufe erlaubt **3 Accounts mit Studio-Zugang** (das
Verwaltungsprogramm auf admin.kingdom1516.vip). Owner belegt einen. Nur Policies mit
„Studio: ja" kosten einen Platz — Website-Logins sind unbegrenzt.

## Die Policies

| Policy | Kann… | Kann NICHT… | Studio/Platz |
|---|---|---|---|
| `transfer-viewer` | alle Bewerbungen + Zähler **ansehen** | irgendetwas ändern | ❌ nein |
| `transfer-curator` | Viewer **+ arbeiten**: Status schalten, Wege/Vorschläge setzen, Duos gruppieren, Bewerbungen löschen, Fenster aufräumen | Fenster/Schwelle schalten; Bewerber-Stammdaten sind Tabu (Konvention, s. u.) | ❌ nein |
| `guides-viewer` | Entwürfe + veröffentlichte Guides **lesen** | schreiben, veröffentlichen | ✅ **ja** — sparsam vergeben! |
| `guides-editor` | Guide-**Entwürfe anlegen & bearbeiten** (Studio-Editor mit Bildern/Tabellen) | **veröffentlichen** — echte Server-Sperre (403) | ✅ ja |
| `guides-senior` | **veröffentlichen** + bestehende Entwürfe bearbeiten | **neue Entwürfe anlegen** → braucht zusätzlich `guides-editor` | ✅ ja |
| `alliances-official` | Allianz-Daten pflegen (Bärenfallen-Zeiten, Peak, Farm-Kürzel) | Allianzen anlegen/löschen (nur Owner) | ✅ ja |
| `finder-build-read` | — Systemnutzer für den Website-Bau — | **niemals an Menschen vergeben** | ❌ nein |
| *(Public)* | unangemeldete Besucher: Bewerbung **absenden** | irgendetwas lesen | — |
| *(Administrator-Rolle)* | **alles** — Konten, Fenster, Kategorien, Automatiken | — | ✅ ja |

## Kombi-Rezepte

| Wen willst du? | Policies |
|---|---|
| Standard-Leader (mitlesen) | `transfer-viewer` |
| Kurator (max. **2** gleichzeitig — Team-Regel, prüft kein Server) | `transfer-curator` — dabei `transfer-viewer` **entfernen**, nie beide |
| Guide-Autor | `guides-editor` |
| Autor, der auch veröffentlicht | `guides-editor` **+** `guides-senior` |
| Allianz-Pfleger | `alliances-official` |
| Vertrauens-Vollpaket („Osmo") | `transfer-curator` + `guides-editor` + `guides-senior` + `alliances-official` (1 Platz) |
| Echter Stellvertreter | Rolle **Administrator** statt Leader (Policies dann egal) |

## Merkregeln

1. **Senior braucht Editor** — `guides-senior` allein kann keine neuen Entwürfe anlegen.
2. **Kurator ersetzt Viewer** — nie beide anhängen.
3. **Nur Studio-Policies kosten Plätze** — 10 Leader mit `transfer-viewer`/`-curator` = 0 Plätze.
4. **Passwörter setzt/resettet nur der Owner** — Leader können ihre eigenen nicht ändern (Gratis-Stufe).
5. **Ehrlichkeits-Fußnote (Gratis-Stufe):** Innerhalb einer erlaubten Tabelle sind die Grenzen
   gröber als die Oberfläche zeigt (ein Kurator könnte per Hand-API auch Stammdaten anfassen,
   ein Official fremde Allianz-Zeilen). Das Sicherheitsnetz: kleines Vertrauensteam + tägliches
   Backup. Alles Weitere: `roles-and-policies.md` §0/§4.
