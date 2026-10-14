# Build plan: Ponder, a screenless AI tutor desk unit

> A screenless desk tutor for kids 6 to 14: it sees the homework through a downward camera, hears through microphones and talks through a speaker; the thinking happens in the cloud.

**20 units · $5371.43 for parts, fab and estimated shipping · longest lead 10 days**


**Not in this total:**
- Import duty on the Raspberry Pi kits. Seeed ships them from China under DAP terms, so the carrier collects US duty before delivery. Seeed's customs page cites a 45% base tariff on dev boards: about $207 on the $459.90 of kits if it applies.
- Tariffs Mouser may add. A reviewer read 'a tariff of 8% may be applied if shipping to the United States' on the Camera Module 3 Wide page (about $56 on $700); Mouser pages would not load here, so this and the other Mouser lines are not confirmed. Mouser's shipping insurance (about $7.20 on $875) is extra too.
- The print prices ($1,349.41 at Craftcloud) come from an unverified rate of $0.30/cm3 with a $6 minimum a part, not a quote. Upload the six STLs to Craftcloud's quote tool (PA12 MJF and PETG) before ordering.
- Shipping is an estimate for every shop except LightingSupply.com and SparkFun over $100, and the lead days are the shops' own; the Seeed order also needs DHL transit (2 to 5 working days) and customs. Jameco adds a $5 fee to orders under $10, which order A is.
- Consumables and tools (assembly steps 2 and 3), sales tax, and the second round of shipping if you order in two phases (see Order in two phases, under Build).

## What it is
A document camera crossed with an AIY-style voice kit. A Raspberry Pi Zero 2 W sits in a small head pod with a Camera Module 3 Wide looking down at the page, two I2S MEMS microphones and a MAX98357A I2S amp (the Google AIY Voice HAT v1 audio design, built from breakouts). The head hangs from a 15 in hollow lamp gooseneck that leaves the base pointing up and turns down into the head's top; only a 10-wire ribbon runs through it (power up, speaker and two signals down). A two-part printed base holds the 40 mm speaker, the talk button, an 8-LED status bar, the USB-C input and 425 g of bought steel discs clamped to the arm's threaded pipe. A DPDT toggle on the head cuts the microphones' data line and supply. A printed shutter covers the lens. No custom PCB.

## Order list
The whole batch as one order. Need is pieces, spares included; Buy is what goes in the cart.

| Part | Supplier | What to order | Need | Buy | Cost | Lead | How it was priced |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Raspberry Pi Zero 2 W with header | Seeed Studio | 114060102 | 21 | 21 | $459.90 | 7 d | Snapshot (price read from the product page) |
| microSD card, 32 GB, Class 10 | PiShop.us | 1363-1 | 21 | 21 | $418.95 | 5 d | Snapshot (price read from the product page) |
| Raspberry Pi Camera Module 3 Wide | Mouser | 358-SC0874 | 20 | 20 | $700.00 | 5 d | Snapshot (price read from the product page) |
| Camera cable, Standard-Mini, 38 mm (from the official Pi Zero case kit) | Adafruit | 3446 | 22 | 22 | $128.70 | 5 d | Snapshot (price read from the product page) |
| Adafruit Perma Proto Bonnet Mini Kit | Mouser | 485-3203 | 21 | 21 | $94.50 | 5 d | Snapshot (price read from the product page) |
| Adafruit I2S MEMS Microphone Breakout, SPH0645LM4H | Adafruit | 3421 | 42 | 42 | $262.92 | 5 d | Snapshot (price read from the product page) |
| Adafruit I2S 3 W Class D Amplifier Breakout, MAX98357A | Adafruit | 3006 | 21 | 21 | $112.56 | 5 d | Snapshot (price read from the product page) |
| Speaker, 40 mm, 4 ohm, 3 W | Master Electronics | AS04004PR-R | 20 | 1 x pack of 20 (20 pcs) | $114.60 | 5 d | Snapshot (price read from the product page) |
| Raspberry Pi 15 W USB-C power supply, US, black | Adafruit | 4298 | 20 | 20 | $157.40 | 5 d | Snapshot (price read from the product page) |
| Adafruit USB Type C Breakout Board, downstream | Adafruit | 4090 | 21 | 21 | $55.86 | 5 d | Snapshot (price read from the product page) |
| Adafruit Perma-Proto Quarter-sized Breadboard PCB | Mouser | 485-1608 | 20 | 20 | $79.00 | 5 d | Snapshot (price read from the product page) |
| NeoPixel Stick, 8 x 5050 RGB | Adafruit | 1426 | 21 | 21 | $112.56 | 5 d | Snapshot (price read from the product page) |
| 1N4001 diode | Adafruit | 755 | 20 | 2 x pack of 10 (20 pcs) | $3.00 | 5 d | Snapshot (price read from the product page) |
| 16 mm illuminated pushbutton, green, momentary | Adafruit | 1440 | 21 | 21 | $28.35 | 5 d | Snapshot (price read from the product page) |
| Miniature DPDT toggle, on-on, solder lugs, 1/4-40 bushing | Jameco | 21979 | 21 | 21 | $40.95 | 5 d | Snapshot (price read from the product page) |
| Diffused green 5 mm LED | Adafruit | 298 | 20 | 1 x pack of 25 (25 pcs) | $4.00 | 5 d | Snapshot (price read from the product page) |
| Diffused red 5 mm LED | Adafruit | 299 | 20 | 1 x pack of 25 (25 pcs) | $4.00 | 5 d | Snapshot (price read from the product page) |
| 220 ohm resistor, 1/4 W | Adafruit | 2780 | 120 | 5 x pack of 25 (125 pcs) | $3.75 | 5 d | Snapshot (price read from the product page) |
| 1 k resistor, 1/4 W | Mouser | 485-4294 | 40 | 2 x pack of 25 (50 pcs) | $1.54 | 5 d | Snapshot (price read from the product page) |
| Silicone ribbon cable, 10 wire, 28 AWG, 1 m | Adafruit | 3890 | 41 | 41 | $145.96 | 5 d | Snapshot (price read from the product page) |
| 15 in flexible 1/8 IPS gooseneck, matte black | Grand Brass | 15in. Flexible 1/8ips Goose Neck Pipe - Matte Black | 20 | 20 | $383.00 | 5 d | Snapshot (price read from the product page) |
| 1/8 IPS straight cylinder coupling, 5/8 x 5/8 in, black | Grand Brass | NE438BL | 40 | 40 | $70.40 | 5 d | Snapshot (price read from the product page) |
| 1-3/4 in x 1/8 IPS threaded nipple, zinc-plated steel | Grand Brass | 1-3/4in x 1/8ips zinc plated steel hollow nipple | 20 | 20 | $4.40 | 5 d | Snapshot (price read from the product page) |
| 1/2 in x 1/8 IPS threaded nipple, zinc-plated steel | Grand Brass | NI0-1/2X1/8 | 20 | 20 | $2.20 | 5 d | Snapshot (price read from the product page) |
| 1/8 IPS heavy-duty steel hex nut, 5/8 x 3/16 in, white zinc | Grand Brass | 1/8ips 5/8in x 3/16in heavy duty hex nut, white zinc | 40 | 40 | $3.20 | 5 d | Snapshot (price read from the product page) |
| Steel disk, 3 in dia x 1/4 in, 7/16 in center hole | Wagner Companies | D143-.44CH | 40 | 40 | $252.80 | 5 d | Snapshot (price read from the product page) |
| Brass heat-set insert, M3 x 4 mm | Adafruit | 4255 | 220 | 5 x pack of 50 (250 pcs) | $29.75 | 5 d | Snapshot (price read from the product page) |
| M3 x 8 mm pan head Phillips machine screw, zinc-plated steel | Bolt Depot | 17867 | 220 | 220 | $7.22 | 5 d | Snapshot (price read from the product page) |
| Heat-set insert, M2.5 x 4.0 mm | Printed Solid | 8307 | 80 | 1 x pack of 100 (100 pcs) | $12.99 | 5 d | Snapshot (price read from the product page) |
| M2.5 x 6 mm pan head Phillips machine screw | Bolt Depot | 17857 | 80 | 100 | $3.21 | 5 d | Snapshot (price read from the product page) |
| Little rubber bumper feet | Adafruit | 550 | 80 | 20 x pack of 4 (80 pcs) | $17.20 | 5 d | Snapshot (price read from the product page) |
| Hook-up wire set, 22 AWG stranded, 6 colours x 25 ft | Adafruit | 3111 | 1 | 1 | $19.95 | 5 d | Snapshot (price read from the product page) |
| Base top shell | Craftcloud | base-top.stl, PA12, MJF, grey (as printed) | 20 | 20 | $545.82 | 10 d | Estimate (unverified rate) |
| Base bottom plate | Craftcloud | base-bottom.stl, PA12, MJF, grey (as printed) | 20 | 20 | $262.92 | 10 d | Estimate (unverified rate) |
| Head upper shell | Craftcloud | head-upper.stl, PA12, MJF, grey (as printed) | 22 | 22 | $144.67 | 10 d | Estimate (unverified rate) |
| Head lower shell | Craftcloud | head-lower.stl, PA12, MJF, grey (as printed) | 22 | 22 | $132.00 | 10 d | Estimate (unverified rate) |
| Lens shutter slider | Craftcloud | shutter.stl, PA12, MJF, grey (as printed) | 22 | 22 | $132.00 | 10 d | Estimate (unverified rate) |
| Light-bar diffuser | Craftcloud | diffuser.stl, PETG, natural (translucent) | 22 | 22 | $132.00 | 10 d | Estimate (unverified rate) |
| Shipping (Seeed Studio) | Seeed Studio | shipping | – | 1 | $25.00 | – | Estimate |
| Shipping (PiShop.us) | PiShop.us | shipping | – | 1 | $10.00 | – | Estimate |
| Shipping (Mouser) | Mouser | shipping | – | 1 | $8.00 | – | Estimate |
| Shipping (Adafruit) | Adafruit | shipping | – | 1 | $37.10 | – | Estimate |
| Shipping (Master Electronics) | Master Electronics | shipping | – | 1 | $19.80 | – | Estimate |
| Shipping (Jameco) | Jameco | shipping | – | 1 | $9.00 | – | Estimate |
| Shipping (Grand Brass) | Grand Brass | shipping | – | 1 | $68.60 | – | Estimate |
| Shipping (Wagner Companies) | Wagner Companies | shipping | – | 1 | $72.15 | – | Estimate |
| Shipping (Bolt Depot) | Bolt Depot | shipping | – | 1 | $13.65 | – | Estimate |
| Shipping (Printed Solid) | Printed Solid | shipping | – | 1 | $13.65 | – | Estimate |
| Shipping (Craftcloud) | Craftcloud | shipping | – | 1 | $10.25 | – | Estimate |

