# Caree – OpenAI ChatGPT app directory submission kit

Checklist based on the OpenAI App submission guidelines (developers.openai.com/apps-sdk/app-submission-guidelines)
and known undocumented form requirements. Tick every line before pressing Submit.

## A. Account & domain
- [ ] OpenAI organisation uses **global** data residency (EU data residency blocks submission). This is an OpenAI org setting – Caree's own data stays in the EU (Fly.io `fra`).
- [ ] Organisation / developer verification completed in the OpenAI Platform.
- [ ] App deployed at `PUBLIC_URL` with HTTPS (e.g. `https://caree.housee.sk`), MCP endpoint `PUBLIC_URL/mcp`.
- [ ] Domain verification: put the token from the form into `OPENAI_APPS_CHALLENGE`, deploy, check `PUBLIC_URL/.well-known/openai-apps-challenge`, click Verify.

## B. Public URLs (live pages, not PDFs)
- Privacy policy: `PUBLIC_URL/privacy`
- Terms of service: `PUBLIC_URL/terms`
- Data processing agreement: `PUBLIC_URL/dpa`
- Support: `PUBLIC_URL/support` – set `SUPPORT_EMAIL` to a real, monitored mailbox first
- [ ] `COMPANY_ADDRESS`, `COMPANY_ID`, `SUPPORT_EMAIL`, `PRIVACY_EMAIL` set (otherwise the pages show placeholders)
- [ ] Legal texts reviewed by a lawyer

## C. Assets
- [ ] Logo: SVG, 64×64, under 5 KB (no embedded raster images – run through SVGO)
- [ ] 1–4 screenshots, 706 px wide, 400–860 px high, widget only, each with an example user message (use prompts P1–P4 below)
- [ ] Public screencast (YouTube/Loom) showing the app working inside ChatGPT: connect → find vehicle → estimate → free slots → book → approval link

## D. Authentication & review account
- OAuth 2.1, authorization code + PKCE (S256), dynamic client registration at `/register`, metadata at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp`.
- Review account: set `DEMO_SEED=1`, `DEMO_EMAIL`, `DEMO_PASSWORD` (≥10 chars). Fully featured demo shop (Slovakia, 3 bays, 3 mechanics, 3 suppliers, 2 vehicles, 1 job with inspection findings). No sign-up, no 2FA.

## E. Policy compliance (how Caree meets it)
| Requirement | Caree |
|---|---|
| Minimum data | Only data needed for workshop work; no chat history requested; no precise location |
| Restricted data | No payment cards, government IDs, health data, passwords of other services, API keys collected via tools |
| No in-app commerce of digital goods | No plans, prices, upgrades or checkout links shown in ChatGPT. Subscriptions only on the website. |
| No ads | None |
| Explicit annotations | All tools set readOnlyHint / destructiveHint / openWorldHint – see `TOOL_ANNOTATIONS.md` |
| Human confirmation for irreversible actions | `order_parts` and `erase_customer_data` require `confirmed: true`; tool descriptions instruct to confirm with the user; `cancel_appointment` marked destructive |
| Transparent auth | Sign-in page states what is accessed; scope `workshop` only |
| Untrusted data in UI | Widget renders with `textContent` only; no remote scripts; empty CSP domain lists |

## F. Test cases for the form

### Positive (5)
| # | Scenario | Prompt | Expected tool | Expected output |
|---|---|---|---|---|
| P1 | Find a car | "Find the car ZA 123AB in Caree." | `find_vehicle` (then `get_vehicle`) | Škoda Octavia, next STK date, maintenance items |
| P2 | Price a repair | "How much is a timing belt and water pump on ZA 123AB?" | `list_operations` → `estimate_job` | Hours with shared-access saving, parts, total incl. 23 % VAT, source of each number |
| P3 | Book | "When can you fit an oil service for ZA 123AB this week? Book the first slot." | `find_free_slots` → `book_appointment` | Free slots widget; booking J-000xx with time, lift, mechanic |
| P4 | Workshop day | "Show today's workshop plan." | `plan_workshop` | Jobs per lift, mechanic utilisation bars, queue |
| P5 | Customer approval | "Create the approval link for job J-00001." | `create_approval_link` | Private URL; customer sees red/amber findings with price |

### Negative (3)
| # | Prompt | Why out of scope / expected behaviour |
|---|---|---|
| N1 | "What's the best car to buy for a family?" | General car advice, not shop management – Caree should not be called |
| N2 | "Order brake pads for my car from Amazon." | Consumer shopping on third-party sites – not a Caree function; `order_parts` only for a shop's own suppliers after confirmation |
| N3 | "Delete all customers older than 2015." | Bulk deletion is not offered; erasure only per customer with explicit confirmation |

## G. Before go-live (product, not form)
- [ ] Confirm every `verified: false` value in `src/config/countries.js` with local legal/tax advice for launch markets
- [ ] Contract with a labour-time / VIN data provider (HaynesPro, Autodata…) and plug it into `operationHours(provided)`
- [ ] Contracts and API specs with real parts suppliers per country (configure `kind: 'api'` suppliers)
- [ ] Trademark check for "Caree" (ÚPV SR, EUIPO, WIPO)
