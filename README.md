# Garagee

AI asistent a riadiaci systém pre autoservisy **osobných áut (M1) a úžitkových vozidiel do 3,5 t (N1)** – aplikácia pre ChatGPT (MCP / Apps SDK) + webové stránky pre vodičov a tablet pre mechanikov. Ťažšie vozidlá, motocykle a autobusy aplikácia neprijme.
Prevádzkovateľ: **housee s.r.o.**

## Čo Garagee robí
| Oblasť | Funkcia | Chyba konkurencie, ktorú rieši |
|---|---|---|
| Vstupná prehliadka | technik prijme auto písaním alebo hlasom (tablet: diktovanie v jazyku servisu; ChatGPT: hlasový režim); Garagee rozpozná EČV, VIN, km, palivo, druh vozidla, hmotnosť, zákazníka, závadu, poškodenia a pýta sa len na chýbajúce údaje; známe auto doplní z databázy; po dokončení vznikne zákazka v poradí na plánovanie | – |
| Rozsah 3,5 t | len M1 a N1 do 3 500 kg; nosnosť zdvihákov – dodávka nejde na slabší zdvihák; pravidlá STK pre N1 (kde nie sú nastavené, použije sa M1 a označí sa na overenie) | – |
| Vozidlá | karta auta, kontrola VIN (I/O/Q, dĺžka, kontrolná číslica – v EÚ len varovanie), história, nájazd | – |
| Kontroly | STK/EK, HU, MOT, ITV, APK, §57a… podľa krajiny; pravidlá s dátumom platnosti (napr. AT od 19. 5. 2027) | americké systémy nepoznajú európske lehoty |
| Údržba | intervaly podľa času aj km, odhad nájazdu z histórie, EV bez výmeny oleja | – |
| Odhady | zdroj každého čísla, prekrývanie úkonov, učenie z reálnych časov servisu | „normohodiny mimo o 70 %“ (Tekmetric) |
| Plánovanie | zdviháky + mechanici so zručnosťami, **viac mechanikov na úkon**, otváracie hodiny, dovolenky, dodanie dielov, auto cez noc na zdviháku | „nejde priradiť viac mechanikov“ |
| Digitálna prehliadka | zelená/oranžová/červená, merania, fotky, schválenie zákazníkom cez odkaz, **odmietnuté práce sa pripomenú** | – |
| Diely | porovnanie dodávateľov paralelne, výpadok dodávateľa neblokuje, **záložná objednávka e-mailom** | „integrácia dielov mala stále problémy“ |
| Offline | tablet zapisuje bez internetu, synchronizácia bez duplicít | „bez internetu dielňa stojí“ |
| Rezervácie | verejný odkaz pre vodičov v 10 jazykoch | „chýba rezervačný odkaz“ |
| GDPR | servis = prevádzkovateľ, housee = sprostredkovateľ; export, anonymizácia **bez straty faktúr**, prevod auta bez údajov starého majiteľa, retenčná lehota | „zmazanie auta zmazalo faktúry“ |
| Férové podmienky | mesačná výpoveď, export dát kedykoľvek | „skrytá 30-dňová výpovedná lehota“ |

## Krajiny
Tier 1: SK, CZ, DE, AT, PL · Tier 2: HU, FR, IT, ES, NL, BE, GB · Tier 3 (regionálne pravidlá nastaví servis): US, CA, AU · ostatné: všeobecné nastavenia.
Hodnoty s `verified` majú zdroj a dátum overenia; `verified: false` treba pred spustením potvrdiť s miestnym právnikom/účtovníkom. Servis môže každú hodnotu prepísať.

Jazyky zákazníckych stránok: en, sk, cs, de, pl, hu, fr, it, es, nl. ChatGPT odpovedá v jazyku používateľa.

## Spustenie
```bash
npm install
npm test                       # 32 testov: jadro, vstupná prehliadka, OAuth, MCP, reštart servera
DEMO_SEED=1 npm start          # http://localhost:3000, demo: demo@garagee.test / demo-password-123
npm run annotations            # vygeneruje docs/TOOL_ANNOTATIONS.md
```
Pripojenie v ChatGPT (Developer Mode): Settings → Apps → Create → URL `https://<doména>/mcp`, autentifikácia OAuth.

## Nasadenie (Fly.io, EÚ)
```bash
fly launch --no-deploy --copy-config
fly volumes create caree_data --region fra --size 1
fly secrets set COMPANY_ADDRESS="..." COMPANY_ID="..." SUPPORT_EMAIL="..." PRIVACY_EMAIL="..." DEMO_SEED=1 DEMO_EMAIL="..." DEMO_PASSWORD="..."
fly deploy
```
Doména v `fly.toml` (`PUBLIC_URL`) je návrh – zmeňte podľa skutočnej domény a nastavte DNS.

## Architektúra
```
src/config/   countries.js (trhy, kontroly, DPH, meny), i18n.js
src/core/     vin.js, inspection.js, estimator.js, scheduler.js, suppliers.js   (čistá logika, testovaná)
src/services.js  biznis operácie, izolácia servisov (tenant_id), GDPR
src/auth.js      OAuth 2.1 (PKCE, dynamická registrácia) nad MCP SDK
src/mcp.js       28 nástrojov pre ChatGPT s anotáciami
src/core/intake.js  vstupná prehliadka: polia, rozpoznávanie diktátu, kontrola úplnosti
src/web/         widget (MCP Apps UI), rezervácie, schvaľovanie, tablet PWA, právne stránky
```
Úložisko: SQLite zabudované v Node (súbor na volume). Pre viac serverov neskôr PostgreSQL – SQL je v `services.js` a `db.js`.

## Čo ešte treba doplniť pred ostrou prevádzkou
1. Licencované dáta (normohodiny, dekódovanie VIN, servisné plány) – adaptér `operationHours({ provided })`.
2. Reálne API dodávateľov dielov podľa krajiny (`kind: 'api'`, endpointy podľa zmluvy).
3. Faktúry/pokladnica (e-Kasa SK, EET/účtovné systémy) – zatiaľ nie sú súčasťou.
4. Právna kontrola textov a hodnôt `verified: false`.
5. Odosielanie SMS/e-mailov (Garagee zatiaľ len vytvára odkazy – nič neposiela samo).

Podklady na odoslanie do OpenAI: `docs/SUBMISSION.md`, `docs/TOOL_ANNOTATIONS.md`.
