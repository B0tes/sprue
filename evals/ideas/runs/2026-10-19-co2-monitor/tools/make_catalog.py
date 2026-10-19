# Builds products/co2-monitor/catalog.json from prices read on supplier pages (2026-10-19, WebFetch).
# Every price goes in as USD with 22% Italian VAT: ex-VAT EUR x 1.22 x FX. The page's own figure is kept in `_page`.
import json, sys

FX = 1.1253          # USD per EUR, ECB reference rate 2026-10-16
IT_VAT = 1.22
DAY = "2026-10-19"
OUT = sys.argv[1]

def usd_from(price, cur, vat):
    """price as the page shows it; vat: the VAT rate already in it (0 for net)."""
    ex = price / (1 + vat)
    eur = ex if cur == "EUR" else None
    if cur == "EUR":
        return round(ex * IT_VAT * FX, 4)
    if cur == "USD":  # TME's net USD, seen from this session
        return round(ex * IT_VAT, 4)
    raise ValueError(cur)

def offer(supplier, sku, url, breaks, cur, vat, stock, lead, mpn=None, pack=None, page=None):
    o = {"supplier": supplier, "sku": sku}
    if mpn: o["mpn"] = mpn
    o["url"] = url
    if pack: o["packSize"] = pack
    o["priceBreaks"] = [{"qty": q, "unitUsd": usd_from(p, cur, vat)} for q, p in breaks]
    o.update({"stock": stock, "leadDays": lead, "source": "snapshot", "capturedAt": DAY})
    o["_page"] = page or f"{' / '.join(f'{q}+: {p} {cur}' for q, p in breaks)} ({'net' if vat == 0 else f'incl. {round(vat*100)}% VAT'}) on the page"
    return o

