# geow2-scores

A score server for a group of [geow2](https://geow2.com) players: your
high scores, unlocked modes and achievements follow you between your
devices (a PC and a Steam Deck, say), and the group shares its boards,
like the friends boards of the original game.

One deployment is one group. You run it for yourself and your friends;
anyone else can run their own for theirs. It runs on Cloudflare's free
plan, which covers a group many times over.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/techknight/geow2-scores)

## Setting it up

1. Click **Deploy to Cloudflare** above and sign in (or make a free
   Cloudflare account). Cloudflare copies this repository to your GitHub
   account, creates the database and deploys the server.
2. When it asks, set:
   - **ADMIN_SECRET**: the password for your server's admin page. Pick a
     long one and keep it somewhere safe.
   - **GROUP_NAME**: your group's name, shown on its pages and in the
     game.
3. Your server's address is shown when the deploy finishes, something like
   `https://geow2-scores.<your-account>.workers.dev`. Open
   `<that address>/admin` and sign in with the admin secret.
4. Make an invite link and send it to your friends. Join yourself too:
   the admin page shows the new link as a QR code to scan with your phone.
   Each person chooses the name the others will see.

Invites are best opened on a phone: the browser someone joins in is the
one that pairs their devices, and with a phone that's one scan of the QR
code the game shows. On a computer the invite page offers a QR code to
carry it over to the phone, and a player who joined on a computer can
sign their phone in from their page (**Show a code for my phone**).

## Pairing a device

In geow2: **Help and options**, then **Online scores**. Enter your
server's address once, then choose **Pair this device**. The game shows a
code and a QR code: scan it with the phone you joined on and confirm (or,
in the browser you joined in, type the code on your page). Do the same on
each device you play on.

From then on the game syncs in the background when it starts and after
each game: your games, unlocks and achievements from every device add up,
and the boards show everyone in the group.

## What it keeps

For each player: the name they chose, their paired devices (by the name
the game gives them), their finished single-player games (mode, score,
multiplier, date) and their progress (unlocked modes, unlock progress,
achievements). No email addresses or passwords; device and phone tokens
are stored only as hashes. The admin can rename or remove players, sign
them out of every browser (a lost phone), unpair devices and delete
scores.

Scores are trusted as they come from the game: this is for friends, not
a public leaderboard.

## How big a group

Up to about 50 people fits comfortably in Cloudflare's free plan. A
device syncs when the game starts, after each game and every five
minutes while it sits in the menus. Each sync reads about seven rows of
the database per player in the group and writes a few, against the free
plan's 5 million rows read, 100,000 rows written and 100,000 requests a
day. A larger group still fits if people don't leave the game open in the
menus all day.

If a day's allowance runs out, syncs fail until it resets (at midnight
UTC). Nothing is lost: each device keeps its games and sends them at the
next sync. Cloudflare's paid Workers plan raises the limits.

## Updating

Your copy of this repository is yours. To take a newer version, sync your
fork with this repository on GitHub; Cloudflare deploys it.

## Running it without the button

You need Node.js 22 or later.

    npm install
    npx wrangler login
    npm run deploy
    npx wrangler secret put ADMIN_SECRET
    npx wrangler secret put GROUP_NAME

(or set the two in the dashboard: the Worker's Settings, Variables and
Secrets). Deploying again keeps them.

`npm run dev` runs it locally with a local database; `npm test` runs the
tests.

## Licence

MIT. geow2 and geow2-scores are unofficial projects, not affiliated with
or endorsed by Activision, Bizarre Creations or Microsoft.
