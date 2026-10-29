# Tibber koppelen

WattsWise haalt de stroomprijzen per kwartier en de live meterstanden van je **Tibber Pulse** op bij Tibber. Je hebt twee dingen nodig: een stroomcontract bij Tibber en een Pulse die actief is. Het kost ongeveer twee minuten.

## 1. Controleer of je Pulse actief is

Open de Tibber-app. Op het startscherm zie je je **live verbruik** om de paar seconden veranderen. Zie je dat, dan werkt de Pulse.

> Screenshot: het startscherm van de Tibber-app met het live verbruik.

Geen live verbruik? Dan is de Pulse nog niet gekoppeld. Volg de stappen van Tibber in de app (*Power-ups → Pulse*). WattsWise heeft de Pulse nodig: zonder kunnen we zonnestroom en netstroom niet uit elkaar houden, en dus niet uitrekenen wat je batterijen besparen.

## 2. Maak een persoonlijke toegangscode (access token)

1. Ga naar [developer.tibber.com](https://developer.tibber.com) en tik op **Sign in**. Gebruik hetzelfde e-mailadres en wachtwoord als in de Tibber-app.
2. Open **Access token** (onder je naam rechtsboven).
3. Tik op **Create token** (of *Generate token*), geef hem een naam als "WattsWise" en kopieer hem.

> Screenshot: de access-token-pagina op developer.tibber.com.

De code is een lange reeks letters en cijfers. Behandel hem als een wachtwoord: hij geeft leestoegang tot je Tibber-gegevens.

## 3. Plak hem in WattsWise

1. Open in WattsWise de stap **Tibber** (of *Instellingen → Koppelingen → Tibber*).
2. Plak de code en tik op **Opslaan en testen**.
3. Heb je meer dan één adres bij Tibber? Kies het juiste.

WattsWise controleert de code, vindt je adres en start de Pulse. Binnen een minuut zie je je live verbruik op het startscherm.

## Lukt het niet?

- **"Unauthorized" of "invalid token":** de code is niet helemaal gekopieerd, of verwijderd op developer.tibber.com. Maak een nieuwe.
- **"Geen Pulse":** de Pulse is nog niet actief op dit adres (stap 1).
- WattsWise **leest** alleen bij Tibber. Het verandert nooit je contract of je instellingen bij Tibber. Je kunt de code altijd verwijderen op developer.tibber.com; WattsWise stopt dan met lezen.
