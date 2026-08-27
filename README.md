# CVR-kontrol

Batch-kontrol af danske virksomheder: CVR-status og momsregistrering, med dokumentation
pr. virksomhed, resultat-Excel og auditlog.

## Den vigtigste arkitekturbeslutning

Oplægget bad om browserautomation mod `datacvr.virk.dk` og `ntse.skat.dk` med et screenshot
som dokumentation. Det er ikke bygget sådan, og grunden er værd at forstå før du kører videre:

| | Scraping + screenshot | Denne løsning |
|---|---|---|
| CVR-data | HTML-parsing af datacvr.virk.dk | Officiel system-til-system-adgang (Erhvervsstyrelsen) eller cvrapi.dk |
| Momsdata | Formularudfyldelse på ntse.skat.dk | VIES REST-API med **consultation number** |
| Bevisværdi | Et billede, som alle kan lave i Photoshop | Kvitteringsnummer fra EU-Kommissionen + SHA-256 af det rå svar |
| 250 virksomheder | 20-40 min, skrøbeligt | under et minut |
| Vilkår | Automatiseret høstning strider mod Virks brugerbetingelser; Erhvervsstyrelsen kan blokere adgang uden varsel | Officielle kanaler |

Browserautomation er stadig med — men kun til to ting: at printe dokumentationen til PDF,
og som **valgfri** kilde mod `ntse.skat.dk` (se `src/providers/vat.skat.js`).

**Én reel begrænsning ved VIES:** VIES viser registrering til EU-handel. For danske selskaber
falder det i praksis sammen med momsregistrering, men det er ikke definitorisk det samme.
Derfor: brug `vies` som primær kilde, og efterprøv de få `NOT_REGISTERED`/`UNKNOWN`-svar i
`ntse.skat.dk` — enten manuelt eller ved at køre de rækker igen med `VAT_PROVIDER=skat`.
Det holder trafikken mod SKAT på nogle få procent af batchen.

## Kom i gang

### GitHub Codespaces (nemmest)

Læg repoet på GitHub som **privat** repo. Klik derefter `Code` → `Codespaces` →
`Create codespace`. Alt installeres automatisk, inklusive Chromium. Kør så:

```bash
npm start
```

Åbn fanen **Ports** og klik på port 3000. URL'en er privat for din konto, med mindre
du selv gør porten offentlig — **det skal du ikke**, se afsnittet om sikkerhed.

En codespace stopper efter 30 minutters inaktivitet, men filerne overlever. Databasen i
`data/` og dokumentationen i `output/` bliver liggende indtil du sletter codespacet —
hent derfor ZIP'en ned, når en batch er færdig.

### Lokalt

Kræver **Node 24 eller nyere** (`node -v`). Databasen bruger Nodes indbyggede
`node:sqlite`, så der kompileres intet nativt — ingen Visual Studio, ingen node-gyp.

```bash
npm install
npx playwright install chromium
copy .env.example .env        # på macOS/Linux: cp
npm start                     # http://localhost:3000
```

Kører du Node 22, skal SQLite-modulet slås til med et flag:
`node --experimental-sqlite src/server.js`

Uden konfiguration kører appen på `mock`-kilder, så hele flowet kan afprøves uden
eksterne kald. Sæt `PDF_ENABLED=false` for at teste helt uden Chromium — så skrives
dokumentationen som `.html` i stedet for `.pdf`.

## Datakilder

**CVR** (`CVR_PROVIDER`)

- `virk` — Erhvervsstyrelsens system-til-system-adgang. Gratis. Skriv til
  `cvrselvbetjening@erst.dk`; der er sagsbehandlingstid, og du skal underskrive en erklæring
  om reklamebeskyttede enheder. Elasticsearch-interface med basic auth. **Dette er den kilde
  du skal ende på i produktion.**
- `cvrapi` — cvrapi.dk. Ingen nøgle, men kræver en identificerende `User-Agent`. Tjek deres
  vilkår før kommerciel brug. God til at komme i gang mens Virk-adgangen behandles.
- `mock` — deterministisk testdata.

**Moms** (`VAT_PROVIDER`)

- `vies` — EU-Kommissionens REST-endpoint. Ingen nøgle. Udfyld `VIES_REQUESTER_VAT` med dit
  eget momsnummer: så returnerer VIES et `requestIdentifier` (consultation number), som er den
  kvittering revisor eller SKAT kan verificere. Uden det får du kun et ja/nej.
- `skat` — Playwright mod ntse.skat.dk. **Selectorne er ikke verificeret** — se nedenfor.
- `mock` — deterministisk testdata.

## Selectors der skal verificeres

