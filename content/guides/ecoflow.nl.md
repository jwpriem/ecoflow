# Je EcoFlow STREAM koppelen

WattsWise leest het laadniveau, het batterijvermogen en het zonnevermogen van je STREAM-batterijen via de officiële developer-API van EcoFlow. Laat je WattsWise sturen, dan zet het ook wanneer de batterijen laden en ontladen. Daarvoor maak je een **access key** en een **secret key** aan op de developer-site van EcoFlow.

**Reken op wat tijd:** EcoFlow keurt nieuwe developer-accounts met de hand goed. Dat duurt meestal **een paar dagen**. Je kunt intussen Tibber al koppelen.

## Welke batterijen werken

STREAM Ultra, Ultra X, Pro, AC Pro, AC en Max. Meerdere units in één systeem kan ook. De STREAM 5000 en STREAM AC 5000 zijn nog niet beschikbaar via de API van EcoFlow.

## 1. Vraag een developer-account aan

1. Ga naar [developer-eu.ecoflow.com](https://developer-eu.ecoflow.com) en log in met je account van de **EcoFlow-app** (hetzelfde e-mailadres en wachtwoord).
2. Kies **Become a developer** en vul het formulier in. Als doel kun je schrijven: *"Using my own STREAM batteries with WattsWise, a home energy app."* Je hebt geen bedrijf nodig.
3. Wacht op de e-mail van EcoFlow dat je account is goedgekeurd.

> Screenshot: het aanvraagformulier op developer-eu.ecoflow.com.

## 2. Maak de sleutels aan

1. Log na de goedkeuring opnieuw in op [developer-eu.ecoflow.com](https://developer-eu.ecoflow.com).
2. Open **Security** (in sommige versies onder *Personal centre*).
3. Tik op **Create** voor een **Access Key** en een **Secret Key**. Kopieer ze allebei meteen: de secret key wordt misschien maar één keer getoond.

> Screenshot: de Security-pagina met de access key en secret key.

## 3. Plak ze in WattsWise

1. Open in WattsWise de stap **EcoFlow** (of *Instellingen → Koppelingen → EcoFlow-ontwikkelaars-API*).
2. Plak de access key en de secret key en tik op **Opslaan en testen**.
3. WattsWise toont elke STREAM-unit op je EcoFlow-account, met capaciteit en vermogen al ingevuld. Kijk ze na; je kunt ze later aanpassen in Instellingen.

## Wat WattsWise met de sleutels doet

De sleutels worden versleuteld bewaard en alleen gebruikt om voor jouw huishouden met EcoFlow te praten. WattsWise begint met **alleen meekijken**: het leest, het stuurt niet. Pas als je kiest om WattsWise te laten sturen en daar akkoord mee gaat, stuurt het instellingen naar je batterijen. Je kunt de sleutels altijd verwijderen op de developer-site van EcoFlow; WattsWise stopt dan.

## Lukt het niet?

- **"accessKey is invalid" of "geen apparaten":** soms moet EcoFlow eerst API-toegang voor je apparaat aanzetten. Mail de developer-support van EcoFlow via de developer-site en noem het serienummer van je STREAM.
- **Nog geen goedkeuring?** Dan is het wachten. Kijk ook in je spammap voor de e-mail van EcoFlow.
- **Mist er een unit?** Controleer in de EcoFlow-app dat hij op hetzelfde account staat en tik opnieuw op *Opslaan en testen*.
