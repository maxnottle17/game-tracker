# Game Tracker

A small Windows app that pulls hours played and achievements from Steam, Xbox, PlayStation and Epic Games into one leaderboard, with a stats page (account ages, play time over the years, what was being played when).

It runs entirely on your own PC: a Node server on `127.0.0.1:47830` and a web UI opened in an Edge app window. There are no dependencies to install.

## Running it

Needs [Node.js](https://nodejs.org) 20 or newer.

- Double-click `Game Tracker.vbs`, or
- run `node src/server.js` and open <http://127.0.0.1:47830/game-tracker>.

To see it with made-up data and no accounts: set `DEMO=1` before starting (nothing is saved in demo mode).

`tools/make-shortcut.ps1` draws the icon and puts a shortcut on the desktop.

## Linking accounts

The Accounts tab has step-by-step instructions. You never enter a password; you paste a key or sign-in token from each platform's own site.

| Platform | How | Notes |
|---|---|---|
| Steam | Official Web API key | Profile "Game details" must be public. |
| Xbox | [OpenXBL](https://xbl.io) personal key | Third-party service; free plan is rate limited. |
| PlayStation | NPSSO token | Unofficial (same calls as the PlayStation app). Lasts about two months. |
| Epic Games | Launcher authorization code | Unofficial; achievements are often missing. |

## Where your data lives

Keys, tokens, your game list and play history are stored in `%APPDATA%\GameTracker\store.json` on your PC. Nothing personal is kept in this folder, and the server refuses requests from anything but its own window.

## What is exact and what is estimated

Totals, achievements and unlock dates come straight from the platforms. No platform says *when* hours were played, so the "When you played the most" chart spreads each game's total between its first and last dated activity. The "Recorded play" chart is exact, but only from the day the app started tracking.

## Credits

The PlayStation calls follow [psn-api](https://github.com/achievements-app/psn-api) and the Epic sign-in follows [Legendary](https://github.com/derrod/legendary).
