<div align="center">

<img src="public/logo.png" alt="Vibe City Kolkata" width="520" />

### An open-world Kolkata you can play in the browser

From Howrah Station, over Howrah Bridge, to Park Street. Built from real OpenStreetMap data.

<br />

[![Play now](https://img.shields.io/badge/▶_PLAY_NOW-vibecityy.vercel.app-ff3fa4?style=for-the-badge)](https://vibecityy.vercel.app)
[![Watch gameplay](https://img.shields.io/badge/▶_WATCH_GAMEPLAY-YouTube-ff0000?style=for-the-badge&logo=youtube&logoColor=white)](https://youtu.be/INbQ_OAFwJQ)

![Three.js](https://img.shields.io/badge/Three.js-r170-8b3bff?style=flat-square&logo=threedotjs&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-ff7a3d?style=flat-square&logo=vite&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES_modules-ffb02e?style=flat-square&logo=javascript&logoColor=black)
![WebGL 2](https://img.shields.io/badge/WebGL-2-ff3fa4?style=flat-square&logo=webgl&logoColor=white)
![OpenStreetMap](https://img.shields.io/badge/map-OpenStreetMap-7ebc6f?style=flat-square&logo=openstreetmap&logoColor=white)

<sub>
<a href="#-all-the-features-at-a-glance">At a glance</a> ·
<a href="#-quick-start">Quick start</a> ·
<a href="#%EF%B8%8F-the-map">The map</a> ·
<a href="#-controls">Controls</a> ·
<a href="#-features">Features</a> ·
<a href="#%EF%B8%8F-tech-stack">Tech stack</a> ·
<a href="#-project-structure">Project structure</a>
</sub>

</div>

<br />

Walk, drive, ride and fight your way from **Howrah Station** across **Howrah Bridge** to B.B.D. Bagh, Esplanade, the Maidan, Victoria Memorial and Park Street, through the lanes of north Kolkata and out to Sealdah. Take a yellow taxi, a tram, an EMU local or the Rajdhani, go underground on the Metro's Blue and Green lines (under the Hooghly), or cross the river on a ferry launch. The clock and the weather are Kolkata's own, live: if it's night and pouring in Kolkata, it's night and pouring in the game.

> [!NOTE]
> No backend and no server. Apart from the map data, the logo and the recorded Bengali voice lines, every building, vehicle, person, texture and sound is generated in code when the game loads. The only network call is for Kolkata's live weather (Open-Meteo, no API key).

<table>
<tr>
<td width="33%" valign="top">

**🗺️ The real city**<br />
~25,000 buildings, every street, the Hooghly and ~600 named places, at true scale (1 unit = 1 metre).

</td>
<td width="33%" valign="top">

**🚋 Every way to get around**<br />
Ambassador taxis, autos, hand-pulled rickshaws, buses, trams, EMU locals, the Rajdhani, both Metro lines and ferries.

</td>
<td width="33%" valign="top">

**🌦️ Kolkata time and weather**<br />
Runs on the real IST clock and Kolkata's live weather: monsoon rain, wet roads, thunderstorms. At night, Howrah Bridge and Vidyasagar Setu light up.

</td>
</tr>
<tr>
<td valign="top">

**🗣️ Bengali voices**<br />
Locals chat out loud in Bengali: <i>"Ki khobor, dada?"</i>

</td>
<td valign="top">

**🎫 Station life**<br />
Ticket windows, cha and phuchka stalls, real platform numbers, live departure boards, Metro fare gates, and a TTE who fines you ₹250.

</td>
<td valign="top">

**🏎️ Drive, ride or fight**<br />
Drifts, nitro, damage, seven weapons, and a GPS that keeps to one-way streets.

</td>
</tr>
</table>

---

## 🌟 All the features at a glance

The short version of everything in the game. Details are in [Features](#-features) below.

**The city**
- 🗺️ **Real Kolkata from OpenStreetMap** at true scale (1 unit = 1 metre): ~25,000 buildings, every street, the Hooghly, ponds, parks and ~600 named places, from Howrah to Park Street and Sealdah.
- 🏛️ **Landmarks modelled in code:** Howrah Bridge, Vidyasagar Setu, Howrah Station, Victoria Memorial, Shaheed Minar, Eden Gardens, St Paul's, Nakhoda Masjid, Writers' Building and more.
- 🎨 **Kolkata's look:** ochre and pink walls with green shutters, black water tanks on the roofs, black-and-yellow kerbs, hawkers' stalls under coloured tarps.

**Live, like the real city**
- 🕰️ **Real Kolkata time:** day in Kolkata is day in the game, and at night the bridges light up.
- 🌧️ **Real Kolkata weather:** live from Open-Meteo. Monsoon rain, wet roads that dry slowly, lightning and thunder, with the temperature under the clock.
- 🚉 **Live departure boards:** arrival times worked out from where each train really is.

**Getting around**
- 🚕 **Kolkata's own vehicles:** the yellow Ambassador taxi, autos, hand-pulled rickshaws, WBTC and private buses, plus cars, bikes and trucks. Traffic keeps left and obeys one-way streets.
- 🚋 **Trams, EMU locals and the Rajdhani** on the real lines, stopping at real stations with real platform numbers.
- 🚇 **Metro Blue and Green lines**, including the tunnel **under the Hooghly**, with twin tracks, sliding doors, platform screen doors, fare gates and next-train countdowns.
- ⛴️ **Refined River Fleet:** Ganga ferry launches, traditional wooden country boats (nouka), speedboats, and jet skis, all upgraded with authentic lifebuoys, tire fenders, brass horns, searchlights, bamboo chhoi, and lanterns.
- 🚢 **River Cargo Ships & Fishing Trawlers:** Large 58m container cargo ships with colorful container stacks and deck cranes, plus Bay of Bengal fishing trawlers with stern A-frame gantries, net winch drums, and outriggers—both driveable and cruising the Hooghly in autonomous traffic lanes.
- 🚇 **Discovered Metro & Ferry Fast-Travel (M):** Click any discovered Metro station or Ferry Ghat on the full-screen map to fast-travel across the city for ₹20 with an authentic station chime.
- 🎟️ **Ride or drive anything:** F to drive, V to ride as a passenger. Hire a taxi, auto or rickshaw to any place on the map and pay the meter; take a bus with route boards, a train, tram, Metro or ferry and pay the fare. You can even drive the trains, trams and Metro yourself.
- 🧭 **GPS and search:** search any place, station or ghat, and the route follows one-way streets.

**Station life**
- 🫖 **Howrah Station:** buy a ticket, eat cha, jhalmuri, phuchka and mishti, and dodge the TTE who fines you ₹250 for riding without a ticket.
- 📰 **The Calcutta Chronicle Broadsheet:** Buy today's newspaper at the A.H. Wheeler stall (₹5) to open an authentic, interactive vintage broadsheet with procedurally generated headlines (Kolkata Derby updates, tram preservation debates, monsoon deluges, underwater Metro milestones), live weather & Ganga tide tables, Dada's satirical pocket cartoons, the Rosogolla commodity index, and humorous classifieds.
- 🚌 **Dharmatala bus stand** with real routes to Howrah, Sealdah, Shobhabazar, Park Circus and more.

**People**
- 🗣️ **Locals speak Bengali out loud** ("Ki khobor, dada?") with recorded voices, and give real directions ("Esplanade kon dike?").
- 💃 **Gestures:** wave, point, cheer, and start a **dance party** that the crowd joins.

**Gameplay**
- 💼 **Taxi & Courier duty:** pick up fares in taxis and autos, or deliver urgent food orders, parcels and book bundles in bikes, rickshaws and vans (**B**). Beat the clock, earn speed tips and build streaks.
- 📻 **Multi-Station Procedural Radio ([ and ]):** Switch between three procedurally synthesized Web Audio stations with zero asset downloads:
  - **Synthwave 96 (96.0 FM):** High-tempo retro synth driving track.
  - **AIR Kolkata (657 kHz AM):** Akashvani classical sitar & flute drone, morning raga meend, and vintage AM crackle.
  - **Park Street Disco (104.2 FM):** Funky 118 BPM 80s Bollywood/Bangla disco slap-bass groove and 4-on-the-floor beat.
- ☕ **The "Adda" & Street Bench Mechanic (E):** Walk up to wooden park benches and roadside tea stalls along Prinsep Ghat, Maidan, Victoria Memorial, and College Street to sit down, sip clay-bhar cha, regenerate health, accelerate time (12x timelapse) to watch sunsets, and listen to local philosophical dialogues.
- 🔴 **Kolkata Adda Carrom (E):** Challenge local uncle champions to authentic carrom games beside adda benches at Esplanade, College Square, and Allen Park. Features sub-stepped 2D disc physics, authentic Queen cover rules, baseline striker sliding (A/D), mouse aiming, hold-to-charge striker flicks (SPACE), AI opponents with Bengali commentary, ₹20 stakes to win ₹50, and the *Carrom King* achievement.
- 🪔 **Durga Puja / Festive Mode:** Toggle festive illuminations in the pause menu (**FESTIVE: ON / OFF**). Dresses Howrah Bridge and Park Street with thousands of colourful, twinkling fairy light swags and hanging light curtains, paired with a dynamic procedural Web Audio **dhak** drum rhythm (*dha – kur-kur – ta – dha*) that grows louder as you approach festive areas.
- 📸 **Heritage Photo Mode (P):** freeze the city in time, orbit the camera freely, adjust zoom, height and filters (Normal, Vintage, Monsoon, Golden, Noir), and download watermark-stamped high-res snapshots.
- 🏆 **Progress that's saved:** places discovered, 24 achievements, earnings, deliveries and your best streak.
- 🏎️ **Driving:** drifts, nitro, weight transfer, damage, fire and explosions.
- 🔫 **Combat:** seven weapons, a punch and kick combo, headshots, and a weapon wheel in slow motion.
- ❤️ **Health, ₹ money, ammo crates** and a hospital bill when you go down.

**Under the hood**
- 🧱 **Almost everything is generated in code:** every model, texture and sound effect. No backend.
- ✨ **Graphics:** bloom, ambient occlusion, a reflective river, soft shadows and procedural clouds, with Ultra/High/Medium/Low presets and auto-Low on weak GPUs.
- 🎮 **Keyboard, mouse and gamepad.**

---

## 🚀 Quick start

You need [Node.js](https://nodejs.org/) 18 or newer.

```bash
npm install      # install Three.js and Vite
npm run dev      # start the dev server, then open the printed URL
```

| Command | What it does |
|---|---|
| `npm run dev` | Starts a local dev server with hot reload |
| `npm run build` | Builds a static, production-ready site into `dist/` |
| `npm run preview` | Serves the built `dist/` folder locally |
| `npm run build:map` | Rebuilds `src/data/kolkata.json` from the OpenStreetMap files in `map-data/` |
| `npm run build:voices` | Records every Bengali line in `src/lines.js` into `public/voices/` (macOS, Bengali voice "Piya") |
| `node tools/fetch-region.mjs` | Downloads Kolkata-wide railway lines and places for the map and search (then run `npm run build:map`) |

The `dist/` folder is plain static files, so you can host it on any static host (GitHub Pages, Netlify, Vercel, itch.io and so on).

> [!TIP]
> **Time:** the game runs on the real clock in Kolkata (IST): day there is day in the game, night is night. To try another time, add `?t=HOUR` to the URL, e.g. `?t=21.5` for night (Howrah Bridge and Vidyasagar Setu light up).

---

## 🗺️ The map

The city is real: `tools/build-map.mjs` reads every OpenStreetMap export in `map-data/`, merges them, and writes `src/data/kolkata.json`.

- **Projection:** latitude/longitude are converted to metres around the centre of the downloaded area (x = east, z = south). One game unit is one real metre, so distances, street widths and building footprints are true to life.
- **What's used:** roads (with class, width, lanes, one-way and bridge tags), ~25,000 building footprints, the Hooghly's banks, ponds, tanks and canals, parks and the Maidan, railway tracks and platforms, tram lines, the Metro routes and stations, ferry routes and ghats, and ~600 named places.
- **Heights:** few buildings in OSM have a height, so the rest are estimated from type, size and district (low old houses up north, taller offices round B.B.D. Bagh and Chowringhee). Landmarks get their real heights.
- **Adding areas:** export more of Kolkata from [openstreetmap.org](https://www.openstreetmap.org) (Export → `map.osm`), drop the file into `map-data/`, and run `npm run build:map`. Anything outside the downloaded tiles is drawn as low-detail skyline.

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License.

---

## 🎮 Controls

| Key | On foot | In a vehicle |
|---|---|---|
| **W A S D** / arrows | Move (relative to the camera) | Accelerate, brake/reverse, steer |
| **Mouse** | Look around (click the screen to lock the mouse) | Look around (recentres automatically) |
| **Shift** | Sprint | Nitro boost |
| **X** | Toggle walk / jog | — |
| **Space** | Jump | Handbrake (drift) |
| **V** | Ride as a passenger: confirm a taxi/auto/rickshaw destination on the map, or choose a stop and fare for a bus, tram, train or Metro; ferries stay flat-fare | Hold **T** to hurry a hired ride along |
| **F** | Enter the nearest vehicle (you'll pull out a traffic car's driver; trams and trains must be stopped) | Exit (bail out and roll if you're going fast) |
| **E** | Buy at a station stall or ticket window; talk to a nearby person (with fists or bat in hand) | — |
| **1–7** / **mouse wheel** | Fists, Baseball Bat, Pistol, SMG, Shotgun, Assault Rifle, Sniper Rifle | — |
| **Right click** (hold) | Aim (sniper: scope). With fists: raise your guard | — |
| **Left click** / **J** | Fire, or punch / kick (a 4-hit combo) / swing the bat | — |
| Hold **Tab** | Weapon wheel (time slows while it's open) | — |
| Hold **G** | Gestures: Wave, Dance, Point, Thumbs Up, Cheer, Shrug, Flex, Laugh | — |
| **H** | — | Horn or bell (startles nearby people) |
| **B** | — | In a yellow taxi or auto: taxi duty; in a bike, rickshaw or van: courier delivery rush |
| **P** | Heritage Photo Mode: freeze time, orbit, filter, zoom and capture | Heritage Photo Mode |
| **O** | Wardrobe & Outfits Customizer (New Market & College Street tailors) | — |
| **R** | Reload | Reset the vehicle onto the nearest road |
| **C** | Change camera distance | Cycle chase / far / hood camera |
| **Q** | Background music on/off | Background music on/off |
| **M** | Map: drag, scroll to zoom, click to set a waypoint, right-click to clear | Map |
| **N** | Mute everything | Mute everything |
| **Esc** | Pause (shows the full key guide) | Pause |

🎮 **Gamepads work too:** left stick to steer, triggers for throttle and brake (aim and fire on foot), D-pad left/right to switch weapons, A for handbrake, B or RB for nitro, Y to enter or exit, X to talk, LB for the camera.

---

## ✨ Features

Click a section to expand it.

<details>
<summary><b>Kolkata</b></summary>

- **Real streets:** every road from the OSM data, at its real width, with pavements, centre lines and street lights on the main roads. Traffic **keeps left**, as in India, and respects one-way streets.
- **Buildings:** all ~25,000 footprints extruded to their (estimated) heights, in a Kolkata palette: ochre, pink, cream and whitewashed walls with arched windows, louvred green shutters, balconies and monsoon streaks; shop fronts at street level on the main roads; black water tanks on the roofs. Writers' Building, the High Court and Howrah Station are red brick.
- **The Hooghly:** the river's real banks with stone embankments, a muddy, silty surface, ponds and tanks (Lal Dighi, the Fort William moat, Victoria Memorial's pools).
- **Parks and trees:** the Maidan, Eden Gardens, Victoria Memorial's gardens and every park, with banyan-like trees and coconut palms along streets and lawns.

</details>

<details>
<summary><b>Landmarks</b></summary>

Modelled in code and placed on their real footprints:
- **Howrah Bridge (Rabindra Setu):** the cantilever truss with its two 82 m towers, anchor arms, suspended span and K-bracing, a raised deck you can drive or walk across, and LED lighting at night.
- **Howrah Station:** the red-brick headhouse with six towers and clock faces facing the river, the concourse roof, and 15 platforms with sheds.
- **Victoria Memorial:** white marble, the great dome and its Angel of Victory, corner chhatris and the north porch; floodlit after dark.
- **Shaheed Minar**, **Eden Gardens** (stands and floodlight towers), **St Paul's Cathedral**, **Nakhoda Masjid** (domes and minarets) and **James Prinsep's memorial** at Prinsep Ghat.

</details>

<details>
<summary><b>Howrah Station</b></summary>

- **Ticket window** (₹10, valid five minutes) and stalls on the concourse and forecourt: **cha**, **jhalmuri**, **phuchka**, **mishti** and fruit restore health; the **A.H. Wheeler** book stall sells *The Calcutta Chronicle* broadsheet (₹5). Press **E** at a counter.
- **The TTE:** step onto the platforms without a ticket and the ticket examiner comes after you. Get caught and it's a ₹250 fine.
- **Trains:** two EMU locals and a Rajdhani Express start from Howrah's real platform tracks, two more locals from Sealdah. Each runs out along the real line and back.
- **Outside:** buses waiting at Howrah Bus Station, yellow taxis at the rank, ferries at Howrah Ghat.

</details>

<details>
<summary><b>Rail and Metro</b></summary>

- **Trams:** the three longest tram lines in the data, white with a blue stripe, under overhead wires, stopping every few hundred metres.
- **Circular Railway:** a local along the river through Prinsep Ghat, Eden Gardens, B.B.D. Bagh and Barra Bazar.
- **Kolkata Metro:** the **Blue Line** (Shobhabazar – Girish Park – MG Road – Central – Chandni Chowk – Esplanade – Park Street – Maidan – Rabindra Sadan) and the **Green Line** (Howrah Maidan – Howrah – *under the Hooghly* – Mahakaran – Esplanade – Sealdah) on their real routes. Each station is a tiled hall lined up with the track, with a stairway up to the street and a Metro sign at the entrance.
- Platform boards in **Bengali, Hindi and English**. Walk up to either cab of a stopped tram, train or metro and press **F** to drive it.

</details>

<details>
<summary><b>River</b></summary>

- **Refined Boat Visuals:** Every river vessel features authentic handcrafted nautical detailing: reflective orange lifebuoys, black rubber tire fenders with hanging hemp ropes, brass horns, searchlights, rotating radar scanners, and Indian river pennants.
- **Traditional Country Boats (Nouka):** Wooden dinghis crafted with arched bamboo chhoi canopies, clay chula cooking stoves with brass kettles, hanging kerosene hurricane lanterns, coiled coir ropes, and long steering oars (বৈঠা).
- **Ganga Ferry Launches:** Open-lower-deck passenger launches with slatted wooden seating, lifejacket chests, dual-tone roof canopies, and passenger railings.
- **Bay of Bengal Fishing Trawlers:** Authentic river-sea trawlers featuring high flared bows, heavy aft A-frame gantry cranes, winch drums with wound trawl net, outrigger trolling booms, stacked plastic fish crates, and deep diesel chug. Boardable and driveable (**F**)!
- **Hooghly River Cargo Ships:** 58-metre container feeder vessels with realistic stacks of colorful shipping containers (Maersk, Evergreen, CMA CGM, Hanjin), deck derrick crane, island bridge with wings, and smokestack funnel.
- **Living Riverway Traffic:** 5 distinct vessels cruise up and down the Hooghly in traffic lanes with starboard channel rules, floating water swell, wakes, and mass collision obstacles.

</details>

<details>
<summary><b>Vehicles</b></summary>

- **Cars:** Convertible, Sports Coupe, Sedan, Taxi and Van; **heavy and two-wheeled:** Motorbike, Pickup, Box Truck, School Bus and City Bus. Each has its own handling, mass, engine note and camera distance. West Bengal number plates.
- **Physics and damage:** mass-based collisions, weight transfer, drifts, nitro, smoke, fire and explosions: a badly damaged vehicle smokes, catches fire and blows up into a burnt-out wreck. Collisions use the real building outlines.

</details>

<details>
<summary><b>Map and navigation</b></summary>

- **Full-screen map (M):** the real streets, buildings, river, parks, railways, tram lines and both Metro lines, with neighbourhood, landmark, station and ghat names by zoom level.
- **Waypoints:** click anywhere and the GPS finds a route along Kolkata's streets, obeying one-way rules, shown on the map and minimap.
- **Search** box (top of the full map): type a place, station, ghat, tram stop or landmark and pick a result to fly there and set a waypoint.
- Metro stations (M) and tram stops (T) are marked and named on the map.

</details>

<details>
<summary><b>People</b></summary>

- **Locals** walk the pavements and footpaths of the real streets, in Kolkata looks, and talk in English and Bengali ("Ki khobor, dada?"). Talk to them, wave, start a dance, or start a fight. Gunfire sends people running and nearby traffic speeding away.

</details>

<details>
<summary><b>Gameplay</b></summary>

- **Money in ₹:** cash pickups on the pavements; spend it on fares, tickets, street food, and authentic Kolkata outfits. Eye-catching animated floating change popups (`+₹` green, `−₹` red with contextual labels) keep you informed of every transaction mid-drive.
- **Wardrobe & Outfit Customizer (O):** visit heritage tailoring hubs at New Market and College Street (or press **O** on foot) to buy and equip culturally rich attire:
  - *Classic Kurta-Pajama & Dhoti (সোনালী পাঞ্জাবি ও ধুতি)*: Ivory tussar silk with gold zari border.
  - *Yellow Taxi Driver Uniform (ট্যাক্সি চালক খাকি)*: Khaki collared uniform with Kolkata yellow cab crest.
  - *Mohun Bagan AC Jersey (মোহনবাগান সবুজ-মেরুন)*: Iconic maroon and green stripes of the Mariners.
  - *East Bengal FC Jersey (ইস্টবেঙ্গল লাল-হলুদ)*: Historic red and gold torchbearer stripes.
  - *College Street Scholar (কলেজ স্ট্রিট পণ্ডিত)*: Black Nehru waistcoat over white khadi punjabi.
  - *Zero-load architecture:* updates hex colors and dynamic in-memory 512x256 canvas print atlas (`printAtlas`) on-the-fly with 0 extra meshes or polygons.
- **Ammo crates** (under glowing beams) top up every gun.
- **Health:** a health bar that refills slowly once you've stayed out of trouble for a few seconds; street food restores it too. Go down and you wake up on the nearest pavement, minus a hospital bill (₹100 plus 5% of your cash).
- **Taxi duty:** in a yellow Ambassador or an auto, press **B**. Someone waves you down on a pavement nearby (yellow marker on the minimap); pull up beside them and they get in and name a place across town. Beat the clock without knocking them about: the fare is paid by distance, plus a tip for a smooth, quick ride (rated out of five stars) and a bonus for fares in a row. Leave the cab mid-ride and the fare is lost.
- **Progress that carries over:** taxi jobs, earnings, your rating and best streak, the places you've discovered (landmarks, stations, ghats, markets: a note pops up as you pass each one) and 14 achievements, from *Mind the Gap* to *City of Joy*. See them in the pause menu. Saved in the browser.
- **No accidental exits:** pressing the browser's Back button (or swiping back) mid-game pauses and asks *Leave Kolkata?*; only **LEAVE** actually goes back. Reloading or closing the tab gets the browser's own "Leave site?" prompt.

</details>

<details>
<summary><b>Ride or drive</b></summary>

Every vehicle offers two choices: **F** to drive it yourself, **V** to ride as a passenger.
- **Taxi, auto-rickshaw, hand-pulled rickshaw:** the driver asks "Kothay jaben, dada?" and the map opens; search or click a destination, then confirm the distance quote. The driver takes you along the streets (keeping left, waiting in traffic, honking); you pay on arrival, or the meter if you get off early. Fare rates are centralized in `src/fares.js`.
- **Bus:** choose an upcoming named stop and its distance fare before boarding; the bus runs its route along the main roads. F gets you off at your stop.
- **Trains, trams, Metro:** choose a named stop and fare before boarding. At a Metro gate, choosing the destination pays the fare and opens the gate; cancel without paying and the gate stays shut. Your stop is announced on arrival; press F to get off. Metro, local, bus and tram fare tables are centralized in `src/fares.js`. A train ticket also satisfies the TTE.
- **Ferry launch:** ₹6, get off when it docks at a ghat.

</details>

<details>
<summary><b>Stations and timetables</b></summary>

- **Departure boards** at Howrah (the big concourse board), every railway platform, every Metro platform and every tram stop: train number, destination (Bandel, Bardhaman, Krishnanagar, Canning, Dum Dum…), platform, and minutes to arrival, worked out from where each train really is, on the real Kolkata clock.
- **Real platform numbers** from OpenStreetMap: Howrah 1–23, Sealdah 1–21. Hanging PF signs over each platform show the next train's destination and time, and Howrah's big board lists the real platforms.
- **Lit at night:** tube lights under every platform canopy, Howrah's sheds and concourse roof, the station stalls, the Dharmatala bus shelters and the tram stops, each throwing a pool of light on the floor below.
- **Trains and trams** run more often: seven out of Howrah, four out of Sealdah, two on the Circular Railway, two trams a line. Every train stops properly at every station.

</details>

<details>
<summary><b>Trains and trams (Indian designs)</b></summary>

- **EMU local:** silver with a maroon band, three open doorways a side, barred windows, the flat yellow cab with its red band, a pantograph.
- **Rajdhani Express:** a WAP-7 electric locomotive and red LHB coaches with a cream stripe.
- **Kolkata tram:** WBTC white over blue, grilled windows, the white chevron, red rounded roof, route board and trolley pole.
- **Overhead catenary** masts and wires along the electrified main lines.

</details>

<details>
<summary><b>Dharmatala bus stand</b></summary>

- The Esplanade bus terminus beside Shaheed Minar: shelters, a ticket booth, and buses in their bays with route boards (12C/1 Howrah Stn, S-163 Shobhabazar, 24B Sealdah, S-101 B.B.D. Bag, RT-27 Park Circus, 213 Babughat). Press V, choose an upcoming named stop and pay its distance fare; the bus stops there.

</details>

<details>
<summary><b>More of Kolkata</b></summary>

- **Vidyasagar Setu:** the cable-stayed bridge, 457 m main span, two H pylons and fans of stays, its deck 26 m over the river.
- **Heritage buildings** on their real footprints: Writers' Building (red brick, portico, statues), Town Hall (Doric portico), Indian Museum (colonnade), New Market (Hogg Market clock tower), Birla Planetarium (dome), Marble Palace, Presidency.
- **Streets:** dark asphalt, Kolkata's black-and-yellow kerbs, white edge lines, hawkers' stalls under blue, orange and yellow tarps along the busy pavements.
- **Conversations** that make sense: ask "Esplanade kon dike?" and you're told which way and how far from where you're standing.
- **Horns** only from real vehicles near you.

</details>

<details>
<summary><b>Railways</b></summary>

- Inside the playable city: seven trains out of Howrah, two out of Sealdah plus a **Sealdah South** local via Park Circus, and the **Circular Railway** along the river, each stopping at its real stations and waiting at the terminus so there's usually one at the platform.
- **Every stop has a platform:** each stop is lined up so the whole train stands beside a mapped platform; where OpenStreetMap has none, a platform is built beside the track on the clear side (a narrow island if the next track is close), with a canopy, benches and name boards. A stop with no room for one is skipped. The Circular Railway turns round at its last stations instead of out on the line.
- On the map: the whole suburban network (Sealdah–Dankuni, Bangaon, Hasnabad, Canning, Budge Budge, Namkhana; the Howrah main lines and chord) and every Metro line in its colour, plus ~1,700 named places across the region for the search.

</details>

<details>
<summary><b>Vehicles of Kolkata</b></summary>

- **Auto-rickshaw:** the green-and-yellow three-wheeler with a black canvas hood and a two-stroke putter.
- **Hindustan Ambassador:** the yellow taxi (with its blue side stripe) and the white or black private car, with the round nose, chrome bumpers and round headlamps.
- **Buses** in four liveries: W.B.T.C. (white and blue), SBSTC (white, blue and green), and two private-bus paint jobs, each with real route boards: the front board shows the route number, the destination in Bengali and English and a VIA strip, with more boards above the side windows and the route on the windscreen and rear window. The boarding prompt and trip notice list the via stops. About a quarter of traffic is buses, and a bus you take out of traffic is replaced by another.
- **Hand-pulled rickshaw:** big wooden wheels, a hooded seat and the puller walking between the shafts. It's slow, and you can ring its bell (H).
- **Trams** in WBTC white and blue with red roofs and route boards; **EMU locals** with yellow cab fronts; **Metro** rakes in each line's colour.

</details>

<details>
<summary><b>Sound</b></summary>

- **Background music is off by default.** Toggle it with **Q** or the **MUSIC** button on the title screen and pause menu. The choice is remembered.
- **City sounds:** a traffic bed, distant honking, crowd murmur, crows by day and water near the river.
- **Engines** by kind: the Ambassador's low petrol note, buses' diesel clatter, a motorbike's buzz, the electric whine and rail-joint clack of trains, trams and the Metro, the rickshaw puller's footsteps. Each vehicle has its own horn or bell.
- **Bengali voices:** everyone speaks Bengali out loud. The speech bubble shows the romanised line ("Kemon achho?"); the voice is a Bengali recording (`public/voices/`, made with `npm run build:voices`), panned to the speaker and quieter with distance, pitched down for men. Toggle with the **VOICES** button.

</details>

<details>
<summary><b>Metro details</b></summary>

- Street entrances are grey portals with red Bengali and English station signs; blue boards over the platforms list the stations ahead, in Bengali and English.
- **Under the Hooghly:** between Howrah and Mahakaran the Green Line runs through a round bored tunnel 26 m down, with a message when you cross under the river.
- **Two tracks, Up and Down:** every station has a platform for each direction (Platform 1 and 2), each with its own stairway from the street. Past the end stations a crossover joins the tracks; trains run into a short siding, reverse out of sight and come back on the other track.
- **Frequent service:** six trains on the Blue Line (one every ~3½ minutes each way) and four on the Green Line (one every ~4 minutes), evenly spaced and kept apart on the same track.
- **Next train:** countdown displays over every platform ("NEXT TRAIN 2 MIN 15 S · THEN …", ARRIVING, ON PLATFORM), timed from where each train really is; stand on a platform and the same appears at the top of the screen.
- **Sliding doors:** trains draw up on the mark at every station, open their doors on the platform side, chime, shut them and leave. Board (**V**) or get off only while the doors are open.
- **Drive it yourself (F at either cab):** stop at a platform and the doors open by themselves; press **W** and they chime shut before the train moves.
- **Platform screen doors** on the Green Line, lined up with the train's doors and opening with them.
- **Fare gates that work:** at the foot of each stairway. Pay ₹20 at the gate (**V**) to go through, or decline (**E**) and it stays shut. Exit is free, and boarding any train is free once you've tapped in.
- **Station details:** a ticket counter, green WAY OUT (বাহির) signs pointing to the stairs, lit posters and safety notices on the walls, ad panels across the tracks.

</details>

<details>
<summary><b>Live weather</b></summary>

- **Kolkata's real weather, near enough live:** the current conditions come from [Open-Meteo](https://open-meteo.com/) (free, no API key), which updates every 15 minutes. If it's raining in Kolkata, it's raining in the game: grey monsoon sky, rain, thicker haze, soft light without shadows, wet dark roads that take a few minutes to dry, and lightning with rolling thunder in a storm. The temperature and conditions show under the clock.
- **Light on resources:** fetched once on load and then every 10 minutes, only while the tab is visible, and cached so a reload doesn't fetch again. The rain is one draw call animated entirely on the GPU, drawn only as heavily as it's raining (and less on Low), and not at all underground or when it's dry. Offline, the weather just stays as it was.
- The weather is always Kolkata's live weather. **TIME** (title screen and pause menu) only sets the clock: **REAL TIME** (Kolkata's), or always **DAY** or **NIGHT**.

</details>

<details>
<summary><b>Day and night, combat and HUD</b></summary>

- **Day and night:** the sun and moon follow the real Kolkata clock, with stars and clouds; the bridges and Victoria Memorial light up after dark. **TIME** in the title screen and pause menu switches between **REAL TIME**, always **DAY** and always **NIGHT**.
- **Seven weapons:** fists (a four-hit punch and kick combo, plus a guard), a baseball bat, pistol, SMG, shotgun, assault rifle and a scoped sniper rifle. Headshots do extra damage, guns have recoil and reloads, and holding **Tab** opens a weapon wheel in slow motion.
- **HUD:** minimap with route and markers, speedometer, health bar, weapon and ammo readout, crosshair, the clock with Kolkata's current weather and temperature, and notifications for places, jobs and achievements.
- **Opening splash:** the logo and a yellow taxi crossing the bridge while the city loads.

</details>

<details>
<summary><b>Approximations</b></summary>

- Landmarks are recognisable models at real scale, not survey-exact replicas.
- Flyovers are drawn at street level; only Howrah Bridge (and small bridges over ponds and canals) has a raised deck.
- Building heights are estimated wherever OSM doesn't record them.

</details>

---

## 🛠️ Tech stack

| Area | What's used |
|---|---|
| **3D engine** | [Three.js](https://threejs.org/) r170 (WebGL 2) |
| **Build tool** | [Vite](https://vitejs.dev/) 5 |
| **Language** | Plain modern JavaScript (ES modules), HTML and CSS. No UI framework. |
| **Weather** | [Open-Meteo](https://open-meteo.com/) current conditions for Kolkata (free, no key) |
| **Fonts** | Google Fonts: *Bebas Neue* and *Rajdhani* |
| **Audio** | Web Audio API: every sound synthesised in code, apart from the recorded Bengali voice lines |

#### Three.js add-ons used
- `Sky`: physically based sky dome
- `Water`: the reflective river surface
- `Lensflare`: sun flare
- `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `GTAOPass` (ambient occlusion), `SMAAPass` (anti-aliasing), `OutputPass`, `ShaderPass`
- `BufferGeometryUtils.mergeGeometries`

#### Rendering techniques
- Physically based materials, with clear-coat car paint.
- **Image-based lighting:** the environment map is rebuilt from the sky as the sun moves.
- **Shadows:** soft PCF shadows that follow the player.
- **Post-processing:** bloom, ambient occlusion (Ultra only), and a custom colour grade (chromatic aberration, nitro speed blur, split toning, vignette, film grain), then SMAA.
- **Custom GLSL shaders:** procedural clouds, fake volumetric light cones and GPU particles.
- **Characters:** one skinned mesh per person, procedurally rigged, with smooth two-bone weights at the joints and procedural animation: a gait cycle with heel strike, push-off and a running flight phase, body lean into turns, idle weight shifts, eight gestures, sitting, riding, falling, punch/kick/bat strikes, and pistol and rifle aiming poses.
- **Weapons and vehicles:** every gun, vehicle, tram and train is modelled in code from primitives, extrusions and rounded boxes.

#### Performance
- **Level of detail:** full trees, palms, rooftop tanks and hawkers' stalls only near the camera; simple versions or nothing beyond. Trains, parked vehicles and the underground metro are only drawn when near.
- **River reflection:** redrawn only near the river, every third frame, without trees and glows; shadows update at half rate; nothing is drawn beyond the haze (~3 km).
- **No black flashes:** invalid pixels are scrubbed before the bloom pass.
- **Fewer draw calls:** buildings are merged by material in 800 m chunks; trees, palms, rooftop tanks, street lights and light cones use instancing.
- **Distance detail:** far cars drop wheel and trim detail; far people animate less often and stop casting shadows.
- **Cheaper reflections:** the river reflection updates every other frame and skips people, traffic and particles.
- **60 fps cap:** high-refresh displays don't do extra work.
- **Adaptive resolution:** the render resolution scales with frame rate.
- **Lighter HUD:** the minimap and speedometer redraw 30 times a second, and text updates only when it changes.
- **Static world:** fixed objects skip per-frame transform updates.
- **Quality presets** on the title screen:

  | Preset | Max pixel ratio | Shadow map | Ambient occlusion | People / traffic |
  |---|---|---|---|---|
  | Ultra | 2.0 | 4096 | On | 44 / 26 |
  | High (default) | 1.25 | 2048 | Off | 38 / 24 |
  | Medium | 1.0 | 1024 | Off | 26 / 18 |
  | Low | 0.75 | No sun shadows | Off | 16 / 12 |

  **Low** is for older laptops and integrated graphics: no post-processing (bloom, colour grade, anti-aliasing), no sun shadows, a 1.5 km view into thicker haze, a river reflection that refreshes less often, and closer level-of-detail for cars and trees. On a first visit the game picks Low by itself on Intel HD/UHD, mobile or software-rendered GPUs. Switch presets on the title screen or in the pause menu. People and traffic counts apply on the next page load.

---

## 📁 Project structure

```
index.html          Page shell: HUD, title screen, pause overlay
assets/             Source artwork (the original logo)
public/             Served as-is: logo, favicons, recorded voices/
map-data/           OpenStreetMap exports (*.osm, not committed) and reference images
tools/
  build-map.mjs     Turns map-data/*.osm into src/data/kolkata.json
  fetch-region.mjs  Downloads Kolkata-wide rail lines and places (Overpass API)
  gen-voices.mjs    Records the Bengali lines into public/voices/ (macOS)
src/
  data/kolkata.json Kolkata map data (generated)
  geo.js            Map data access, polygons, polylines, spatial grid, road graph,
                    route-finding and walking paths
  main.js           Boot, main loop, cameras, quality presets, wiring
  world.js          Kolkata: ground, river and embankments, roads, buildings, parks,
                    trees, street lights, bridge decks, skyline, colliders
  landmarks.js      Howrah Bridge, Howrah Station, Victoria Memorial, Shaheed Minar,
                    Eden Gardens, St Paul's, Nakhoda Masjid, Prinsep memorial
  station.js        Howrah Station life: stalls, ticket window, TTE, buses and taxis
  trains.js         Indian rolling stock (EMU, WAP-7 + LHB, Kolkata tram) and overhead catenary
  boards.js         Departure boards with live arrival times
  busstand.js       The Esplanade (Dharmatala) bus terminus and its routes
  ride.js           Riding as a passenger: hired taxis/autos/rickshaws, buses, trains, ferries
  lines.js          Everything people say: romanised Bengali + Bengali script
  voice.js          Plays the recorded Bengali lines
  textures.js       Procedural canvas textures (asphalt, facades, roofs, ground…)
  sky.js            Day/night cycle, sun/moon, clouds, stars, lens flare, environment map
  character.js      Procedural skinned humanoid, outfits, animation and gestures
  player.js         On-foot controller, entering/exiting vehicles, interactions
  peds.js           Pedestrian AI, reactions and dialogue
  car.js            Car models, materials, arcade physics, damage, level of detail
  fleet.js          Pickup, box truck, school bus, city bus and motorbike models
  rail.js           Tracks, platforms, trams, EMU locals, the Rajdhani, Circular Railway
  metro.js          Kolkata Metro: Blue and Green lines, stations, tunnels, trains
  boats.js          Launches, country boats and other boats, ghats, river traffic
  mapview.js        Full-screen map, place names and waypoints
  traffic.js        AI traffic on the road graph, hijack/crash hand-off
  weapons.js        Weapon stats, gun models and the player's arsenal
  combat.js         Bullets, tracers, decals, explosions and area damage
  gameplay.js       Cash and ammo pickups
  jobs.js           Taxi duty: fares to pick up, destinations, the clock, stars, tips and streaks
  progress.js       Saved progress: jobs, places discovered, rides and achievements
  weather.js        Live Kolkata weather (Open-Meteo), rain, lightning
  effects.js        Particles (smoke, sparks, nitro flame) and skid marks
  post.js           Post-processing chain and colour-grade shader
  splash.js         Loading splash: logo and a taxi crossing the bridge
  hud.js            Minimap, speedometer, notifications, bubbles, gesture wheel
  audio.js          Synthesised engine, sound effects and radio
  input.js          Keyboard, mouse (pointer lock), gamepad, gesture wheel
  utils.js          Maths and geometry helpers
  style.css         HUD and menu styling
```

In development builds (`npm run dev`), `window.__kol` exposes the scene, world and player for debugging, and setting `__kol.freeCam = { p: [x, y, z], t: [x, y, z] }` flies the camera anywhere.

---

## 🌐 Browser support

Works in any up-to-date desktop browser with WebGL 2: Chrome, Edge, Firefox or Safari. A dedicated GPU is recommended for the Ultra preset. Touch controls aren't implemented yet, so mobile isn't supported.

---

## 📝 Notes

- **Map data:** © OpenStreetMap contributors, under the Open Database License. Keep the attribution if you publish the game.
- **Original work:** the game's code, models and art are original. Kolkata's streets and landmarks are real places, modelled from open map data.

<div align="center">
<br />
<img src="public/apple-touch-icon.png" width="56" alt="" />
<br />
<sub>Made with ❤️ for the City of Joy</sub>
</div>
