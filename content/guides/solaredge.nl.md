# SolarEdge koppelen (optioneel)

Met SolarEdge gekoppeld weet WattsWise hoeveel je zonnepanelen opwekken. Het laat dan ook zien wat je panelen opleveren (zelf gebruikt, opgeslagen, teruggeleverd) en stemt de zonnevoorspelling af op je eigen dak. Zonder SolarEdge werkt WattsWise ook: de besparing van de batterijen komt van de Pulse, de voorspelling van het weer.

SolarEdge heeft nog geen simpele "inloggen" voor apps zoals WattsWise. Je maakt één keer je eigen kleine, gratis **app** aan op de developer-site van SolarEdge, en logt daarmee in. Het kost ongeveer tien minuten.

## 1. Maak een developer-account

1. Ga naar [developer.solaredge.com](https://developer.solaredge.com) en maak een account. Je kunt hetzelfde e-mailadres gebruiken als voor je SolarEdge-monitoring.
2. Kies het **Free**-abonnement. Dat geeft 2.000 verzoeken per maand. WattsWise gebruikt er hooguit 64 per dag en blijft er dus altijd binnen.

## 2. Maak een Site Access-applicatie

1. Maak in de developer-console een nieuwe applicatie van het type **Site Access** (OAuth).
2. Geef hem een naam, bijvoorbeeld "WattsWise".
3. Plak als **redirect URI** het adres dat WattsWise toont onder *Instellingen → Koppelingen → SolarEdge* ("Redirect-URI om te registreren…"). Het eindigt op `/api/integrations/solaredge/callback`. Het moet precies gelijk zijn.
4. Kies de rechten voor **sitegegevens** en **apparaatgegevens** (`SITE_DATA`, `DEVICE_DATA`) als daarom wordt gevraagd.
5. Sla op. Je ziet nu een **client ID** en een **client secret**.

> Screenshot: een nieuwe Site Access-applicatie met de redirect URI ingevuld.

## 3. Koppel hem in WattsWise

1. Open in WattsWise de stap **SolarEdge** (of *Instellingen → Koppelingen → SolarEdge*).
2. Plak de client ID en de client secret en tik op **Opslaan en testen**.
3. Tik op **Inloggen bij SolarEdge**. Je gaat naar SolarEdge, logt in met je **monitoring**-account (waarmee je je panelen ziet) en geeft toegang tot je installatie.
4. Je komt terug in WattsWise. De kaart toont je installatie en het aantal verzoeken van vandaag.

## Lukt het niet?

- **"redirect_uri mismatch":** de redirect URI in je SolarEdge-app is niet precies die van WattsWise. Kopieer hem opnieuw, zonder spaties.
- **"Geen toegang" na het inloggen:** je hebt ingelogd met een account dat de installatie niet ziet. Gebruik het account van de eigenaar, of vraag je installateur om toegang.
- **"Maandtegoed op":** WattsWise stopt met lezen tot de nieuwe maand begint en meldt dat op de kaart. Er gaat niets kapot.
- Je kunt de toegang van WattsWise altijd intrekken in de accountinstellingen van SolarEdge, of de app verwijderen op de developer-site.
