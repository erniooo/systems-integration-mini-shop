# Mini-Shop – Systems Integration, Lab 1

Ein lokaler Webshop mit JavaScript, Node.js, Express, SQLite und einer einfachen
HTML/CSS-Oberfläche. Die Anwendung enthält Beispielprodukte und benötigt keinen
separaten Datenbankserver.

## Starten

Voraussetzung: **Node.js 24 oder neuer**, inklusive npm.

Im Projektordner:

```bash
npm install
npm start
```

Dann **http://localhost:3000** öffnen. Der Server läuft ausschließlich auf dem
lokalen Rechner. Mit `Strg+C` beenden. Für die Entwicklung startet `npm run dev`
den Server bei Änderungen an den Serverdateien neu. Änderungen an HTML, CSS und
Browser-JavaScript werden nach Neuladen der Seite sichtbar.

Beim allerersten Start wird ein Verwaltungskonto angelegt:

- E-Mail: `admin@minishop.local`
- Passwort: wird zufällig erzeugt und **einmal im Terminal angezeigt**. Aufbewahren!

Alternativ kann das erste Passwort selbst festgelegt werden:

```bash
ADMIN_PASSWORD='DeinEigenesPasswort2026' npm start
```

`ADMIN_PASSWORD` legt nur ein noch nicht vorhandenes Verwaltungskonto an und
ändert kein bestehendes Passwort. Normale Kundenkonten entstehen über
**Anmelden → Neu hier? Konto erstellen**. Die Rolle kann nicht über die
Registrierung ausgewählt werden. Auch das Verwaltungskonto kann Testbestellungen
aufgeben.

## Was funktioniert?

- Produktübersicht mit Name, Beschreibung, Preis, Suche und Kategorien.
- Produkte hinzufügen, bearbeiten und entfernen, ausschließlich als Verwaltung.
- Kundenregistrierung, Anmeldung, Abmeldung und Bearbeitung von Name, E-Mail und Adresse.
- Warenkorb mit Mengenänderung und Entfernen von Positionen.
- Bestellen als angemeldeter Kunde mit gespeicherter Lieferadresse.
- Persönliche Kaufhistorie mit Positionen, Mengen, Gesamtbetrag und Bestellstatus.
- Verwaltung aller Bestellungen mit den Statuswerten `pending`, `shipped`, `completed`.
- Dauerhafte SQLite-Daten und Sitzungen, auch nach einem Neustart.

Es handelt sich um einen Übungs-Shop. Checkout erzeugt eine Bestellung; es gibt
keine Zahlungsabwicklung und keinen tatsächlichen Versand. Lagerbestände werden
in Lab 1 noch nicht geführt.

## Aufbau und Lesereihenfolge

```text
public/
  index.html          Grundgerüst und Anmeldedialog
  style.css           Darstellung, einschließlich Smartphone-Ansicht
  app.js              Browser: Ansichten, Formulare, Warenkorb und API-Aufrufe
src/
  server.js           Start, Konfiguration und erste Administrator-Anlage
  app.js              HTTP-API, Anmeldung, Rechte und Eingabeprüfung
  database.js         SQLite-Schema, Beispielprodukte und Sitzungsspeicher
  order-service.js    Bestelllogik und Datenbanktransaktion
  security.js         Passwort-Hashing und Validierungsfunktionen
test/
  shop.test.js        Integrationstests gegen einen echten HTTP-Server und SQLite
data/                 Automatisch erzeugte Daten, nicht für Git bestimmt
```

Empfohlene Lesereihenfolge: `server.js` → `database.js` → `app.js` im
Serverordner → `order-service.js` → `public/app.js`.

Die Oberfläche fragt die Express-API ab. Express prüft Eingaben und Rechte und
greift auf SQLite zu. Bestellungen werden über `LocalOrderService.placeOrder()`
angelegt. Dadurch ist der spätere Wechsel zur ERP-Anbindung an einer klaren
Stelle möglich.

## Datenmodell und Entscheidungen für die Besprechung

**Kunden (`customers`)** speichern Name, eindeutige E-Mail, Lieferadresse,
Passwort-Hash und Rolle. Passwörter werden mit einem individuellen Salt und
Node.js `scrypt` gehasht. Sie werden weder im Klartext gespeichert noch an den
Browser zurückgesendet.

**Produkte (`products`)** enthalten zusätzlich zur lokalen ID ein optionales,
eindeutiges `erp_id` für spätere Importe. Preise liegen als ganze Cent-Beträge
vor. „Entfernen“ deaktiviert das Produkt (`active = 0`); bestehende Bestellungen
behalten ihre Produktreferenz.

**Bestellungen (`orders`)** gehören zu einem Kunden und enthalten Gesamtbetrag,
Status, Bestellzeitpunkt sowie Name, E-Mail und Lieferadresse zum Zeitpunkt der
Bestellung. `integration_status = local` und `erp_order_id` sind Vorbereitung
für spätere Labs; ERP-Kommunikation ist noch nicht implementiert.

**Positionen (`order_items`)** speichern Menge, Produktreferenz sowie Produktname
und Einzelpreis zum Kaufzeitpunkt. Spätere Preis- oder Profiländerungen ändern
keine alten Bestellungen. Der Server liest beim Bestellen alle Preise selbst
aus der Datenbank. Er übernimmt keinen vom Browser berechneten Gesamtbetrag.
Bestellung und Positionen werden gemeinsam in einer Transaktion gespeichert.