BB, OC, KIWI, TME, BZ = "BerryBase", "Opencircuit", "Kiwi Electronics", "TME", "buyzero"
offers = {
  "pico": [
    offer(BB, "RPI-PICO Raspberry Pi Pico", "https://www.berrybase.de/en/raspberry-pi-pico-rp2040-microcontroller-board", [(1, 4.10)], "EUR", .19, 100, 6, "SC0915", page="EUR 4.10 incl. VAT; 'Available, 100+'; 1-3 days"),
    offer(TME, "SC0915 RASPBERRY PI PICO", "https://www.tme.eu/en/details/sc0915/raspberry-pi-embedded/raspberry-pi/raspberry-pi-pico/", [(1, 4.00), (10, 3.90), (25, 3.71)], "USD", 0, 1663, 6, "SC0915"),
    offer(KIWI, "KW-2772 Raspberry Pi Pico w/o headers", "https://www.kiwi-electronics.com/en/raspberry-pi-pico-10494", [(1, 3.49), (10, 3.42)], "EUR", 0, 250, 6, "SC0915", page="EUR 3.49 ex. VAT; 10+: 3.42; '250+ piece(s) in stock'"),
    offer(OC, "4864 Adafruit Raspberry Pi Pico RP2040", "https://opencircuit.shop/product/raspberry-pi-pico-rp2040", [(1, 7.05), (25, 6.17)], "EUR", 0, "unknown", 15, "SC0915", page="EUR 8.50 incl. / 7.05 excl. VAT (NL); 25+: 7.46 incl.; 'In external warehouse', delivered in 10 to 12 days"),
  ],
  "co2": [
    offer(OC, "5187 Adafruit SCD-40", "https://opencircuit.shop/product/adafruit-scd-40-true-co2-temperature-humidity", [(1, 52.30)], "EUR", 0, 100, 15, "Adafruit 5187", page="EUR 63.25 / 52.30 excl. VAT (NL); '100 in external warehouse'; delivered in 10 to 12 days"),
    offer(BB, "ADA5190 Adafruit SCD-41 (bom.json alternate, same board)", "https://www.berrybase.de/en/adafruit-scd-41-co2-sensor-400-5000-ppm-40ppm-5-temperature-and-humidity-sensor-3.3-5v", [(1, 52.90)], "EUR", .19, 21, 6, "Adafruit 5190", page="EUR 52.90 incl. VAT; 'Available, 21 piece'; 1-3 days"),
  ],
  "oled": [
    offer(KIWI, "ADA-326 Monochrome 0.96in 128x64 OLED STEMMA QT", "https://www.kiwi-electronics.com/en/monochrome-0-96quot-128x64-oled-graphic-display-754", [(1, 15.99), (10, 15.19)], "EUR", 0, 10, 6, "Adafruit 326", page="EUR 15.99 ex. VAT; 10+: 15.19; '10 piece(s) in stock'"),
    offer(OC, "326 Adafruit Monochrome 0.96in 128x64 OLED STEMMA QT", "https://opencircuit.shop/product/monochrome-0.96-inch-128x64-oled-graphic", [(1, 26.50)], "EUR", .21, "unknown", 33, "Adafruit 326", page="EUR 26.50 incl. VAT on the Adafruit OLED list page (opencircuit.shop/list/oled-displays/...); delivered in 10 to 30 days; product page not read"),
  ],
  "led": [
    offer(TME, "L-59SURKCGKW (now WP59SURKCGKW)", "https://www.tme.eu/en/details/l-59surkcgkw/tht-leds-round/kingbright-electronic/", [(1, .22), (25, .20), (50, .19), (100, .18)], "USD", 0, 11580, 6, "Kingbright L-59SURKCGKW"),
  ],
  "res": [
    offer(BB, "MSW390R.25 metal film 390 ohm 1/4 W 1%", "https://www.berrybase.de/en/metal-film-resistor-390.0-ohm-1-4w-1-0207-axial-through-hole-mounting", [(1, .05)], "EUR", .19, 100, 6, page="EUR 0.05 incl. VAT a piece; 100+ in stock (resistor category page)"),
    offer(TME, "CF1/4WS-390R carbon film 390 ohm 0.25 W 5%", "https://www.tme.eu/en/details/cf1_4ws-390r/tht-resistors/sr-passives/", [(100, .01)], "USD", 0, 17500, 6, pack=100, page="USD 0.01 net from 100 pcs; MOQ 100, multiplicity 100"),
  ],
  "qtcable": [
    offer(OC, "4210 Adafruit STEMMA QT / Qwiic JST SH 4-pin cable 100 mm", "https://opencircuit.shop/product/stemma-qt-qwiic-jst-sh-4-pin-cable-100mm-long", [(1, 3.75), (10, 3.62)], "EUR", 0, 100, 15, "Adafruit 4210", page="EUR 4.50 / 3.75 excl. VAT (NL); 10+: 4.34 incl.; '100 in external warehouse'; 10 to 12 days"),
    offer(KIWI, "ADA-4210 STEMMA QT / Qwiic JST SH 4-pin cable 100 mm", "https://www.kiwi-electronics.com/en/stemma-qt-qwiic-jst-sh-4-pin-cable-100mm-long-10385", [(1, .89)], "EUR", 0, 0, 6, "Adafruit 4210", page="EUR 0.89 ex. VAT; 'Out of stock'"),
    offer(BB, "PRT-17259 SparkFun Qwiic flexible cable 100 mm", "https://www.berrybase.de/en/sparkfun-qwiic-flexible-cable-100mm", [(1, 2.30)], "EUR", .19, 0, 6, "SparkFun PRT-17259", page="EUR 2.30 incl. VAT; 'Currently not available'"),
  ],
  "wire": [
    offer(BB, "55045 stranded wire 1x0.14 mm2 (18x0.1), PVC, 10 m, black", "https://www.berrybase.de/en/stranded-copper-wire-insulated-1x0.14mm-10m/color-black", [(1, 1.50)], "EUR", .19, 100, 6, page="EUR 1.50 incl. VAT a 10 m reel; 'Available, 100+ piece' (black)"),
    offer(OC, "61459 Pololu stranded wire, red, 26 AWG, 70 ft", "https://opencircuit.shop/product/stranded-wire-red-26-awg-70-feet", [(1, 12.50)], "EUR", 0, 144, 10, page="EUR 15.10 / 12.50 excl. VAT (NL); '144 in external warehouse'; 5 to 7 days"),
  ],
  "usbcable": [
    offer(BB, "96193 USB 2.0 Hi-Speed cable A to Micro B, white, 1.0 m", "https://www.berrybase.de/en/usb-2.0-hi-speed-cable-a-plug-micro-b-plug-white/length-1-00-m", [(1, 1.76)], "EUR", .19, 11, 6, page="EUR 1.76 incl. VAT; 'Available, 11 piece'; USB 2.0, 2x AWG 28 + 2x AWG 28 conductors"),
    offer(BB, "RPI-MUSB-2 official Raspberry Pi micro USB cable, black, 1.0 m", "https://www.berrybase.de/en/official-raspberry-pi-micro-usb-cable-black-1.0m", [(1, 1.80)], "EUR", .19, 2, 6, "SC0732", page="EUR 1.80 incl. VAT; 'Available, 2 piece'; data lines not stated"),
  ],
  "ins": [
    offer(OC, "4255 Adafruit brass heat-set inserts M3 x 4 mm, 50 pack", "https://opencircuit.shop/product/brass-heat-set-inserts-plastic-m3-x-4mm-50", [(1, round(11.00 / 50, 4))], "EUR", .21, "unknown", 33, "Adafruit 4255", pack=50, page="EUR 11.00 incl. VAT a pack of 50 (accessories-for-3d-printing list page); delivered in 10 to 30 days"),
  ],
  "scr3": [
    offer(TME, "B3X6/BN19 Bossard ISO 7380 M3x6, steel 10.9, black", "https://www.tme.eu/en/details/b3x6_bn19/bolts/bossard/1020498/", [(100, .04), (500, .03)], "USD", 0, 43500, 6, "Bossard 1020498", pack=100, page="USD 0.04 net from 100 pcs; MOQ 100, multiplicity 100; head 5.7 x 1.65 mm"),
  ],
  "scr2": [
    offer(TME, "M2X6/D7985 Kraftberg cheese head PH1, steel zinc (ISO 7045)", "https://www.tme.eu/en/details/m2x6_d7985/bolts/kraftberg/", [(100, .02), (1000, .01)], "USD", 0, 106606, 6, pack=100, page="USD 0.02 net from 100 pcs; MOQ 100, multiplicity 100; DIN 7985 / ISO 7045"),
  ],
  "scr2s": [
    offer(TME, "M2X4/D7985 Kraftberg cheese head PH1, steel zinc (ISO 7045)", "https://www.tme.eu/en/details/m2x4_d7985/bolts/kraftberg/", [(100, .02), (1000, .01)], "USD", 0, 190800, 6, pack=100, page="USD 0.02 net from 100 pcs; MOQ 100, multiplicity 100; DIN 7985 / ISO 7045"),
  ],
  "feet": [
    offer(OC, "550 Adafruit little rubber bumper feet, pack of 4", "https://opencircuit.shop/product/little-rubber-bumper-feet-pack-of-4", [(1, round(3.75 / 4, 4))], "EUR", 0, 400, 15, "Adafruit 550", pack=4, page="EUR 4.50 / 3.75 excl. VAT (NL) a pack of 4; '100 in external warehouse' (packs); 10 to 12 days"),
    offer(BZ, "ada-550 Little Rubber Bumper Feet, pack of 4", "https://buyzero.de/en/products/little-rubber-bumper-feet-pack-of-4", [(1, round(1.59 / 4, 4))], "EUR", .19, "unknown", 9, "Adafruit 550", pack=4, page="'Sale price 1,59 EUR' a pack of 4 (VAT not said on the product page; the shipping page says prices include 19% VAT); delivery 1-2 days"),
  ],
}

