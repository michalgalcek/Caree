# Garagee – OpenAI submission kit

Since 2026 ChatGPT apps are submitted and published **as plugins** in the plugin portal (platform.openai.com/plugins → "Upload new or existing plugin" → *With MCP*).
Sources: developers.openai.com/plugins/deploy/submission, developers.openai.com/apps-sdk/app-guidelines (checked 15 Nov 2026).

## 0. Package
- `plugin/garagee/plugin.json` – listing (name, descriptions, URLs, logo, starter prompts), 5 positive + 3 negative test cases, countries, translations (sk, cs, de, pl, hu).
- `plugin/garagee/mcp.json` – one remote server `https://garagee.housee.sk/mcp` (streamable HTTP; OAuth discovered from the server, dynamic client registration, no client secret, no headers).
- `plugin/garagee/assets/logo.png`, `logo-dark.png` – 512×512.
- Build the ZIP: `cd plugin && zip -r ../garagee-plugin.zip garagee -x 'garagee/screenshots/*' 'garagee/assets/*.svg'`
- `plugin/garagee/screenshots/` – 706 px wide widget screenshots (English review shop) in case the form asks for them; not part of the ZIP.
- **Before upload:** replace `demo_recording_url` with a public video (YouTube unlisted / Loom) of the app working in ChatGPT; pick the final `category` in the dashboard.

## A. Account & domain
- [ ] OpenAI organisation uses **global** data residency (reported by developers to block submission otherwise – verify in the form). Garagee's own data stays in the EU (Fly.io `fra`).
- [ ] Submitter is an organisation owner or has "Apps Management Write".
- [ ] Organisation / developer verification completed in the OpenAI Platform.
- [ ] App deployed at `PUBLIC_URL` with HTTPS (e.g. `https://garagee.housee.sk`), MCP endpoint `PUBLIC_URL/mcp`.
- [ ] Domain verification: put the token from the form into `OPENAI_APPS_CHALLENGE`, deploy, check `PUBLIC_URL/.well-known/openai-apps-challenge`, click Verify.

## B. Public URLs (live pages, not PDFs)
- Privacy policy: `PUBLIC_URL/privacy`
- Terms of service: `PUBLIC_URL/terms`
- Data processing agreement: `PUBLIC_URL/dpa`
- Support: `PUBLIC_URL/support` – set `SUPPORT_EMAIL` to a real, monitored mailbox first
- [ ] `COMPANY_ADDRESS`, `COMPANY_ID`, `SUPPORT_EMAIL`, `PRIVACY_EMAIL` set (otherwise the pages show placeholders)
- [ ] Legal texts reviewed by a lawyer

## C. Assets
- [x] Logo: square PNG 512×512 (min 48×48, max 5 MiB), light + dark
- [x] Screenshots 706 × 400–860 px, widget only (`plugin/garagee/screenshots/`)
- [ ] Video walkthrough (`demo_recording_url`): connect → vehicle intake by voice/text → complete → estimate → free slots → book

## D. Authentication & review account
- OAuth 2.1, authorization code + PKCE (S256), dynamic client registration at `/register`, metadata at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp`.
- Reviewer account (English, UK shop "Demo Garage"): `REVIEW_EMAIL` (fly.toml) + secret `REVIEW_PASSWORD` (≥10 chars, set with `fly secrets set` or the Fly dashboard). Enter e-mail and password only in the portal's **Review details** – never in the ZIP. Login: `review@garagee.test`. Same data as the Slovak demo: 3 lifts, 3 mechanics, 3 suppliers, 2 vehicles, 1 job with inspection findings. No sign-up, no 2FA.
- Slovak demo shop for our own tests: `DEMO_EMAIL` + secret `DEMO_PASSWORD`.

## E. Policy compliance (how Garagee meets it)
| Requirement | Garagee |
|---|---|
| Minimum data | Only data needed for workshop work; no chat history requested; no precise location |
| Restricted data | No payment cards, government IDs, health data, passwords of other services, API keys collected via tools |
| No in-app commerce of digital goods | No plans, prices, upgrades or checkout links shown in ChatGPT. Subscriptions only on the website. |
| No ads | None |
| Explicit annotations | All tools set readOnlyHint / destructiveHint / openWorldHint – see `TOOL_ANNOTATIONS.md` |
| Human confirmation for irreversible actions | `order_parts` and `erase_customer_data` require `confirmed: true`; tool descriptions instruct to confirm with the user; `cancel_appointment`, `reschedule_appointment`, `set_shop_settings` and `update_vehicle_intake` marked destructive because they delete or overwrite data |
| Real, complete product | Shops create their own account at `/signup` (terms + DPA consent) and can delete it with all data at `/account/delete`; the reviewer account is just a pre-filled shop |
| Plans without in-app commerce | Start plan = 250 active vehicles; Profi/Workshop+ arranged on the website only (`/plans`, no prices or links inside ChatGPT). At the limit tools return a neutral message (archive/erase or ask the shop owner) – no upgrade prompt. Same limits in ChatGPT, tablet and web. Reviewer and demo shops are on the internal `unlimited` plan. |
| No telemetry in tool output | No session/trace IDs or internal timestamps in tool results; only business data (e.g. job dates, export date in a GDPR export) |
| Transparent auth | Sign-in page states what is accessed; scope `workshop` only |
| Untrusted data in UI | Widget renders with `textContent` only; no remote scripts; empty CSP domain lists |

## F. Test cases
In `plugin.json` → `extensions.com.openai.review.test_cases` (5 positive, 3 negative). They use the reviewer shop's data (ZA 123AB). Run each in ChatGPT developer mode before submitting.

## G. Before go-live (product, not form)
- [ ] Confirm every `verified: false` value in `src/config/countries.js` with local legal/tax advice for launch markets
- [ ] Contract with a labour-time / VIN data provider (HaynesPro, Autodata…) and plug it into `operationHours(provided)`
- [ ] Contracts and API specs with real parts suppliers per country (configure `kind: 'api'` suppliers)
- [x] TMview check 15 Nov 2026: no identical "GARAGEE" mark; closest: GaraGeeks (IT, class 42), GARAGE1 (CH, 9/42). Descriptiveness risk ("garage") – ask a trademark attorney before filing.
- [x] Domains 15 Nov 2026: garagee.sk and garagee.eu free; garagee.com held and listed for sale (Afternic)