**Sitzungen (`sessions`)** werden in SQLite gespeichert. Der Browser erhält nur
ein signiertes HttpOnly-Cookie. Ein CSRF-Token schützt schreibende API-Aufrufe.
Das Geheimnis zum Signieren der Cookies wird beim ersten Start in
`data/session-secret` erzeugt. SQL-Abfragen verwenden gebundene Parameter;
Produkt- und Kundentexte werden vor der HTML-Ausgabe maskiert.

SQLite ist für dieses lokale Praktikum einfach einzurichten. Die Anwendung
verwendet das mit Node.js 24 gelieferte Modul `node:sqlite`; je nach Node-Version
kann dafür ein Experimental-Hinweis erscheinen. Die synchronen Datenbankaufrufe
sind für den kleinen Übungs-Shop ausreichend.

## Wichtige API-Endpunkte

| Methode        | Pfad                    | Zugriff / Zweck                        |
| -------------- | ----------------------- | -------------------------------------- |
| GET            | `/api/session`          | Angemeldeter Benutzer und CSRF-Token   |
| POST           | `/api/register`         | Kundenkonto anlegen und anmelden       |
| POST           | `/api/login`            | Anmelden                               |
| POST           | `/api/logout`           | Abmelden                               |
| PATCH          | `/api/profile`          | Eigene Kundendaten ändern              |
| GET            | `/api/products`         | Aktive Produkte anzeigen               |
| POST           | `/api/products`         | Verwaltung: Produkt anlegen            |
| PATCH / DELETE | `/api/products/:id`     | Verwaltung: Produkt ändern / entfernen |
| GET            | `/api/orders`           | Eigene Bestellungen anzeigen           |
| POST           | `/api/orders`           | Bestellung anlegen                     |
| GET            | `/api/admin/orders`     | Verwaltung: alle Bestellungen          |
| PATCH          | `/api/admin/orders/:id` | Verwaltung: Bestellstatus ändern       |

Schreibende Aufrufe erwarten JSON, das Sitzungscookie und den Header
`X-CSRF-Token` mit dem Wert aus `/api/session`. Beispiel für den Inhalt einer
Bestellung:

```json
{ "items": [{ "productId": 1, "quantity": 2 }] }
```

Produkte anlegen/ändern: `name`, `description`, `category`, `price` senden.
`price` ist ein Text wie `"19,90"` oder `"19.90"`. Die API liefert Geldbeträge
als `price_cents`, `unit_price_cents` und `total_cents` zurück.

## Testen

```bash
npm test
```

Die Tests verwenden einen temporären Datenbankordner. Sie prüfen Registrierung,
Anmeldung, Rollen, CSRF, serverseitige Preisberechnung, ungültige Warenkörbe,
Transaktions-Rollback, private Kaufhistorien, historische Daten, Produktverwaltung,
Bestellstatus, Persistenz und Logout.

Zum Ausprobieren im Browser:

1. Neues Kundenkonto anlegen, zwei Produkte in den Warenkorb legen und Mengen ändern.
2. Bestellen und die Bestellung in „Bestellungen“ ansehen.
3. Unter „Mein Konto“ die Adresse ändern. Die alte Bestellung behält ihre Adresse.
4. Abmelden, mit dem Verwaltungskonto anmelden und einen Preis ändern.
5. Bestellstatus auf „Versendet“ setzen und ein Produkt entfernen.
6. Als Kunde wieder anmelden: Bestellung und damaliger Kaufpreis bleiben erhalten.

## Erweiterung in den nächsten Labs

- **Lab 2:** Dateiimport ergänzt Produkte anhand von `erp_id` oder aktualisiert sie.
  Das konkrete Dateiformat und die ERP-Felder werden am tatsächlichen Export geprüft.
- **Lab 3:** Einen ERP-Client ergänzen. Bestände live aus dem ERP lesen und
  `placeOrder()` an die ERP-Auftragserstellung anbinden. Lokale Bestellübersichten
  müssen dann die führenden ERP-Daten berücksichtigen.
- **Lab 4–6:** Je nach Kurs SAP Integration Suite oder Karavan/RabbitMQ anbinden.
  Bei asynchronem Versand `integration_status` z. B. um `submitting`, `confirmed`
  und `failed` erweitern. Anfragen und Antworten mit einer Korrelations-ID verbinden.
  Vor Wiederholungsversuchen klären, wie doppelte ERP-Bestellungen vermieden werden.

Aktuell sind nur die Funktionen für Lab 1 umgesetzt. Die Felder und die
Bestellservice-Grenze erleichtern spätere Erweiterungen.

## Lokale Konfiguration und Daten

- `PORT`: Standard `3000`; alternativ z. B. `PORT=3001 npm start`.
- `DB_PATH`: Optional ein anderer SQLite-Dateipfad.
- `SESSION_SECRET`: Optional ein eigenes Geheimnis statt der erzeugten Datei.
- `ADMIN_PASSWORD`: Passwort bei der erstmaligen Administrator-Anlage.

Kundendaten und Bestellungen liegen in `data/shop.sqlite`; den Warenkorb hält
der Browser in `localStorage`. Beim Abmelden wird der Warenkorb geleert.
Für einen sauberen Projekttransfer `node_modules/` und `data/` weglassen und am
Ziel `npm ci` ausführen. `package-lock.json` legt die installierten Versionen fest.
Die lokale HTTP-Konfiguration ist für das Praktikum auf dem eigenen Rechner
gedacht. Für eine öffentliche Bereitstellung wären unter anderem HTTPS und
angepasste Cookie- sowie Betriebsbedingungen erforderlich.
