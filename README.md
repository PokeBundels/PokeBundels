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

1. **Inventaris**: per era en set je gewone kaarten (common/uncommon). Kaarten toevoegen met − / +, of via **Prompt voor Claude** (foto's) en **Importeren**. Kaarten die geen common/uncommon zijn, vraagt de app eerst te bevestigen.
2. **Instellingen → Tins en Bundels**: per soort het aantal gewone kaarten, holo/reverse en energy, extra's, prijs, bron (willekeurige sets, per set of één set), een optioneel thema (bv. Eevee's) en de tekst van het zoekertje. Standaard alleen-lezen: tik **Bewerken** en daarna **Opslaan**.
3. **Analyse**: **Analyse starten** vraagt hoeveel tins je hebt. Eerst thema-tins, dan andere tins, dan bundels. Overzicht met opbrengst, en per tin en bundel het aantal.
4. **Voorbereiding**: **Maak** geeft een pakbon met exact welke kaarten erin moeten, plus wat je erbij legt (holo/reverse, energy, extra's) en de inhoud van het zoekertje. Na **Gemaakt** gaan de kaarten uit de voorraad.
5. **Te verkopen**: statussen Online (titel en tekst om te kopiëren), Verzonden, Ontvangen en Geld op rekening. Meerdere aanvinken = één verkoop.
6. **Verkocht**: alle verkopen met per platform de DAC7-teller (30 verkopen of €2.000 per jaar).

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
