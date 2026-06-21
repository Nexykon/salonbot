#!/usr/bin/env python3
"""
FlowTiq Email Generator
========================
Vzame kontakte iz contacts.csv, za vsakega:
- Generira unikatni tracking token
- Personalizira email predlogo (zamenja {{IME_FIRME}} in {{TOKEN}})
- Shrani HTML email v output/
- Ustvari summary.csv z vsemi podatki za uvoz v leads dashboard

Uporaba:
  python3 generate_emails.py

contacts.csv format:
  ime_firme,email,kategorija
  Frizerski salon Vita,vita@primer.si,01_frizerji
  Picerija Mario,mario@primer.si,05_picerije
"""

import csv
import os
import random
import string
import time
import json
from datetime import datetime

BASE_URL = "https://salonbot-production-785b.up.railway.app"
TEMPLATES_DIR = "email-templates"
OUTPUT_DIR = "output-emails"
CONTACTS_FILE = "contacts.csv"
SUMMARY_FILE = "summary.csv"

CATEGORY_MAP = {
    "frizerji":          "01_frizerji",
    "nohtarnice":        "02_nohtarnice",
    "masaze":            "03_masaze_wellness",
    "wellness":          "03_masaze_wellness",
    "pasji":             "04_pasji_strizci",
    "picerije":          "05_picerije",
    "restavracije":      "06_restavracije",
    "fotografski":       "07_fotografski_studii",
    "kozmeticarke":      "08_kozmeticarke",
    "pedikure":          "09_pedikure",
    "trenerji":          "10_osebni_trenerji",
    "tattoo":            "11_tattoo",
    "splosno":           "12_splosno",
}

def gen_token():
    chars = string.ascii_lowercase + string.digits
    r1 = ''.join(random.choices(chars, k=10))
    r2 = ''.join(random.choices(chars, k=10))
    t = hex(int(time.time()))[2:]
    return r1 + r2 + t

def resolve_template(category_str):
    c = category_str.lower().strip()
    if c.startswith("0") and c[:2].isdigit():
        return c  # already like "05_picerije"
    for key, val in CATEGORY_MAP.items():
        if key in c:
            return val
    return "12_splosno"

def load_template(template_name):
    # Poskusi točno ime, potem z wildcardingom
    exact = os.path.join(TEMPLATES_DIR, template_name + ".html")
    if os.path.exists(exact):
        with open(exact, 'r', encoding='utf-8') as f:
            return f.read()
    # Išči po prefiksu
    for fn in sorted(os.listdir(TEMPLATES_DIR)):
        if fn.startswith(template_name[:2]) and fn.endswith('.html'):
            with open(os.path.join(TEMPLATES_DIR, fn), 'r', encoding='utf-8') as f:
                return f.read()
    # Fallback na splošno
    fallback = os.path.join(TEMPLATES_DIR, "12_splosno.html")
    with open(fallback, 'r', encoding='utf-8') as f:
        return f.read()

def get_subject_from_template(template_name):
    subjects = {
        "01_frizerji":         "{} — stranke se same naročajo prek WhatsAppa?",
        "02_nohtarnice":       "{} — zamujene rezervacije prek WhatsAppa?",
        "03_masaze_wellness":  "{} — kakšen bi bil polni urnik brez klicev?",
        "04_pasji_strizci":    "{} — manj klicev, več šišanja 🐾",
        "05_picerije":         "{} — naročila za dostavo prek WhatsAppa?",
        "06_restavracije":     "{} — rezervacije miz prek WhatsAppa?",
        "07_fotografski_studii": "{} — termini za fotografiranje na avtopilotu?",
        "08_kozmeticarke":     "{} — stranke se naročajo same, vi delate v miru",
        "09_pedikure":         "{} — polni termini brez telefoniranja?",
        "10_osebni_trenerji":  "{} — treningi rezervirani, vi trenirate",
        "11_tattoo":           "{} — manj pisanja, več tattooja",
        "12_splosno":          "{} — WhatsApp pomočnik za vaše podjetje?",
    }
    return subjects.get(template_name, "{} — WhatsApp pomočnik za vaše podjetje?")

