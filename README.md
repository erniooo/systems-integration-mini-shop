# Mini-Shop – Systems Integration, Labs 1 und 2

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
- ERP-Produkte aus Excel- oder CSV-Dateien importieren und aktualisieren.
- Den zuletzt importierten Bestand auf Produktkarten und im Warenkorb anzeigen.

Es handelt sich um einen Übungs-Shop. Checkout erzeugt eine Bestellung; es gibt
keine Zahlungsabwicklung und keinen tatsächlichen Versand. Die Bestände von
ERP-Produkten entsprechen dem letzten Dateiimport und sind nicht live.

## Lab 2: Produkte aus dem Mini-ERP übernehmen

1. Das vorhandene Mini-ERP starten und im Browser unter
   `http://localhost:4004/products/webapp/index.html` die Produktliste öffnen.
   Für das lokale ERP ist `alice` / `alice` das Übungskonto.
2. In der Produkttabelle auf das Excel-Symbol **Exportieren** klicken. Darauf
   achten, dass die Spalten **Product ID**, **Product Name**, **Beschreibung**,
   **Price** und **Stock** ausgewählt sind. Der Export lädt eine `.xlsx`-Datei
   herunter; ein aktiver Tabellenfilter kann den Export einschränken.
3. Den Shop starten, als Verwaltung anmelden und **Verwaltung → Produkte aus
   dem ERP importieren** öffnen. Die Excel-Datei auswählen und importieren.
4. Den Importbericht prüfen und die Produktübersicht öffnen. Bei Änderungen im
   ERP die Datei erneut exportieren und importieren.

Alternativ unterstützt der Shop die CSV-Datei aus der ERP-Schnittstelle
`/rest/api/getProducts`. Zum Beispiel kann sie lokal mit den im Mini-ERP
vorkonfigurierten Zugangsdaten so gespeichert werden:

```bash
curl -u service-user:service-user http://localhost:4004/rest/api/getProducts -o products.csv
```

Der Dateiaustausch erfolgt manuell bei Bedarf. Sinnvoll sind aussagekräftige
Dateinamen wie `products-2026-11-02.xlsx` und ein gemeinsamer, leicht auffindbarer
Ordner, beispielsweise Downloads. Es gibt keinen automatischen Zeitplan.

Der Shop akzeptiert `.xlsx` und UTF-8-`.csv` bis 2 MB und maximal 10.000
Produktzeilen. Die Spaltennamen des ERP-Exports werden erkannt. Ein Produkt
wird anhand der **Product ID** (`productID`) zugeordnet. Beim ersten Import wird
es angelegt, bei weiteren Importen werden Name, Beschreibung, Preis und Bestand
aktualisiert. Bereits vorhandene Kategorien bleiben erhalten; neue Produkte
erhalten die Kategorie `Sonstiges`. Ein zuvor im Shop entferntes ERP-Produkt
wird bei erneutem Import wieder sichtbar. Produkte, die in einer Datei fehlen,
werden nicht entfernt, da ein Export auch gefiltert sein kann.

Die CSV-Schnittstelle gibt z. B. `1200.00 EUR` als Preis aus. Der Shop führt
Preise in Euro; andere ausdrücklich angegebene Währungen werden abgelehnt. Beim
Excel-Export fehlt in der Standardansicht eine separate Währungsspalte. Für diese
Dateien wird daher EUR angenommen. Leere Beschreibungen sind zulässig, weil sie
auch im ERP vorkommen. Fehlende Pflichtspalten, doppelte Produkt-IDs, ungültige
Preise oder Bestände und beschädigte Dateien führen zu einer Fehlermeldung. Es
wird dann **keine Zeile** der Datei übernommen.

Die in `erp_id` gespeicherte Produkt-ID (`productID`) ist die lesbare Kennung aus
dem Datei-Export. Das ERP hat zusätzlich eine interne UUID (`ID`), die für die
direkte Auftragsanbindung in Lab 3 relevant ist. Diese UUID muss dann über das
ERP zur Produkt-ID ermittelt werden; sie ist im Standardexport nicht enthalten.

Die CSV-Funktion des bereitgestellten ERP setzt Felder direkt mit Kommas
zusammen. Enthält ein nicht maskiertes Feld selbst ein Komma, kann diese Ausgabe
mehrdeutig oder ungültig sein; der Import lehnt solche fehlerhaften Zeilen ab.
In diesem Fall den Excel-Export verwenden.

