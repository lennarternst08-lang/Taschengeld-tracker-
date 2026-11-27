# Trinkgeld-Tracker (Flaschenpost)

Schneller, handyoptimierter Tracker für Trinkgeld und den voraussichtlichen
Auszahlungsbetrag am Monatsende. Reine statische Web-App: kein Server, kein
Build. Mit **Google-Anmeldung** werden die Daten über Firebase/Firestore
zwischen Handy und PC synchronisiert; ohne Anmeldung bleiben sie lokal im Browser.

## Google-Sync (Firebase)

- Nutzt **dasselbe Firebase-Projekt wie FLIPBIKE** (`firebase-config.js`).
  `lennarternst08-lang.github.io` ist dort schon als Login-Domain freigegeben.
- Daten pro Google-Konto in Firestore:
  `tipTracker/{uid}` (Einstellungen) und `tipTracker/{uid}/months/{YYYY-MM}` (Einträge).
- Neue Einträge werden per `arrayUnion` angehängt, Löschungen per `arrayRemove`, also
  überschreiben sich Handy und PC nicht gegenseitig. Offline-Änderungen werden später hochgeladen.
- Was vor der Anmeldung lokal eingetragen wurde, wird beim ersten Login ins Konto übernommen.
- **Einmalig nötig:** Die Regel für `tipTracker` liegt in `firestore.rules` im
  FLIPBIKE-Repo und muss veröffentlicht werden (`firebase deploy --only firestore:rules`
  im FLIPBIKE-Ordner oder in der Firebase-Konsole → Firestore → Regeln einfügen).
  Solange das fehlt, zeigt die App „Keine Berechtigung …“.
- Lokal testen mit Emulator: `firebase emulators:start --only auth,firestore`, dann
  `http://localhost:8000/?emulator` öffnen.

## Was angezeigt wird

| Bereich | Inhalt |
|---|---|
| **Aktuelle Auszahlung** | Lohn + Trinkgeld, darunter Lohn ohne TG und Trinkgeld (online / bar) |
| **Kennzahlen** | Ø Trinkgeld pro Stunde, gearbeitete Stunden, noch geplante Stunden |
| **Prognose Monatsende** | (gearbeitet + geplant) × Stundenlohn, ohne TG / mit bisherigem TG / mit hochgerechnetem TG (Ø TG/h × alle Stunden) |
| **Verlauf** | Alle Einträge des Monats, einzeln löschbar |

## Bedienung

- **Stand** – einmalig zum Start (oder zum Korrigieren): gearbeitete Stunden,
  geplante Stunden, Online-TG gesamt, Bar-TG gesamt.
- **Schicht** – nach jeder Schicht: Stunden (Schnellwahl 4–8 h), Bar-TG
  (+1/+2/+5/+10), optional den neuen Online-Gesamtstand aus der App.
  Die Stunden werden automatisch von den geplanten Stunden abgezogen.
- **Online-TG** – einfach den Gesamtstand aus der Flaschenpost-App eintragen;
  die Differenz wird automatisch berechnet.
- **Bar-TG** – Betrag dazuaddieren (negativ = Korrektur).
- **⚙** – Stundenlohn (Standard 14 €), optionale Abzüge in % (nur auf den Lohn),
  Export/Import als JSON, Monat leeren.

Nach jedem Speichern kann man über den Toast „Rückgängig“ klicken.

## Starten

- Lokal: `index.html` im Browser öffnen, oder `python3 -m http.server` im Ordner
  starten und `http://localhost:8000` aufrufen.
- Handy: über GitHub Pages veröffentlichen (Settings → Pages → „Deploy from a
  branch“ → `main` / `root`). Dann ist die App unter
  `https://lennarternst08-lang.github.io/Taschengeld-tracker-/` erreichbar. Im Browser
  „Zum Home-Bildschirm hinzufügen“.
- Google-Login funktioniert nur über `http(s)://`, nicht wenn `index.html` als Datei geöffnet wird.

## Datenmodell & spätere Automatisierung

Jeder Monat ist eine Liste von Einträgen mit **Deltas**; der Stand ist die Summe:

```json
{ "version": 1,
  "settings": { "wage": 14, "deductionPct": 0 },
  "months": { "2026-11": { "entries": [
    { "id": "…", "ts": "2026-11-27T09:40:00Z", "kind": "shift",
      "d": { "worked": 6, "planned": -6, "online": 8.6, "cash": 7 } }
  ] } } }
```

Für die Automatisierung muss ein lokales Skript nur einen **Snapshot** (Gesamtstand)
liefern (alternativ kann es mit Firebase direkt einen Eintrag per `arrayUnion` in
`tipTracker/{uid}/months/{YYYY-MM}` schreiben). Die App erzeugt daraus selbst den passenden Korrektur-Eintrag:

```json
{ "month": "2026-11", "worked": 38.5, "planned": 18, "online": 70 }
```

- per ⚙ → **Import** als Datei (einzeln oder als Array), oder
- im Browser per `window.TGTracker.applySnapshot({...})` (z. B. aus Playwright).

Die Rechenlogik steckt in `calc.js` und läuft auch in Node
(`require('./calc.js')`).

## Tests

```bash
node tests/calc.test.js
```

## Update veröffentlichen

Nach Änderungen die Versionsnummer `?v=…` in `index.html` (und in `sync.js` beim
Import von `firebase-config.js`) erhöhen, damit Handys nicht alte Dateien aus dem
Cache mischen.