def main():
    if not os.path.exists(CONTACTS_FILE):
        print(f"NAPAKA: {CONTACTS_FILE} ne obstaja.")
        print("\nUstvari datoteko contacts.csv s stolpci: ime_firme,email,kategorija")
        print("\nPrimer vsebine:")
        print("ime_firme,email,kategorija")
        print("Frizerski salon Vita,vita@primer.si,frizerji")
        print("Picerija Mario,mario@primer.si,picerije")
        print("Nohtarnica Ana,ana@primer.si,nohtarnice")
        # Ustvari primer
        with open(CONTACTS_FILE, 'w', encoding='utf-8', newline='') as f:
            w = csv.writer(f)
            w.writerow(['ime_firme','email','kategorija'])
            w.writerow(['Frizerski salon Vita','vita@primer.si','frizerji'])
            w.writerow(['Picerija Mario','mario@primer.si','picerije'])
            w.writerow(['Nohtarnica Ana','ana@primer.si','nohtarnice'])
        print(f"\nUstvarjen primer {CONTACTS_FILE} — uredi ga in znova zaženi skripto.")
        return

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    results = []
    errors = []

    with open(CONTACTS_FILE, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"Naloženih {len(rows)} kontaktov iz {CONTACTS_FILE}")
    print()

    for i, row in enumerate(rows, 1):
        ime = row.get('ime_firme','').strip()
        email = row.get('email','').strip()
        kat_raw = row.get('kategorija','splosno').strip()

        if not ime or not email:
            errors.append(f"Vrstica {i}: manjka ime ali email — preskočeno")
            continue

        if '@' not in email or '.' not in email.split('@')[-1]:
            errors.append(f"Vrstica {i}: neveljaven email '{email}' — preskočeno")
            continue

        template_name = resolve_template(kat_raw)
        token = gen_token()
        subject = get_subject_from_template(template_name).format(ime)

        try:
            html = load_template(template_name)
        except Exception as e:
            errors.append(f"Vrstica {i}: napaka pri nalaganju predloge '{template_name}': {e}")
            continue

        # Zamenjaj placeholderje
        html = html.replace('{{IME_FIRME}}', ime)
        html = html.replace('{{TOKEN}}', token)

        # Shrani HTML
        safe_name = ''.join(c if c.isalnum() or c in '-_' else '_' for c in email)
        out_file = os.path.join(OUTPUT_DIR, f"{i:04d}_{safe_name}.html")
        with open(out_file, 'w', encoding='utf-8') as f:
            f.write(html)

        results.append({
            'ime_firme': ime,
            'email': email,
            'kategorija': kat_raw,
            'template': template_name,
            'token': token,
            'subject': subject,
            'file': out_file,
            'da_link': f"{BASE_URL}/track/{token}/da",
            'ne_link': f"{BASE_URL}/track/{token}/ne",
        })
        print(f"  [{i:3d}] ✓ {ime} <{email}> → {template_name}")

    # Shrani summary CSV
    if results:
        with open(SUMMARY_FILE, 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=['ime_firme','email','kategorija','template','token','subject','file','da_link','ne_link'])
            w.writeheader()
            w.writerows(results)

        print(f"\n{'='*60}")
        print(f"✅ Generirano: {len(results)} emailov")
        print(f"❌ Napake:     {len(errors)}")
        print(f"📁 Emaili:     {OUTPUT_DIR}/")
        print(f"📊 Summary:    {SUMMARY_FILE}")
        print(f"{'='*60}")

        if errors:
            print("\nNapake:")
            for e in errors:
                print(f"  ⚠️  {e}")

        print(f"\nNASLEDNJI KORAKI:")
        print(f"1. Preveri emaile v mapi '{OUTPUT_DIR}/'")
        print(f"2. Uvozi kontakte v leads dashboard: /leads.html")
        print(f"3. Pošlji emaile prek svoje email storitve (Gmail, Brevo, itd.)")
        print(f"   Subject: glejte stolpec 'subject' v {SUMMARY_FILE}")

    else:
        print("\nNi bilo generirano nobenega emaila.")

if __name__ == '__main__':
    main()