Der importierte Bestand ist eine **Momentaufnahme**, keine Live-Abfrage: Der
Shop lehnt zwar eine Bestellung ab, deren Menge den letzten importierten
Bestand überschreitet, reserviert oder reduziert aber keinen Bestand im ERP.
Auch mehrere aufeinanderfolgende Bestellungen ändern die Momentaufnahme nicht.
Erst in Lab 3 wird der Bestand live beim ERP abgefragt. Die lokale ERP-Datenbank
ist standardmäßig im Arbeitsspeicher; Produktänderungen im ERP gehen beim
Neustart verloren.

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
  product-import.js   Excel-/CSV-Datei lesen, prüfen und Produkte abgleichen
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
behalten ihre Produktreferenz. `stock` und `stock_imported_at` speichern die
letzte importierte Bestandsaufnahme. Für manuell angelegte Produkte ist der
Bestand unbekannt (`NULL`). Beim ersten Start nach dem Update ergänzt eine kleine
Migration die Felder in einer bestehenden Lab-1-Datenbank.

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

| Methode        | Pfad                         | Zugriff / Zweck                          |
| -------------- | ---------------------------- | ---------------------------------------- |
| GET            | `/api/session`               | Angemeldeter Benutzer und CSRF-Token     |
| POST           | `/api/register`              | Kundenkonto anlegen und anmelden         |
| POST           | `/api/login`                 | Anmelden                                 |
| POST           | `/api/logout`                | Abmelden                                 |
| PATCH          | `/api/profile`               | Eigene Kundendaten ändern                |
| GET            | `/api/products`              | Aktive Produkte anzeigen                 |
| POST           | `/api/products`              | Verwaltung: Produkt anlegen              |
| PATCH / DELETE | `/api/products/:id`          | Verwaltung: Produkt ändern / entfernen   |
| GET            | `/api/orders`                | Eigene Bestellungen anzeigen             |
| POST           | `/api/orders`                | Bestellung anlegen                       |
| GET            | `/api/admin/orders`          | Verwaltung: alle Bestellungen            |
| PATCH          | `/api/admin/orders/:id`      | Verwaltung: Bestellstatus ändern         |
| POST           | `/api/admin/import/products` | Verwaltung: Excel-/CSV-Datei importieren |

Schreibende Aufrufe erwarten das Sitzungscookie und den Header `X-CSRF-Token`
mit dem Wert aus `/api/session`. Sie verwenden JSON; der Dateiimport verwendet
`multipart/form-data` mit einem Dateifeld namens `file`. Beispiel für den Inhalt
einer Bestellung:

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
Bestellstatus, Persistenz und Logout. Für Lab 2 prüfen sie den echten SAP-Excel-
und ERP-CSV-Export, wiederholten Import, geänderte Preise und Bestände,
fehlerhafte Dateien, Zugriffsrechte und die Migration einer Lab-1-Datenbank.

Zum Ausprobieren im Browser:

1. Neues Kundenkonto anlegen, zwei Produkte in den Warenkorb legen und Mengen ändern.
2. Bestellen und die Bestellung in „Bestellungen“ ansehen.
3. Unter „Mein Konto“ die Adresse ändern. Die alte Bestellung behält ihre Adresse.
4. Abmelden, mit dem Verwaltungskonto anmelden und einen Preis ändern.
5. Bestellstatus auf „Versendet“ setzen und ein Produkt entfernen.
6. Als Kunde wieder anmelden: Bestellung und damaliger Kaufpreis bleiben erhalten.

## Erweiterung in den nächsten Labs

- **Lab 2:** Dateiimport ergänzt und aktualisiert Produkte anhand der ERP-Produkt-ID.
- **Lab 3:** Einen ERP-Client ergänzen. Bestände live aus dem ERP lesen und
  `placeOrder()` an die ERP-Auftragserstellung anbinden. Lokale Bestellübersichten
  müssen dann die führenden ERP-Daten berücksichtigen.
- **Lab 4–6:** Je nach Kurs SAP Integration Suite oder Karavan/RabbitMQ anbinden.
  Bei asynchronem Versand `integration_status` z. B. um `submitting`, `confirmed`
  und `failed` erweitern. Anfragen und Antworten mit einer Korrelations-ID verbinden.
  Vor Wiederholungsversuchen klären, wie doppelte ERP-Bestellungen vermieden werden.

Labs 1 und 2 sind umgesetzt. Die Bestellservice-Grenze erleichtert spätere
Erweiterungen.

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