### Order in two phases
Order A buys enough for 2 unit(s) to build and measure first. Order B buys the rest of the batch and the spares, once the first units pass and any change to the design has been rerun. Two orders cost $5522.17, $150.74 more than one: shipping is paid twice, and packs and price breaks are split between the orders. Order A is in `order-a.csv` and order B in `order-b.csv`.

| Order | Builds | Cost | Longest lead |
| --- | --- | --- | --- |
| A | 2 unit(s) | $822.65 | 10 d |
| B | 18 unit(s) and the spares | $4699.52 | 10 d |

#### Order A
| Part | Supplier | What to order | Need | Buy | Cost | Lead | How it was priced |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Raspberry Pi Zero 2 W with header | Seeed Studio | 114060102 | 2 | 2 | $45.80 | 7 d | Snapshot (price read from the product page) |
| microSD card, 32 GB, Class 10 | PiShop.us | 1363-1 | 2 | 2 | $39.90 | 5 d | Snapshot (price read from the product page) |
| Raspberry Pi Camera Module 3 Wide | Mouser | 358-SC0874 | 2 | 2 | $70.00 | 5 d | Snapshot (price read from the product page) |
| Camera cable, Standard-Mini, 38 mm (from the official Pi Zero case kit) | Adafruit | 3446 | 2 | 2 | $11.70 | 5 d | Snapshot (price read from the product page) |
| Adafruit Perma Proto Bonnet Mini Kit | Mouser | 485-3203 | 2 | 2 | $9.00 | 5 d | Snapshot (price read from the product page) |
| Adafruit I2S MEMS Microphone Breakout, SPH0645LM4H | Adafruit | 3421 | 4 | 4 | $27.80 | 5 d | Snapshot (price read from the product page) |
| Adafruit I2S 3 W Class D Amplifier Breakout, MAX98357A | Adafruit | 3006 | 2 | 2 | $11.90 | 5 d | Snapshot (price read from the product page) |
| Speaker, 40 mm, 4 ohm, 3 W | Master Electronics | AS04004PR-R | 2 | 1 x pack of 20 (20 pcs) | $114.60 | 5 d | Snapshot (price read from the product page) |
| Raspberry Pi 15 W USB-C power supply, US, black | Mouser | 358-SC0218 | 2 | 2 | $16.00 | 5 d | Snapshot (price read from the product page) |
| Adafruit USB Type C Breakout Board, downstream | Adafruit | 4090 | 2 | 2 | $5.90 | 5 d | Snapshot (price read from the product page) |
| Adafruit Perma-Proto Quarter-sized Breadboard PCB | Mouser | 485-1608 | 2 | 2 | $7.90 | 5 d | Snapshot (price read from the product page) |
| NeoPixel Stick, 8 x 5050 RGB | Adafruit | 1426 | 2 | 2 | $11.90 | 5 d | Snapshot (price read from the product page) |
| 1N4001 diode | Adafruit | 755 | 2 | 1 x pack of 10 (10 pcs) | $1.50 | 5 d | Snapshot (price read from the product page) |
| 16 mm illuminated pushbutton, green, momentary | Adafruit | 1440 | 2 | 2 | $3.00 | 5 d | Snapshot (price read from the product page) |
| Miniature DPDT toggle, on-on, solder lugs, 1/4-40 bushing | Jameco | 21979 | 2 | 2 | $4.50 | 5 d | Snapshot (price read from the product page) |
| Diffused green 5 mm LED | Adafruit | 298 | 2 | 1 x pack of 25 (25 pcs) | $4.00 | 5 d | Snapshot (price read from the product page) |
| Diffused red 5 mm LED | Adafruit | 299 | 2 | 1 x pack of 25 (25 pcs) | $4.00 | 5 d | Snapshot (price read from the product page) |
| 220 ohm resistor, 1/4 W | Adafruit | 2780 | 12 | 1 x pack of 25 (25 pcs) | $0.75 | 5 d | Snapshot (price read from the product page) |
| 1 k resistor, 1/4 W | Jameco | 690865 | 4 | 1 x pack of 10 (10 pcs) | $0.50 | 5 d | Snapshot (price read from the product page) |
| Silicone ribbon cable, 10 wire, 28 AWG, 1 m | Adafruit | 3890 | 4 | 4 | $15.80 | 5 d | Snapshot (price read from the product page) |
| 15 in flexible 1/8 IPS gooseneck, matte black | Grand Brass | 15in. Flexible 1/8ips Goose Neck Pipe - Matte Black | 2 | 2 | $38.30 | 5 d | Snapshot (price read from the product page) |
| 1/8 IPS straight cylinder coupling, 5/8 x 5/8 in, black | Grand Brass | NE438BL | 4 | 4 | $7.04 | 5 d | Snapshot (price read from the product page) |
| 1-3/4 in x 1/8 IPS threaded nipple, zinc-plated steel | Grand Brass | 1-3/4in x 1/8ips zinc plated steel hollow nipple | 2 | 2 | $0.44 | 5 d | Snapshot (price read from the product page) |
| 1/2 in x 1/8 IPS threaded nipple, zinc-plated steel | Grand Brass | NI0-1/2X1/8 | 2 | 2 | $0.22 | 5 d | Snapshot (price read from the product page) |
| 1/8 IPS heavy-duty steel hex nut, 5/8 x 3/16 in, white zinc | Grand Brass | 1/8ips 5/8in x 3/16in heavy duty hex nut, white zinc | 4 | 4 | $0.32 | 5 d | Snapshot (price read from the product page) |
| Steel disk, 3 in dia x 1/4 in, 7/16 in center hole | Wagner Companies | D143-.44CH | 4 | 4 | $28.08 | 5 d | Snapshot (price read from the product page) |
| Brass heat-set insert, M3 x 4 mm | Adafruit | 4255 | 20 | 1 x pack of 50 (50 pcs) | $5.95 | 5 d | Snapshot (price read from the product page) |
| M3 x 8 mm pan head Phillips machine screw, zinc-plated steel | Bolt Depot | 17867 | 20 | 20 | $1.60 | 5 d | Snapshot (price read from the product page) |
| Heat-set insert, M2.5 x 4.0 mm | Printed Solid | 8307 | 8 | 1 x pack of 100 (100 pcs) | $12.99 | 5 d | Snapshot (price read from the product page) |
| M2.5 x 6 mm pan head Phillips machine screw | Bolt Depot | 17857 | 8 | 8 | $0.64 | 5 d | Snapshot (price read from the product page) |
| Little rubber bumper feet | Adafruit | 550 | 8 | 2 x pack of 4 (8 pcs) | $1.90 | 5 d | Snapshot (price read from the product page) |
| Hook-up wire set, 22 AWG stranded, 6 colours x 25 ft | Adafruit | 3111 | 1 | 1 | $19.95 | 5 d | Snapshot (price read from the product page) |
| Base top shell | Craftcloud | base-top.stl, PA12, MJF, grey (as printed) | 2 | 2 | $54.58 | 10 d | Estimate (unverified rate) |
| Base bottom plate | Craftcloud | base-bottom.stl, PA12, MJF, grey (as printed) | 2 | 2 | $26.29 | 10 d | Estimate (unverified rate) |
| Head upper shell | Craftcloud | head-upper.stl, PA12, MJF, grey (as printed) | 2 | 2 | $13.15 | 10 d | Estimate (unverified rate) |
| Head lower shell | Craftcloud | head-lower.stl, PA12, MJF, grey (as printed) | 2 | 2 | $12.00 | 10 d | Estimate (unverified rate) |
| Lens shutter slider | Craftcloud | shutter.stl, PA12, MJF, grey (as printed) | 2 | 2 | $12.00 | 10 d | Estimate (unverified rate) |
| Light-bar diffuser | Craftcloud | diffuser.stl, PETG, natural (translucent) | 2 | 2 | $12.00 | 10 d | Estimate (unverified rate) |
| Shipping (Seeed Studio) | Seeed Studio | shipping | – | 1 | $25.00 | – | Estimate |
| Shipping (PiShop.us) | PiShop.us | shipping | – | 1 | $10.00 | – | Estimate |
| Shipping (Mouser) | Mouser | shipping | – | 1 | $8.00 | – | Estimate |
| Shipping (Adafruit) | Adafruit | shipping | – | 1 | $19.80 | – | Estimate |
| Shipping (Master Electronics) | Master Electronics | shipping | – | 1 | $19.80 | – | Estimate |
| Shipping (Jameco) | Jameco | shipping | – | 1 | $9.00 | – | Estimate |
| Shipping (Grand Brass) | Grand Brass | shipping | – | 1 | $19.80 | – | Estimate |
| Shipping (Wagner Companies) | Wagner Companies | shipping | – | 1 | $19.80 | – | Estimate |
| Shipping (Bolt Depot) | Bolt Depot | shipping | – | 1 | $13.65 | – | Estimate |
| Shipping (Printed Solid) | Printed Solid | shipping | – | 1 | $13.65 | – | Estimate |
| Shipping (Craftcloud) | Craftcloud | shipping | – | 1 | $10.25 | – | Estimate |

