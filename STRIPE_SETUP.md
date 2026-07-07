# Stripe — navodila za aktivacijo plačil

Koda je pripravljena. Ko odpreš Stripe račun, naredi samo tole (10 minut):

## 1. Ustvari izdelka in ceni
Stripe Dashboard -> **Products** -> Add product:

| Izdelek | Cena | Interval |
|---|---|---|
| FlowTiq Osnovni | 49,99 EUR | mesečno (recurring) |
| FlowTiq Pro | 79,99 EUR | mesečno (recurring) |
| FlowTiq AI | 159,99 EUR | mesečno (recurring) |

Pri vsaki ceni skopiraj **API ID** (začne se s `price_...`).

## 2. Vpiši ključe v Railway (env spremenljivke)
- `STRIPE_SECRET_KEY` = Developers -> API keys -> Secret key (`sk_live_...`)
- `STRIPE_PRICE_STARTER` = price ID Osnovnega paketa
- `STRIPE_PRICE_PRO` = price ID Pro paketa
- `STRIPE_PRICE_AI` = price ID AI paketa

## 3. Nastavi webhook
Developers -> **Webhooks** -> Add endpoint:
- URL: `https://TVOJA-DOMENA/stripe/webhook`
- Dogodki (events):
  - `checkout.session.completed`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Skopiraj **Signing secret** (`whsec_...`) v env `STRIPE_WEBHOOK_SECRET`.

## 4. Redeploy in test
1. Redeploy na Railway (da se naložijo env spremenljivke).
2. Prijavi se kot testni lokal -> Nastavitve -> **Naročnina** -> klikni paket.
3. Odpre se Stripe Checkout; za test uporabi testni način (`sk_test_...` ključi) in kartico `4242 4242 4242 4242`.

## Kako deluje (že v kodi)
- Gumba v nastavitvah kličeta `POST /api/billing/checkout` -> Stripe Checkout s 30-dnevnim trial obdobjem (samo ob prvi naročnini) in predizpolnjenim emailom.
- Po plačilu webhook `checkout.session.completed` poveže Stripe kupca in naročnino s salonom ter nastavi paket (starter/pro) in status `active`.
- Menjava paketa v Stripe (upgrade/downgrade) samodejno posodobi paket v bazi (po price ID) — s tem se odklene/zaklene POS zavihek.
- Neuspešno plačilo ali odpoved -> status `inactive`, bot za ta lokal neha odgovarjati, ti pa dobiš email obvestilo.
- Gumb "Uredi naročnino / računi" odpre Stripe Billing Portal (menjava kartice, računi, odpoved). V Stripe Dashboardu -> Settings -> Billing -> **Customer portal** klikni "Activate" (enkratno).

## Opombe
- Dokler `STRIPE_SECRET_KEY` ni nastavljen, gumbi vrnejo prijazno sporočilo "Plačila še niso omogočena" — nič se ne pokvari.
- `allow_promotion_codes: true` — v Stripe lahko ustvariš kupone (npr. za prvih 50 strank).