ship_eur = {BB: (9.90, .19), OC: (12.50, .21), TME: (4.90, 0), BZ: (12.99, .19), KIWI: (12.50, .21)}
shipping = {s: round(p / (1 + v) * IT_VAT * FX, 2) for s, (p, v) in ship_eur.items()}

cat = {
  "_note": "Offers read with WebFetch on 2026-10-19 for one unit shipped to Italy. Every unitUsd is the shop's price without VAT, x 1.22 for Italian VAT (EU distance-sale rules; no page states what an Italian buyer is charged) and x 1.1253 USD/EUR (ECB reference rate of 2026-10-16). Each offer's _page keeps the figure as the page shows it. TME's pages were read in USD net from this session; its EUR price for Italy is assumed to be the same value. Shops left out: Amazon.it (robots disallow), DigiKey and Mouser.it (prices not readable), Botland (pages withdrawn), TinyTronics (prices not readable), Electrokit (web orders to the Nordics only), The Pi Hut and Pimoroni (UK: EU orders by DHL Express only, GBP 30).",
  "shipping": shipping,
  "shippingRead": [BB, OC, TME, BZ],
  "shippingBasis": {
    BB: "EUR 9.90 by DHL Parcel for EU orders of 0.01-199.99 EUR, free from 250 EUR (berrybase.de Shipping and Payment Terms, read 2026-10-19); prices incl. VAT. Converted at 22% VAT and 1.1253 USD/EUR.",
    OC: "EUR 12.50 by PostNL to Italy below EUR 150, free from EUR 150 (opencircuit.shop/orderinginformation, read 2026-10-19). Converted at 22% VAT and 1.1253 USD/EUR.",
    TME: "EUR 4.90 net, Standard Economy to Italy, up to 15 kg, 3-4 working days (TME news 'Nuova opzione di spedizione piu economica: Standard Economy', dated 2024-06-11, read 2026-10-19; TME's own shipping page for Italy did not load). Plus 22% VAT, at 1.1253 USD/EUR.",
    BZ: "EUR 12.99 by DHL Premium to Spain and Italy (buyzero.de shipping costs page, read 2026-10-19); prices incl. 19% VAT. Converted at 22% VAT and 1.1253 USD/EUR.",
    KIWI: "ESTIMATE. Kiwi's pages give shipping only to the United States (EUR 61.16) and its help page did not load. Stand-in: Opencircuit's EUR 12.50 PostNL rate to Italy, another Dutch shop shipping by PostNL, read 2026-10-19.",
  },
  "filament": {
    "PLA": {"usdPerKg": round(14.50 / 1.19 * IT_VAT * FX, 2), "gPerCm3": 1.24,
            "url": "https://www.berrybase.de/en/sunlu-pla-2.0-filament-1-75mm-1kg", "capturedAt": DAY,
            "densityUrl": "https://filament2print.com/en/pla/3454-prusament-pla.html", "leadDays": 6,
            "_page": "Sunlu PLA+ 2.0, 1.75 mm, 1 kg, black (SU-PLAP2-B): EUR 14.50 incl. VAT, 15 in stock; density 1.24 g/cm3 (ISO 1183) is Prusament PLA's, Sunlu gives none"},
  },
  "offers": offers,
}
json.dump(cat, open(OUT, "w"), indent=2)
print(json.dumps(shipping), cat["filament"]["PLA"]["usdPerKg"])