#### Order B
| Part | Supplier | What to order | Need | Buy | Cost | Lead | How it was priced |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Raspberry Pi Zero 2 W with header | Seeed Studio | 114060102 | 19 | 19 | $416.10 | 7 d | Snapshot (price read from the product page) |
| microSD card, 32 GB, Class 10 | PiShop.us | 1363-1 | 19 | 19 | $379.05 | 5 d | Snapshot (price read from the product page) |
| Raspberry Pi Camera Module 3 Wide | Mouser | 358-SC0874 | 18 | 18 | $630.00 | 5 d | Snapshot (price read from the product page) |
| Camera cable, Standard-Mini, 38 mm (from the official Pi Zero case kit) | Adafruit | 3446 | 20 | 20 | $117.00 | 5 d | Snapshot (price read from the product page) |
| Adafruit Perma Proto Bonnet Mini Kit | Mouser | 485-3203 | 19 | 19 | $85.50 | 5 d | Snapshot (price read from the product page) |
| Adafruit I2S MEMS Microphone Breakout, SPH0645LM4H | Adafruit | 3421 | 38 | 38 | $237.88 | 5 d | Snapshot (price read from the product page) |
| Adafruit I2S 3 W Class D Amplifier Breakout, MAX98357A | Adafruit | 3006 | 19 | 19 | $101.84 | 5 d | Snapshot (price read from the product page) |
| Raspberry Pi 15 W USB-C power supply, US, black | Adafruit | 4298 | 18 | 18 | $141.66 | 5 d | Snapshot (price read from the product page) |
| Adafruit USB Type C Breakout Board, downstream | Adafruit | 4090 | 19 | 19 | $50.54 | 5 d | Snapshot (price read from the product page) |
| Adafruit Perma-Proto Quarter-sized Breadboard PCB | Mouser | 485-1608 | 18 | 18 | $71.10 | 5 d | Snapshot (price read from the product page) |
| NeoPixel Stick, 8 x 5050 RGB | Adafruit | 1426 | 19 | 19 | $101.84 | 5 d | Snapshot (price read from the product page) |
| 1N4001 diode | Adafruit | 755 | 10 | 1 x pack of 10 (10 pcs) | $1.50 | 5 d | Snapshot (price read from the product page) |
| 16 mm illuminated pushbutton, green, momentary | Adafruit | 1440 | 19 | 19 | $25.65 | 5 d | Snapshot (price read from the product page) |
| Miniature DPDT toggle, on-on, solder lugs, 1/4-40 bushing | Jameco | 21979 | 19 | 19 | $37.05 | 5 d | Snapshot (price read from the product page) |
| 220 ohm resistor, 1/4 W | Adafruit | 2780 | 95 | 4 x pack of 25 (100 pcs) | $3.00 | 5 d | Snapshot (price read from the product page) |
| 1 k resistor, 1/4 W | Jameco | 690865 | 30 | 3 x pack of 10 (30 pcs) | $1.50 | 5 d | Snapshot (price read from the product page) |
| Silicone ribbon cable, 10 wire, 28 AWG, 1 m | Adafruit | 3890 | 37 | 37 | $131.72 | 5 d | Snapshot (price read from the product page) |
| 15 in flexible 1/8 IPS gooseneck, matte black | Grand Brass | 15in. Flexible 1/8ips Goose Neck Pipe - Matte Black | 18 | 18 | $344.70 | 5 d | Snapshot (price read from the product page) |
| 1/8 IPS straight cylinder coupling, 5/8 x 5/8 in, black | Grand Brass | NE438BL | 36 | 36 | $63.36 | 5 d | Snapshot (price read from the product page) |
| 1-3/4 in x 1/8 IPS threaded nipple, zinc-plated steel | Grand Brass | 1-3/4in x 1/8ips zinc plated steel hollow nipple | 18 | 18 | $3.96 | 5 d | Snapshot (price read from the product page) |
| 1/2 in x 1/8 IPS threaded nipple, zinc-plated steel | Grand Brass | NI0-1/2X1/8 | 18 | 18 | $1.98 | 5 d | Snapshot (price read from the product page) |
| 1/8 IPS heavy-duty steel hex nut, 5/8 x 3/16 in, white zinc | Grand Brass | 1/8ips 5/8in x 3/16in heavy duty hex nut, white zinc | 36 | 36 | $2.88 | 5 d | Snapshot (price read from the product page) |
| Steel disk, 3 in dia x 1/4 in, 7/16 in center hole | Wagner Companies | D143-.44CH | 36 | 36 | $227.52 | 5 d | Snapshot (price read from the product page) |
| Brass heat-set insert, M3 x 4 mm | Adafruit | 4255 | 170 | 4 x pack of 50 (200 pcs) | $23.80 | 5 d | Snapshot (price read from the product page) |
| M3 x 8 mm pan head Phillips machine screw, zinc-plated steel | Bolt Depot | 17867 | 200 | 200 | $6.56 | 5 d | Snapshot (price read from the product page) |
| M2.5 x 6 mm pan head Phillips machine screw | Bolt Depot | 17857 | 72 | 100 | $3.21 | 5 d | Snapshot (price read from the product page) |
| Little rubber bumper feet | Adafruit | 550 | 72 | 18 x pack of 4 (72 pcs) | $15.48 | 5 d | Snapshot (price read from the product page) |
| Base top shell | Craftcloud | base-top.stl, PA12, MJF, grey (as printed) | 18 | 18 | $491.24 | 10 d | Estimate (unverified rate) |
| Base bottom plate | Craftcloud | base-bottom.stl, PA12, MJF, grey (as printed) | 18 | 18 | $236.63 | 10 d | Estimate (unverified rate) |
| Head upper shell | Craftcloud | head-upper.stl, PA12, MJF, grey (as printed) | 20 | 20 | $131.52 | 10 d | Estimate (unverified rate) |
| Head lower shell | Craftcloud | head-lower.stl, PA12, MJF, grey (as printed) | 20 | 20 | $120.00 | 10 d | Estimate (unverified rate) |
| Lens shutter slider | Craftcloud | shutter.stl, PA12, MJF, grey (as printed) | 20 | 20 | $120.00 | 10 d | Estimate (unverified rate) |
| Light-bar diffuser | Craftcloud | diffuser.stl, PETG, natural (translucent) | 20 | 20 | $120.00 | 10 d | Estimate (unverified rate) |
| Shipping (Seeed Studio) | Seeed Studio | shipping | – | 1 | $25.00 | – | Estimate |
| Shipping (PiShop.us) | PiShop.us | shipping | – | 1 | $10.00 | – | Estimate |
| Shipping (Mouser) | Mouser | shipping | – | 1 | $8.00 | – | Estimate |
| Shipping (Adafruit) | Adafruit | shipping | – | 1 | $37.10 | – | Estimate |
| Shipping (Jameco) | Jameco | shipping | – | 1 | $9.00 | – | Estimate |
| Shipping (Grand Brass) | Grand Brass | shipping | – | 1 | $68.60 | – | Estimate |
| Shipping (Wagner Companies) | Wagner Companies | shipping | – | 1 | $72.15 | – | Estimate |
| Shipping (Bolt Depot) | Bolt Depot | shipping | – | 1 | $13.65 | – | Estimate |
| Shipping (Craftcloud) | Craftcloud | shipping | – | 1 | $10.25 | – | Estimate |

