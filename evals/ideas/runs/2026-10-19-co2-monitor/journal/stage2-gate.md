**Gate 2: the parts are sourced and quoted (desk CO2 monitor, `co2-monitor`)**

**Page:** products/co2-monitor/view.html
**Link:** file://products/co2-monitor/view.html

The page now has a Source section under the design: every offer, the shops and the quote. This shell has no browser, so open the link in yours (or reload it).

**Total: $165.46 for one unit, delivered to Italy. That is over the $100 budget.** The $100 was my assumption from stage 1 ("not expensive"), not a number you gave me. The longest lead time is 33 days.

**Three shops, all in the EU, so there is no customs:**
- **BerryBase (DE):** $69.64 + $11.42 shipping. The Pico, the CO2 sensor, the resistors, the wire and the USB cable.
- **Opencircuit (NL):** $52.85 + $14.18 shipping. The OLED, the STEMMA QT cable, the inserts and the feet.
- **TME (PL):** $10.03 + $6.73 shipping. The LED and the three kinds of screws.
- **Your friend's printer:** $0.61 of PLA for the shell and the lid.

**Prices are euros converted to dollars.** Sprue quotes only in dollars. I took each shop's price without VAT, added 22% Italian VAT and converted at the ECB rate of 1.1253 USD/EUR (16 October 2026). Expect the checkouts to come to about **EUR 147 in all**, within a few percent.

**What drives the cost:**
- **CO2 sensor: $61.03.** This is the cheapest SCD-4x I could find in an EU shop with stock. It is an **SCD-41 (Adafruit 5190), not the SCD-40** the design names. bom.json lists the SCD-41 as an alternate on the same board (same size, holes and connectors). The genuine SCD-40 costs $71.80 at Opencircuit, 10-12 days. Every branded SCD-4x breakout I found costs EUR 50 or more.
- **Shipping: $32.33 for three parcels.** I couldn't cut a shop. The inserts and the STEMMA QT cable have no usable offer outside Opencircuit. The LED that matches the design is sold only at TME.
- **OLED: $30.07** (Adafruit 326, Opencircuit). Kiwi Electronics sells it for $21.95 with 10 in stock, but adds a fourth parcel, so it costs $6.06 more overall.
- **Inserts: $12.48** for a pack of 50. The unit uses 4.

**Left out of the total (`costNotes`):**
- The prints are counted as filament only: 36 g of PLA at the price of a Sunlu spool. A whole spool, failed prints and power are not counted.
- **An online print service is not priced.** Sprue's print rate is a US figure, and a real quote needs the STL files uploaded, which I didn't do.
- Not counted: solder, a heat-set insert tip if your iron lacks one, and a USB charger (any 5 V phone charger or the computer works).
- Free shipping is out of reach: Opencircuit starts at EUR 150 and BerryBase at EUR 250. TME states no minimum order, and the BerryBase and Opencircuit shipping pages I read mention no small-order fee.
- Packs leave spares: 46 inserts, 96 M3 screws, 96 M2 x 6 and 98 M2 x 4.

**Lines with only one offer:**
- **LED:** TME only. BerryBase's only bicolour 5 mm LED is a dimmer part (60/50 mcd against 200/180), which the design wasn't checked with.
- **Inserts:** Opencircuit only, with **unknown stock** and **10-30 days**. That 33-day lead is the longest in the order.
- **STEMMA QT cable:** Opencircuit only. Sourcing **dropped two offers with zero stock** (Kiwi and BerryBase).
- **The three screw lines:** TME only (Bossard M3 x 6, Kraftberg M2 x 6 and M2 x 4).
- **USB cable:** two offers, but both from BerryBase.

**Unknown stock in the order:** the OLED at Opencircuit (10-30 days) and the inserts.

**Estimates:**
- **Every price** is a conversion (the VAT and the exchange rate above).
- **TME's shipping** (EUR 4.90 net, Standard Economy) comes from TME's 2024 announcement. Its current shipping page for Italy didn't load.
- **Kiwi's shipping** couldn't be read, so I used Opencircuit's PostNL rate as a stand-in. Kiwi isn't in the order, so this only affects the "pick Kiwi" figure.
- **Lead times** are each shop's dispatch time plus my guess at transit.

**Not an exact match:** the wire is BerryBase's 0.14 mm2 (about 26 AWG) PVC wire, not silicone wire. It works fine for the short runs inside the case.

**Checks:** the design checks are unchanged (16 run, 0 failed, the same 3 flags as gate 1). Writing the cost notes made `sprue system` stale, so I reran it: PASS.

**Sourcing is done for the design you accepted, but it can't reach $100.** Only a part swap can bring the cost down much, and a swap reopens the design gate. The best candidate I found is a cheaper OLED: Soldered's 0.96 in Qwiic SSD1306 board at BerryBase (EUR 9.55, 9 in stock), about $11.02 against $30.07. That would bring the total to about **$146**. I haven't read that board's datasheet, size or hole positions, so the front of the case would need redrawing. Getting near $100 would also need a cheaper CO2 module than the Adafruit one. I haven't checked any.

**What next?**
- **Accept and plan the build** (if $165 is fine for one unit): `sprue accept co2-monitor`, then stage 3.
- **Swap a part** (the OLED, and maybe the CO2 sensor) to get the cost down. This goes back through the design gate, then I requote.
- **Change a supplier:** for example `sprue pick co2-monitor oled 'Kiwi Electronics'` buys the OLED from a shop with stock. It costs $6.06 more and doesn't shorten the 33-day lead, because the inserts set it. Or pick `Opencircuit` for the `co2` line to get the genuine SCD-40, for $10.77 more.
- **Edit the design:** say what to change, and the run goes back to gate 1.
