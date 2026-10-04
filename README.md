# Hexstead

An island-settling board game for 2–6 players that runs entirely in the browser. Settle corners, build roads, trade resources and race to 10 points.

- **Online rooms** through Firebase: create a room, share a 5-letter code or link, play from phones and laptops.
- **5–6 player expansion**: a 30-hex island with 2 deserts, 11 harbors, 34 development cards, 24 of each resource and the special build phase.
- **Bots** you can add to any game, online or on one device.
- **Pass-and-play** on one device, with a cover screen between players so hands stay private.
- A static site with no build step, so it can be hosted free on GitHub Pages.

---

## 1. Try it on your computer (no setup)

ES modules don't load from `file://`, so serve the folder:

```bash
cd hexstead
python3 -m http.server 8080
```

Open <http://localhost:8080> and choose **Play on this device**. Online rooms stay switched off until you add a Firebase config (step 3).

## 2. Put it on GitHub Pages

1. Create a new GitHub repository and upload everything in this folder, keeping the folder structure (`index.html` must be at the top level).
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then **Save**.
4. After a minute your site is live at `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

## 3. Turn on online rooms (Firebase)

Everything below fits in Firebase's free Spark plan.

1. Go to <https://console.firebase.google.com>, click **Create a project**, and follow the steps (Google Analytics is optional).
2. On the project overview page, click the **Web** icon (`</>`) to add a web app. Give it any nickname. You'll see a `firebaseConfig` block; keep that tab open.
3. **Create the database:** in the left menu open **Databases & Storage → Realtime Database** and click **Create database**. Pick a location, choose **Start in locked mode**, and click **Done**.
4. **Add the security rules:** open the database's **Rules** tab, replace everything with the contents of [`database.rules.json`](database.rules.json), and click **Publish**.
5. **Allow guest sign-in:** open **Security → Authentication** (click **Get started** the first time), go to the **Sign-in method** tab, enable **Anonymous** and save. Players never see a sign-in screen; this just gives each browser a private ID.
6. **Paste your config:** open [`js/firebase-config.js`](js/firebase-config.js) and replace the placeholder values with the ones from step 2. Make sure `databaseURL` is filled in. If your config snippet doesn't show it, copy the URL from the top of the Realtime Database page (it looks like `https://your-project-default-rtdb.firebaseio.com` or `https://your-project-default-rtdb.europe-west1.firebasedatabase.app`).
7. Commit the change. When GitHub Pages redeploys, **Create a room** on the home screen will work.

Firebase reshuffles its console menus from time to time; if a menu item isn't where these steps say, use the search bar at the top of the console.

The values in `firebase-config.js` are meant to be public; the rules you published in step 4 are what protect the data.

### If something doesn't work

| Message on screen | Fix |
|---|---|
| "Online rooms aren't switched on for this site yet" | `js/firebase-config.js` still has the placeholder values. |
| "Anonymous sign-in is turned off…" | Step 5. |
| "The database refused the request…" | The rules from step 4 weren't published, or were pasted incompletely. |
| "Couldn't reach the Realtime Database…" | `databaseURL` is missing or wrong (step 6), or the database wasn't created (step 3). |
| "This website isn't on the Firebase project's authorized domains list" | In **Security → Authentication → Settings → Authorized domains**, add `YOUR-USERNAME.github.io`. |

## 4. Playing online

1. Enter your name and choose **Create a room**. Share the room code, or the invite link (it opens the room directly).
2. In the lobby, the host picks the island size, points to win and options, and can add bots. Rooms hold up to 6 seats; with 5 or more players the large island is used automatically.
3. The host starts the game. Everyone sees the same board live; each player only sees their own cards.
4. If someone drops out, the host can tap **Let a bot play** next to their name. When they come back (same browser), they can tap **Take back your seat**.
5. After the game, the host can take everyone **Back to lobby** for a rematch.

Reloading the page is safe: you rejoin your seat automatically.

## What's included

**Base game:** random island with balanced numbers (no 6 or 8 touching), harbors (3:1 and 2:1), snake-order setup where the second settlement collects resources, production with the robber blocking, the bank running short of a resource, rolling a 7 (discard half above 7 cards, move the robber, steal), development cards (knight, road building, year of plenty, monopoly, victory point) with one play per turn and none on the turn you buy them, Longest Road (5+), Largest Army (3+ knights), trading with other players (offers and counter-offers) and with the bank or harbors, and winning only on your own turn.

**5–6 player expansion:** the bigger island and card counts listed above, plus the **special build phase**: after each turn, every other player in order may build or buy development cards (no trading, no playing cards). Players who can't afford anything are skipped automatically.

**Options:** points to win (5–20), friendly robber (can't target players with 2 points or fewer), and turning the special build phase on or off.

## How it works

| File | What it does |
|---|---|
| `index.html`, `css/style.css` | The page and its styles. |
| `js/engine.js` | All game rules. Pure functions: `createGame()` and `applyAction(state, seat, action)`. |
| `js/geometry.js` | Hex, corner and side layout for both island sizes. |
| `js/bot.js`, `js/bot-runner.js` | Computer players. |
| `js/game-ui.js`, `js/board-view.js` | The game screen and the SVG board. |
| `js/online.js` | Firebase rooms: lobby, presence, chat, and moves applied inside database transactions. |
| `js/local.js` | Games on one device, saved in the browser so you can resume. |
| `database.rules.json` | Realtime Database security rules. |
| `tests/` | Rule tests and a bot-vs-bot simulator. |

Each room lives at `rooms/CODE` in the database. Every browser runs the same rules engine; a move is checked and applied inside a transaction, so two players acting at the same moment can't overwrite each other. Bots in an online room are run by the first connected player.

### Good to know

- **Trust:** this is built for playing with friends. Each player's browser applies the rules and writes the shared game, and the full game state (including other hands) is downloaded to every player. The database rules stop people who aren't in the room from changing anything, but a player who opens the browser's developer tools could peek or cheat.
- **Free-tier usage:** a game uses roughly 2–4 MB of download per player, so the Spark plan's monthly allowance covers hundreds of games.
- **Old rooms** aren't deleted automatically. They're tiny, but you can clear them anytime by deleting the `rooms` entry in the Realtime Database console.

## Running the tests

With Node.js 18 or newer:

```bash
node tests/rules.mjs      # focused rule checks
node tests/sim.mjs 50     # 50 bot games per player count, checking that cards and pieces always add up
```

To develop against the [Firebase Local Emulator Suite](https://firebase.google.com/docs/emulator-suite) instead of a live project, run `firebase emulators:start --only auth,database` and add this line at the end of `js/firebase-config.js`:

```js
firebaseConfig.emulators = { auth: 'http://127.0.0.1:9099', database: { host: '127.0.0.1', port: 9000 } };
```

## Credits

Fonts: [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) and [Atkinson Hyperlegible Next](https://www.brailleinstitute.org/freefont/), both under the SIL Open Font License (see `fonts/`). Board art and icons are original to this project.

Hexstead is an independent fan-made game in the island-settling genre. It isn't affiliated with or endorsed by Catan GmbH or any other publisher.