## Engineer checks (0 failed, 9 flagged)
| | Check | Result |
| --- | --- | --- |
| ⚑ | Children's product and radio rules | For ages 6-14 this is a children's product in the US: CPSIA applies (third-party lab tests for lead in substrates and surface coatings, a Children's Product Certificate, permanent tracking labels on the unit and the box). Toy status is undecided: if CPSC would call it a toy, ASTM F963 applies too (and phthalate limits). Radio: Raspberry Pi Zero 2 W on-board 2.4 GHz Wi-Fi and Bluetooth 4.2 (Raspberry Pi states modular compliance certification); the finished unit still needs FCC Part 15 (15B unintentional-radiator testing, module FCC ID on the label; the speaker pair running 690 mm up the arm is the likeliest emitter). EU: CE under RED (radio, EMC, safety), RoHS, and the Toy Safety Directive if it is a toy. Data from children (camera, voice) also brings COPPA, which is software and policy, not hardware. Decision needed before units go to a school (it does not block building them): whether the pilot units need the CPC and FCC steps. The base underside carries a moulded supply warning and a unit-number field; a printed tracking label with the module FCC ID is still to be designed. |
| ✓ | Every part the design needs is in the BOM | All required roles present |
| ⚑ | 5 V load fits the supply with margin | 2086 mA worst case with the amp at full output and the light bar white (pi 635, camera 250, amp 738, mics 1, cameraLed 10, muteLed 7, statusLeds 432, buttonLed 13) x1.25 = 2607 mA vs 3000 mA (supply 3000, USB-C input 3000). Camera figure is an allowance: Raspberry Pi publishes none. Amp efficiency 85 % is an estimate for 4 ohm. The USB-C input figure has no source: 3 A is what USB-C receptacles are built for; Adafruit gives no current rating for the 4090 breakout, only that its 5.1 k CC resistors ask the source for up to 1.5 A by default. Load-test the first unit at full volume, light bar white and camera streaming. |
| ⚑ | The Pi in the head still sees enough voltage after the supply cable, the base wiring and the arm harness | Typical (supply 5.1 V, amp capped at 2.5 W, light bar at 50 %): 1708 mA in, 1480 mA up the arm, 4.77 V at the head. Worst (supply at its -5 % load-regulation limit, 4.84 V; amp at 3.2 W on its x2 sine peaks; light bar white): 2824 mA in, 2379 mA up the arm, 4.31 V. Minimum 4.75 V (USB 2.0 VBUS low limit). Resistance: supply cable 0.063 ohm, USB-C contacts and base feed 0.043 ohm, harness 0.101 ohm (3+3 x 28 AWG, 690 mm). Measure 5V at the bonnet on the first unit with the volume at full, the light bar white and the camera streaming, and read `vcgencmd get_throttled`. If it dips, lower the volume or brightness caps, or run a 22 AWG pair (from the hook-up wire set) through the arm beside the ribbon if the bore allows. |
| ✓ | Camera sees a whole Letter / A4 page in front of the base | Lens 220 mm up, 64.0 mm past the base front, tilted 15 deg; page 216 x 297 mm from 10.0 mm in front of the base. Along the page the corners need +/-32.8 of +/-51.0 deg, across +/-28.5 of +/-33.5 deg (margin 18.2 / 5.0 deg, need 2) |
| ✓ | Whole page is inside the focus range and sharp enough for pencil handwriting | Nearest page point 220 mm (focus from 50 mm). Far corner at full 4608 x 2592: 7.1 px/mm across, 5.7 px/mm along (need 4, about 102 dpi). Lens distortion not modelled. |
| ✓ | Does not tip with the head reaching over the page | Mass 1075 g (base 218 + ballast 425 + arm 320 + head 112). Centre of mass at x 19.9, y 13.9 mm; tipping lines at the feet x +/-65, y +/-40 mm: 26.1 mm inside (need 15) |
| ⚑ | Stays up if a child pulls the gooseneck straight out | Arm (381 mm) pulled straight out tips the unit forward, backward, right, left: worst backward puts the centre of mass 63.3 mm outside the feet. About 2003 g more ballast at the arm root would hold it; arm mass 320 g is an estimate (weigh the real gooseneck). Accepted for the pilot: the unit falls over on the desk rather than off it, and there is no room for that much steel. Say so to teachers, and check it in the first-unit tip test. |
| ⚑ | Does not tip when someone presses or pushes the head | 1075 g with its centre of mass 26.1 mm inside the front feet. Pressing down on the head (74.0 mm past the front feet) tips it at 3.7 N; a push at head height (234 mm) tips it at 1.2 N forward, 2.4 N backward, 2.0 N sideways. Design loads: 5 N down, 2 N sideways. Bending a gooseneck takes more force than this, so the base must be held with the other hand while the arm is adjusted (the build plan and the teacher notes in design.md say so). More steel does not fit under the junction board; a wider or deeper base, or the arm root further back, would fix it in the next version. |
| ⚑ | Survives a fall from desk height | No check here can show it. A 1075 g unit falling 760 mm lands with about 8.0 J. Weak points: the 2 mm head top that the arm nipple clamps (nut inside, coupling outside), the camera held by hot glue on its pins, the junction board on two staked pins, and the PA12 base corners. Test the first unit: drop it from desk height onto the head, then onto a base corner, then run the unit test sheet. Record the result in the build log before building the other units. |
| ✓ | Gooseneck is long enough to reach the design pose | The arm leaves the base coupling (top 57.3 mm up) pointing straight up and enters the head's top coupling (106.5 mm forward, 262.7 mm up) pointing 15 deg off straight down, a turn of 165 deg. At a 40 mm minimum bend radius, with 12.7 mm rigid threaded ends and 7.9 + 10.0 mm inside the couplings, it needs 335 mm; the gooseneck is 381 mm, which still fits up to a 58 mm bend radius. Bend radius and end lengths are estimates (Grand Brass publishes neither); measure them on the first gooseneck. |
| ✓ | Camera cable reaches the Pi without a long loose loop | 38 mm cable; the path in the head is about 32 mm (the 20 mm gap between the Pi's camera connector and the camera's FPC edge, a 6 mm drop, about 4 mm into each connector), so 36 to 47 mm works: at least 4 mm spare, at most 15 mm of loose loop, which is all the gap under the arm nut can hold. Pi and camera are both in the head, so the flat cable never enters the arm. |
| ✓ | Arm harness reaches from the base board to the head board | Cut 690 mm from 1000 mm stock; path 681 mm (arm 381 + base 80 + head 130 + pipe fittings 60 + slack 30) |
| ✓ | Harness has a conductor for every arm signal | 10 needed (3 x 5V, 3 x GND, 4 signals: SPK+, SPK-, LED, BTN) of 10 |
| ⚑ | Arm harness fits through the gooseneck bore | Bore not published by the seller. 10 x 1.2 mm wires = 11.3 mm2, which needs a 6.0 mm bore at 40% fill. Measure the first gooseneck and the nipples, then set armBoreMm. |
| ✓ | GPIO assignments don't collide (I2S, SPI status LEDs, buttons, lights) | I2S BCLK 18, I2S LRCLK 19, I2S DIN 20, I2S DOUT 21, amp SD 16, status LEDs 10, talk button 23, mute sense 24, camera light 25; status LEDs use SPI0 MOSI, so 7,8,9,10,11 stay free of other uses |
| ✓ | LEDs driven straight from a GPIO stay within the pad rating | Camera light 10 mA from GPIO25 vs 16 mA pad design limit |
| ✓ | Amplifier and speaker match | 4 ohm speaker (amp rated into 4 ohm or more); amp peak 3.2 W vs speaker 3 W rated, 4 W max. Software caps the volume at 2.5 W (the datasheet's 1 % distortion point into 4 ohm), under the rated power. |
| ✓ | Microphone mute is hardware | Miniature DPDT toggle, on-on, solder lugs, 1/4-40 bushing: pole 2 opens the mic data line and grounds GPIO20, so no audio reaches the Pi; pole 1 disconnects the mics' 3.3 V (left floating, so the clocks through the 1 k resistors can part-power them; the data cut is what makes the mute real) and lights the red light on the other throw. Software can't undo it; GPIO24 only reports it. It covers the built-in mics, not a Bluetooth headset's. |
| ⚑ | Camera-on light | Software only, by choice in this build: the green light is on GPIO25 and the client turns it on when it starts the camera. A hardware light is possible without a custom PCB: the camera connector carries the camera's power-enable line (CAM_GPIO0 on the Zero 2 W schematic), which could drive the LED through a transistor breakout from a fine wire on that pin or an FPC pass-through. The printed lens shutter is the hardware guarantee: closed means the sensor sees nothing. |
| ✓ | Tallest parts fit inside the base | 35 mm inside; button 29.4, speaker 18.3, ballast on ribs 20.7 mm |
| ✓ | Steel discs fit inside the base around the arm root, clear of the speaker | Disc radius + clearance 39.1 mm; nearest wall 41.5 mm from the root, speaker edge 50.0 mm |
| ✓ | Base nipple clamps coupling, shell, column and discs with the nut fully on, and leaves the harness room to turn out | Coupling seated at 41.4 mm (top 40 + 2 mm collar - 0.6 mm seat); nut 5.7 to 10.5 mm under the discs; harness groove floor 1.0 mm. A 44.45 mm nipple works with 7.5 to 8.8 mm screwed into the coupling (nut fully on, at least 3.4 mm under the pipe end for the harness to turn out, at least 5 mm of coupling left for the gooseneck). At the 8 mm in the build plan the pipe end is 4.9 mm up, 3.9 mm above the groove floor, and the gooseneck gets 7.9 mm. |
| ✓ | Pi screws engage the M2.5 inserts without bottoming out | M2.5 x 6 through a 1 to 1.6 mm board reaches 4.4 to 5.0 mm into the post: a 4 mm insert over a 2 mm blind hole (6.0 mm), at least 2.5 mm of thread |
| ✓ | Shell screws engage the inserts without bottoming out | M3 x 8 through a 3 mm flange: 5.0 mm into a 4 mm insert with 2 mm blind hole below |
| ⚑ | No small parts a child can detach | Could come off and fit the 31.7 mm test cylinder: Little rubber bumper feet (adhesive, in 2 mm pockets). Small but captive or fixed: sd, talk, mute, ledcam, ledmute, coupling, shutter. The 16 CFR 1501 ban covers under-3s only, so it does not apply at ages 6+, but younger siblings will be near it. |

## Assembly
1. First article. Order A (order-a.csv) buys parts for 2 units. Build both with these steps, then check every item below and write what you measure into design.json; rerun `distinta cad ponder` and `distinta all ponder`, and place order B (order-b.csv) only when every item passes. Gooseneck: hollow, male 1/8 IPS thread at both ends, mass (320 g assumed), the rigid threaded length at each end (12.7 mm assumed) and the tightest bend it holds (40 mm radius assumed). Bore: the 10-wire harness pulls through the gooseneck and both nipples by hand (it needs about 6 mm). Nipple thread OD (10.29 mm assumed): it passes the 11 mm arm holes without forcing. Base stack: with the nipple 8 mm into the coupling and the nut tight, its lower end is at least 3.4 mm above the groove floor and the gooseneck still gets 5 mm or more of thread in that coupling. Head: the camera's holes sit on the four pins, the lens clears the closed shutter, the 38 mm cable reaches both connectors without strain, the toggle body (13.2 x 13.2 mm assumed) clears the camera with the head closed, the SD card goes in and out, the mic sound holes are centred on the ports, and the M2.5 screws clamp the Pi without bottoming. Base: the junction board drops onto its posts, the USB-C socket is centred in the back-wall opening, the speaker (18.3 mm tall) sits in its ring, and the feet fit their 8.4 x 2 mm pockets. Inserts: an M3 screw tightened into an insert in a 4.0 mm hole does not spin it. Kits: the bonnet kit's 2x20 header is female (it must press onto the Pi's male header) and the Seeed Basic Kit contents are listed; if the kit includes an SD card or a supply, drop that line from order B. Electrical, from the test sheet (step 34): 5 V at the bonnet stays at 4.75 V or more, the USB-C meter reads 2.6 A or less, and `vcgencmd get_throttled` reads 0x0. Wi-Fi: with the head closed, `iw dev wlan0 link` reads no more than about 10 dB below a bare Zero 2 W in the same spot. Mechanical: the drop and tip tests in step 35 pass.
2. Tools: soldering iron with a fine tip plus M3 and M2.5 heat-set insert tips; multimeter with a continuity beeper; USB-C power meter; digital calipers; a 1 g kitchen scale; drill bits or pin gauges from 5 to 8 mm to gauge the bore; flush cutters; wire strippers for 22 to 28 AWG; Phillips #0 and #1 screwdrivers; a 5/8 in wrench for the nuts; soft-jaw pliers or a strap wrench for the round couplings; a deburring tool for the nipple ends; a 0.5 mm steel pull wire or fish tape at least 500 mm long; tweezers; a PCB holder; a set square; a luggage scale for the tip test; a hot-glue gun; a heat gun; a computer with Raspberry Pi Imager and a microSD reader.
3. Consumables for 20 units (not in the order list or the total): lead-free solder 0.5 to 0.8 mm (about 50 g) and a flux pen; hot-glue sticks (about 20); medium-strength threadlocker such as Loctite 243 (10 ml); polyimide (Kapton) tape 12 to 20 mm wide (1 roll); heat-shrink assortment 1.5 to 6 mm; 1 mm double-sided foam tape (1 roll); paper tape for tape flags; a white paint marker; isopropyl alcohol.
4. Before building, ask the school's IT staff: is there a 2.4 GHz network the Pi can join (the Zero 2 W has no 5 GHz), is it WPA2-Personal or WPA2-Enterprise, must devices be registered by MAC address, and can the Ponder backend host be allowlisted. The unit test sheet needs the answer.
5. Golden SD card, step 1 of 4. In Raspberry Pi Imager pick Raspberry Pi Zero 2 W and Raspberry Pi OS Lite (64-bit). In the settings set hostname ponder-00, a user, your SSH key and Wi-Fi country US, and the school network if it is WPA2-Personal. Write and verify, then edit config.txt on the card's boot partition: add `dtoverlay=googlevoicehat-soundcard`, `dtparam=spi=on` and `core_freq=250` (the Zero 2 W has the Pi 3's SoC, whose SPI clock follows the core clock and would upset the NeoPixel timing), and comment out `dtparam=audio=on` so the voice card is the only sound card.
6. Golden SD card, step 2 of 4. Boot it in the first unit's Pi (or any Zero 2 W) and run `sudo apt update && sudo apt install -y sox python3-picamera2 python3-venv rpicam-apps-lite`, then make a venv at /opt/ponder/venv and `pip install adafruit-circuitpython-neopixel-spi` in it. Find the voice card's name with `aplay -l`. Write /etc/asound.conf so the default device is that card by name, played through a softvol control with `max_dB -1.1` (caps the amp at 2.5 W of its 3.2 W) and recorded straight from the card. If the school uses WPA2-Enterprise, add the network now with `nmcli` (802-1x settings from IT).
7. Golden SD card, step 3 of 4: keep frames and audio off the card. Turn off any swap file or partition on the SD card (`swapon --show` may list zram only), set `Storage=volatile` in /etc/systemd/journald.conf, and make /tmp a tmpfs (`findmnt /tmp` shows tmpfs). The overlay file system goes on per unit, last (step 33).
8. Golden SD card, step 4 of 4: the client. The Ponder device client is not written yet (the B0tes/ponder-tutor repo holds the web app only). When it exists, install it from a tagged release into /opt/ponder as a systemd service that reads the backend URL and a per-unit token from /etc/ponder/device.conf. It must: debounce GPIO23 (push-to-talk) in software, read mute from GPIO24, turn on GPIO25 before it starts the camera and off after it stops, drive the light bar on SPI at no more than 50 % brightness, play mono (the amp plays the left channel only), hold the camera at a fixed lens position (3.6 dioptres to start, set on the first unit), never use a Bluetooth headset's microphone (the hardware mute covers the built-in mics only), and keep frames and audio in RAM. Then shut down, copy the card to an image file with Imager or `dd`, and write that image to all 21 cards. Label each card with a unit number.
9. Check the prints. Base top, base bottom, head upper, head lower and shutter are PA12 (MJF, grey as printed); the diffuser is natural PETG. Clear loose powder out of holes and slots. The shutter should slide its full 18 mm in the head lower's track with its thumb nub through the floor slot.
10. Press in the heat-set inserts with the iron at about 220 C, square and flush: 6 x M3 in the base top bosses, 4 x M3 in the head upper bosses, 4 x M2.5 in the head lower's Pi posts.
11. Harness: cut 690 mm of the 10-wire ribbon. It is all black, so count from one edge and put a numbered tape flag on wire 1 and wire 10 at both ends, and a HEAD flag on one end. Order: 1-3 5V, 4 GND, 5 SPK+, 6 SPK-, 7 GND, 8 LED data, 9 GND, 10 BTN. Beep every wire end to end with the meter. Peel the wires apart along the middle, keeping 30 mm joined at each end so the order stays and the bundle goes round through the pipe.
12. Bonnet: solder the 2x20 header that comes with the Perma Proto Bonnet Mini onto it. All head wiring goes on the bonnet. Signal jumpers are single wires peeled from the rest of the two ribbons, cut 120 mm so the shells can lie side by side, with a tape flag naming each end. Use 22 AWG from the hook-up set for the amp's VIN and GND, in two colours kept the same on every unit.
13. Mics: put a 1 k resistor in the BCLK line from GPIO18 (pin 12) and one in the LRCLK line from GPIO19 (pin 35); both mics share these two lines after the resistors. Each mic's GND goes to GND. Join both mics' 3V pins into one wire (mic VDD) and both DOUT pins into another (mic DATA); both go to the toggle. Tie the left mic's SEL to GND and the right mic's SEL to mic VDD.
14. Mute toggle: pole 1 COM to 3V3, throw A to mic VDD, throw B to GPIO24 (pin 18) and, through 220 ohm, to the red LED's anode; red LED cathode to GND. Pole 2 COM to GPIO20 (pin 38), throw A to mic DATA, throw B to GND. Sleeve every lug in heat-shrink. With the meter, find the lever position that joins COM to throw B: that is MUTE.
15. Amp: VIN to 5V and GND to GND (22 AWG), BCLK to GPIO18 and LRC to GPIO19 (straight from the Pi pins, not through the 1 k resistors), DIN to GPIO21 (pin 40), SD to GPIO16 (pin 36). Leave its terminal block off; the speaker pair solders to its + and - pads later. Camera light: GPIO25 (pin 22) through two 220 ohm in parallel to the green LED's anode, cathode to GND. Heat-shrink the LED legs and in-line resistors.
16. Head upper, before the arm goes on: push the green LED into the front hole nearer the camera end and the red LED into the other one, from inside, and fix them with hot glue. Mount the toggle in the end-wall hole with its nut so the lever points down at the engraved MUTE in the MUTE position. Seat each mic in its pocket with its sound hole over the shell's port, and run hot glue round the board edge without covering the port.
17. Arm: deburr the inside of both nipple ends. Mark the 1-3/4 in nipple 8 mm from one end with the paint marker. Screw the 1/2 in nipple through the head upper's top hole with a nut inside and a coupling outside, and tighten. Screw the gooseneck into that coupling, the second coupling onto its lower end, and the marked end of the 1-3/4 in nipple into the second coupling up to the mark. A drop of threadlocker on every thread. Before it sets, turn the head so its long side is parallel to the base's front edge when the arm is in the pose of step 32 (check against a square).
18. Pull the harness through with the pull wire: BASE end in from inside the head upper, through the head nipple, the gooseneck and out of the bottom of the 1-3/4 in nipple. Leave 130 mm inside the head and the rest out of the bottom. Slide a 25 mm piece of 6 mm heat-shrink over the bundle where it will leave the base nipple, and shrink it.
19. Solder the harness HEAD end to the bonnet: wires 1-3 to the 5V rail (pins 2 and 4), wires 4, 7 and 9 to GND, 5 and 6 (SPK+, SPK-) to the amp's speaker pads, 8 (LED) to GPIO10 (pin 19), 10 (BTN) to GPIO23 (pin 16).
20. Head lower: drop the shutter into the camera end of its track (the end without lips), thumb nub down through the floor slot, and slide it over the window. It has to go in before the camera.
21. Camera: plug the wide (15-pin) end of the 38 mm Standard-Mini cable into the camera, contacts toward the camera board. Seat the camera lens-down on the four pins with the cable edge toward the Pi end, and hold it with a small dab of hot glue on each of the four pins. Check the shutter still slides under it.
22. Pi: push the SD card in first (it can't go in once the Pi is mounted, because the end wall is 2.5 mm away). Plug the narrow (22-pin) end of the camera cable into the Pi's camera connector, contacts toward the board, and close the latch. Screw the Pi to the four M2.5 inserts with M2.5 x 6 screws, SD end toward the end away from the camera. The cable makes one short loop between the two connectors; don't crease it.
23. Base top, upside down: fit the talk button through its hole with the ring nut inside. Press the speaker into the ring under the grille, cone toward the grille, and run hot glue round its rim. Glue the diffuser into the light-bar slot from inside (flange against the top skin), lay the NeoPixel stick in its frame behind it with the LEDs toward the diffuser, and run hot glue along both long edges of the stick onto the frame rails so it can't drop when the base is turned over.
24. Arm root: from the outside, push the 1-3/4 in nipple through the base top's arm hole and column until the coupling sits in its seat on the collar. Cover the top face of one steel disc with Kapton, leaving the centre hole clear. Thread the harness tail through that disc (Kapton face toward the shell), then the second disc, then a nut, and let them hang on the wires for now.
25. Junction board (quarter Perma-Proto): bring in USB-C VBUS and GND from the breakout on 120 mm of 22 AWG each (the two power colours), with a strain-relief loop at the breakout, and the harness's 5V (1-3) and GND (4, 7, 9). From 5V, the 1N4001 (stripe toward the stick) to the stick's 5V, and 220 ohm to the talk button's LED anode. GND to the stick's GND, the button LED's cathode and one button leg. Harness LED wire (8) through two 220 ohm in series to the stick's DIN, as close to the stick as the wire allows; BTN (10) to the other button leg; SPK+ and SPK- (5, 6) to the speaker. Trim every lead flush on the solder side and cover that side with Kapton.
26. Press the junction board onto its two posts and heat-stake the pins: touch each pin tip with the flat of the iron until it mushrooms over the hole. Then slide the discs and the nut up the wires onto the nipple and run the nut up tight with the wrench, so coupling, shell, column and discs clamp together; hold the gooseneck with the strap wrench so it doesn't twist. The Kapton face of the top disc now sits about 2.8 mm under the board's Kapton-covered solder side.
27. Set the USB-C breakout in the cradle on the bottom plate with its socket in the back-wall opening and fix it with hot glue on the cradle walls, so plugging in can't move it. Lay the harness tail in the groove under the nipple and out through the gap in the disc ring.
28. Before first power, with the bonnet unplugged from the Pi and no supply connected, beep with the meter: harness 5V to GND at the bonnet is not a short (the reading climbs as the capacitors charge); the BTN and LED wires show no continuity to 5V; BTN shows continuity to GND only while the talk button is held; bonnet 3V3 to GND is not a short. Fix anything that fails before going on.
29. First power, bonnet still off the Pi: plug in the 15 W supply through the USB-C meter. At the bonnet's header, pins 2 and 4 read 4.9 to 5.1 V, the LED and BTN pins read under 1 V, and the 3V3 pins read 0 V. Unplug, press the bonnet onto the Pi's header, and stick the amp flat on top of the bonnet over the middle of the Pi with a square of 1 mm foam tape.
30. Close the head: bring the lower shell up under the upper so the lip seats all round with no wire across it, then drive 4 x M3 x 8 up through the wells in the lower shell into the inserts. Check the shutter nub still slides.
31. Close the base: fit the bottom plate with 6 x M3 x 8 up through its counterbored holes, with no wire under the lip. Stick the four rubber feet into their pockets. Write the unit number in the engraved UNIT NO. field with the paint marker.
32. Pose: hold the base down on the desk with one hand and bend the gooseneck with the other (the unit tips at about 1 to 2 N at the head otherwise) to the design pose: lens 220 mm above the desk and 120 mm in front of the arm root, head nose-down about 15 deg, long side parallel to the base's front edge.
33. Per-unit software: boot, then set the hostname to ponder-NN (`sudo raspi-config nonint do_hostname ponder-NN`), write the backend URL and this unit's token into /etc/ponder/device.conf, record the Wi-Fi MAC (`cat /sys/class/net/wlan0/address`) for IT, turn on the overlay file system (`sudo raspi-config nonint do_overlayfs 0`) and reboot.
34. Unit test sheet (every unit; write each result in the build log). Load: run a 10 minute soak with the camera streaming (`rpicam-vid -t 600000 --nopreview -o /dev/null`), a tone through the speaker (`speaker-test -c 2 -t sine -f 440`) and the light bar white; every minute read `vcgencmd measure_temp` and `vcgencmd get_throttled`, and measure 5V at the bonnet with the meter. Pass: under 80 C, get_throttled 0x0 at the end, 5V at 4.75 V or more (if it dips, lower the volume or brightness cap). Light bar: a sweep script lights each of the 8 pixels red, green, blue and white in turn, at idle and during the soak. Page: put a Letter test page with pencil text in all four corners and the middle in front of the base, open the shutter, take `rpicam-still --lens-position 3.6 -o test.jpg`, copy it off with `scp`, and read every corner at full resolution. Closed shutter: the image is black. Mics: record 5 s of stereo while talking (`arecord -c 2 -r 48000 -f S32_LE -d 5 t.wav`), then compare `sox t.wav -n remix 1 stat` and `remix 2 stat`: both channels carry the voice, within about 6 dB. Speak at a normal voice from 60 cm and check it is clearly heard on playback. On MUTE: the red light is on, both channels are silent, and GPIO24 reads high (`pinctrl get 24`). Speaker: at the volume cap a spoken prompt is clear from 60 cm. Lights and button: `pinctrl set 25 op dh` lights the green light; after `pinctrl set 23 ip pu`, `pinctrl get 23` reads lo while the talk button is held. Wi-Fi: `iw dev wlan0 link` shows the school network with the head closed.
35. First article only, after its test sheet passes: tip test, pressing down on the head and pushing it sideways at head height with a luggage scale (the checks say it tips at about 3.7 N down and 1.2 to 2.4 N at head height; record what it takes). Drop test: drop the unit from desk height (760 mm) onto the head, then onto a base corner, then run the test sheet again. Record any crack, loose part or failed test, and fix the design before order B.
36. Close the shutter, put the unit in its box with its supply (use only the supplied adapter, as the base says), and record the unit number, SD card, Wi-Fi MAC, test results and date in the build log. Tell the teacher to hold the base when moving the arm.

### What goes on at each step (from the figure)
Open `view.html` and walk the steps with ← → (or choose one under Build), or open `view.html#step=<n>` for one.

| Step | Do | Parts |
| --- | --- | --- |
| 1 | Check the prints | 1 × Base bottom plate, 1 × Head lower shell |
| 2 | Press in the 14 heat-set inserts | 10 × Brass heat-set insert, M3 x 4 mm, 4 × Heat-set insert, M2.5 x 4.0 mm |
| 3 | Fit the LEDs, toggle and mics | 3 × 220 ohm resistor, 1/4 W, 2 × Adafruit I2S MEMS Microphone Breakout, SPH0645LM4H, 1 × Miniature DPDT toggle, on-on, solder lugs, 1/4-40 bushing, 1 × Diffused red 5 mm LED, 1 × Diffused green 5 mm LED |
| 4 | Screw the arm together | 1 × 1-3/4 in x 1/8 IPS threaded nipple, zinc-plated steel, 2 × 1/8 IPS straight cylinder coupling, 5/8 x 5/8 in, black, 1 × 1/8 IPS heavy-duty steel hex nut, 5/8 x 3/16 in, white zinc, 1 × 1/2 in x 1/8 IPS threaded nipple, zinc-plated steel, 1 × 15 in flexible 1/8 IPS gooseneck, matte black |
| 5 | Pull the harness through the arm | 1 × Silicone ribbon cable, 10 wire, 28 AWG, 1 m |
| 6 | Slide the shutter into its track | 1 × Lens shutter slider |
| 7 | Seat the camera on its pins | 1 × Raspberry Pi Camera Module 3 Wide, 1 × Camera cable, Standard-Mini, 38 mm (from the official Pi Zero case kit) |
| 8 | SD card in, screw the Pi down | 1 × microSD card, 32 GB, Class 10, 1 × Raspberry Pi Zero 2 W with header, 4 × M2.5 x 6 mm pan head Phillips machine screw |
| 9 | Fit button, speaker, light bar | 1 × Speaker, 40 mm, 4 ohm, 3 W, 1 × NeoPixel Stick, 8 x 5050 RGB, 1 × 16 mm illuminated pushbutton, green, momentary, 1 × Light-bar diffuser |
| 10 | Thread the discs and nut on | 1 × 1/8 IPS heavy-duty steel hex nut, 5/8 x 3/16 in, white zinc, 2 × Steel disk, 3 in dia x 1/4 in, 7/16 in center hole |
| 11 | Wire the junction board, fit it | 1 × Adafruit Perma-Proto Quarter-sized Breadboard PCB, 1 × 1N4001 diode, 3 × 220 ohm resistor, 1/4 W, Silicone ribbon cable, 10 wire, 28 AWG, 1 m |
| 12 | Glue the USB-C board in | 1 × Adafruit USB Type C Breakout Board, downstream |
| 13 | Bonnet onto the Pi, amp on top | 1 × Adafruit Perma Proto Bonnet Mini Kit, 1 × Silicone ribbon cable, 10 wire, 28 AWG, 1 m, 1 × Adafruit I2S 3 W Class D Amplifier Breakout, MAX98357A, 2 × 1 k resistor, 1/4 W |
| 14 | Close the head with 4 screws | 4 × M3 x 8 mm pan head Phillips machine screw, zinc-plated steel, 1 × Head upper shell |
| 15 | Close the base, then the feet | 4 × Little rubber bumper feet, 6 × M3 x 8 mm pan head Phillips machine screw, zinc-plated steel, 1 × Base top shell |

## Files
In production/ these sit next to this plan; in the product folder they are at the paths shown.
- Base top shell: `base-top.stl` (`fab/base-top.stl`)
- Base bottom plate: `base-bottom.stl` (`fab/base-bottom.stl`)
- Head upper shell: `head-upper.stl` (`fab/head-upper.stl`)
- Head lower shell: `head-lower.stl` (`fab/head-lower.stl`)
- Lens shutter slider: `shutter.stl` (`fab/shutter.stl`)
- Light-bar diffuser: `diffuser.stl` (`fab/diffuser.stl`)
