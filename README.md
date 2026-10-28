# PokeBundels

Persoonlijke PWA om bulk Pokémon-kaarten (common/uncommon) te inventariseren, bundels voor te stellen, samen te stellen en verkopen bij te houden.

## Online zetten via GitHub Pages

1. Maak op GitHub een nieuwe repository, bv. `pokebundels`.
2. Upload alle bestanden uit deze map naar de root van de repository (inclusief de mappen `js` en `icons`).
3. Ga naar **Settings → Pages**, kies bij *Source* **Deploy from a branch**, branch `main`, map `/ (root)` en klik **Save**.
4. Na een minuutje staat de app op `https://<jouw-gebruikersnaam>.github.io/pokebundels/`.
5. Open die link op je gsm en kies **Toevoegen aan beginscherm** om de app te installeren.

Updates: overschrijf de bestanden in de repository. Verhoog dan ook `VERSION` in `sw.js`, zodat je toestel de nieuwe versie ophaalt.

## Werkwijze

1. **Inventaris → Set toevoegen.** De app haalt de kaartenlijst op bij TCGdex (Engelse kaarten). Dat gebeurt één keer per set en wordt lokaal bewaard.
2. **Kaarten toevoegen**
   - Met de knoppen − / + of door op een kaart te tikken, of
   - via Claude: tik in een set op **Prompt voor Claude**, plak die prompt in een chat met Claude samen met je foto's, en plak de JSON die je terugkrijgt bij **Importeren**. Pas daarna de aantallen aan.
3. **Analyse**: drie tabbladen (geen dubbels, max. 2×, max. 5×). Volgorde: eerst thema's (Eevee, Pika-familie, starters), dan setbundels, de rest gaat naar random. Kies **Gebruik dit plan**.
4. **Bundels**: tik **Maak** voor een pakbon met exact welke kaarten erin moeten, plus hoeveel holo/reverse je uit je map neemt. Na **Bundel gemaakt** gaan de kaarten uit de voorraad. Met **Terug** gaan ze er weer in.
5. **Verkoop**: selecteer gemaakte bundels, registreer platform en bedrag. De app houdt per platform de DAC7-teller bij (30 verkopen of €2.000 per jaar). Bij een verkoop vanaf €25 krijg je een herinnering voor de extra blinkende kaart per bundel.

## Importformaat

```json
{
  "app": "PokeBundels",
  "mode": "add",
  "cards": [
    { "setId": "sv08", "localId": "012", "name": "Pikachu", "count": 1 }
  ]
}
```

- `setId`: TCGdex set-ID (bv. `sv08` Surging Sparks, `sv03.5` 151, `sv08.5` Prismatic Evolutions, `sv10` Destined Rivals).
- `localId`: kaartnummer zonder `/totaal`. Voorloopnullen maken niet uit.
- `mode`: `add` telt op bij je voorraad, `set` vervangt het aantal.

## Gegevens

Alles (voorraad, bundels, verkopen) staat enkel in je browser op dit toestel (IndexedDB). Maak geregeld een back-up via **Instellingen → Back-up downloaden**. Kaartgegevens en afbeeldingen komen van [TCGdex](https://tcgdex.dev).