Alt hvad der rører Skattestyrelsens HTML ligger i ét objekt: `SELECTORS` i
`src/providers/vat.skat.js`. Første gang du sætter `VAT_PROVIDER=skat`, skal du bekræfte
de fire kæder (`cookieAccept`, `input`, `submit`, `result`). Hver kæde prøves i rækkefølge,
så en enkelt ændring på siden vælter ikke kørslen.

Bemærk: `execution=e1s1` i URL'en er en Spring Webflow-sessionsparameter. Den er **ikke**
hardcodet nogen steder. Automationen starter altid på indgangs-URL'en og bruger den session
serveren selv tildeler.

Løsningen forsøger ikke at omgå CAPTCHA, adgangskontrol eller rate limits. Møder den en
spærring, fejler den rækken med en tydelig besked i stedet for at arbejde udenom.

## Sådan holdes dokumentation adskilt pr. CVR

Fire lag, ikke ét:

1. CVR er primærnøgle fra import til ZIP. Intet opslag sker uden et normaliseret, mod-11-valideret nummer.
2. Hver virksomhed får sin egen mappe, `output/<batch>/<cvr>_<navn>/`.
3. CVR-nummeret står inde i dokumentet — i sidehoved, i tabellen og i sidefoden på hver side.
4. Dokumentet indeholder en SHA-256 af kildens rå svar. Det binder papiret til det, kilden
   faktisk sagde, og gør ombytning opdagelig i stedet for kun usandsynlig.

## Fejl, retry og genoptagelse

En fejl på ét CVR stopper aldrig batchen. Midlertidige fejl (timeout, 429, 5xx,
`MS_UNAVAILABLE` fra VIES) forsøges op til `MAX_RETRIES` gange med exponential backoff og
jitter. Permanente fejl (401, 403, ukendt CVR) forsøges ikke igen.

Al status ligger i SQLite. Lukker du browseren, genstarter serveren eller trykker du pause,
tager **Start kontrol** fat hvor den slap — færdige rækker slås ikke op igen. **Prøv fejlede
igen** nulstiller kun rækker i tilstanden `failed`.

## Projektstruktur

```
src/
  server.js              Express, statiske filer, nedlukning
  config.js              .env -> ét konfigurationsobjekt
  db.js                  SQLite-skema + auditlog
  providers/
    index.js             registry: vælger kilde ud fra .env
    http.js              fetch med timeout, hash, retryable/permanent fejl
    status-map.js        officiel statustekst -> aktiv/inaktiv
    cvr.virk.js          Erhvervsstyrelsen (system-til-system)
    cvr.cvrapi.js        cvrapi.dk
    cvr.mock.js
    vat.vies.js          VIES + consultation number
    vat.skat.js          Playwright mod ntse.skat.dk  <- selectors her
    vat.mock.js
  services/
    normalize.js         CVR-normalisering, mod-11, filnavne
    importer.js          xlsx/csv-læsning, kolonnegenkendelse, dubletter
    queue.js             kø, concurrency, retry, persistens
    browser.js           delt Chromium-instans
    pdf.js               print-to-PDF + stivalidering
    export.js            resultat-Excel og auditlog-Excel
    (ZIP streames direkte i routes/downloads.js med archiver)
  templates/evidence.js  dokumentationssidens HTML
  routes/                upload.js, batches.js, downloads.js
public/                  index.html, app.js, styles.css
data/                    SQLite
output/                  genereret dokumentation
```

## Sikkerhed

**Appen har ikke login.** Alle der kan nå URL'en kan uploade filer og køre opslag under
dit VIES-momsnummer. Gør derfor aldrig porten offentlig i Codespaces, og deploy den ikke
til en åben adresse uden først at sætte adgangskontrol foran.

`.env` er i `.gitignore`. Tjek `git status` før dit første push — Virk-password og dit
momsnummer må ikke i repoet.

Kun `.xlsx`, `.xls` og `.csv` accepteres, med størrelsesgrænse (`MAX_UPLOAD_MB`). Filer
holdes i hukommelsen og skrives aldrig med brugerens eget filnavn. Alle stinavne bygges af
CVR-nummeret plus et saniteret virksomhedsnavn, og hver skrivning og læsning valideres til
at ligge inde i `output/` (`assertInsideOutput`). Kolonnenavne fra Excel bruges kun som
opslagsnøgler, aldrig som stier.

## Hvad det her ikke svarer på

Aktiv i CVR og momsregistreret betyder ikke, at en underleverandør er i orden. Det siger
intet om transporttilladelse, RUT-anmeldelse, restancer, reelle ejere eller om selskabet er
lukket i sidste uge. Kontrollen er et øjebliksbillede: kør den igen med jævne mellemrum,
ikke kun ved kontraktindgåelse. Det er derfor batch-ID og auditlog er persistente — så du kan
dokumentere *hvornår* du kontrollerede, ikke kun *at* du gjorde det.
