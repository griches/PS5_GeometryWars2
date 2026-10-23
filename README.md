# Geometry Wars 2 for PlayStation 5

[![GitHub stars](https://img.shields.io/github/stars/griches/PS5_GeometryWars2?style=flat)](https://github.com/griches/PS5_GeometryWars2/stargazers)
[![Latest release](https://img.shields.io/github/v/release/griches/PS5_GeometryWars2)](https://github.com/griches/PS5_GeometryWars2/releases/latest)
[![Licence](https://img.shields.io/badge/licence-GPL--3.0-blue)](LICENSE)

A PlayStation 5 port of [geow2](https://github.com/techknight/geow2), Derek
Quenneville's native rebuild of *Geometry Wars: Retro Evolved 2* (Xbox Live
Arcade, 2008), made by reverse engineering the original. All six modes, the
menus and local multiplayer for up to four players run natively on the
console at 4K, at 120 Hz on a TV that supports it, with PlayStation buttons
throughout and a public online scoreboard.

> [!IMPORTANT]
> You need your own copy of the **Xbox Live Arcade** release of *Geometry
> Wars: Retro Evolved 2* (title ID `584108FF`, version `0x102`). No game data
> is included.

## What you need

- A PS5 that runs homebrew, with an FTP server and ShadowMountPlus (or another
  way to register a title folder).
- Your own Xbox Live Arcade package of the game: the one file with a long
  hexadecimal name and no extension, in `584108FF/000D0000/` (about 42 MB).

## Set it up

1. Download `GeometryWars2-PS5-<version>.zip` from the
   [releases](https://github.com/griches/PS5_GeometryWars2/releases) and unzip
   it. You get a `PPSA99322` folder.
2. Copy the whole `PPSA99322` folder to `/data/homebrew/` on the console.
3. Copy your package into `/data/homebrew/PPSA99322/dump/` (the whole
   `584108FF` folder works too).
4. Start **Geometry Wars 2** from the home screen. The first start checks your
   package and makes the game's data from it, sound included. This happens once
   and takes about half a minute; the game then starts again by itself and goes
   to the title screen.
5. You can now delete the package in `dump/`.

With nothing in `dump/`, a notification says where the package goes and the
game closes.

## Controls

| Action | Button |
|---|---|
| Move | Left stick |
| Fire | Right stick |
| Bomb | L2 or R2 (L1 / R1 in Help and options, Controls) |
| Pause | Options |
| Menus: select / back | Cross / Circle |
| Back (where the original used the Back button) | Touch pad (press) |

Multiplayer takes up to four controllers: choose Multiplayer, and the others
join with Cross.

## Online scores

A public board of everyone's best per mode, at
[scores.bouncingball.mobi](https://scores.bouncingball.mobi). To join: **Help
and options**, **Online scores**, **Pair this device**. Scan the QR code with
your phone and choose your name. Your scores then go up after every game, and
the game's leaderboard screens show the board.

## What's different on the PS5

- PlayStation button symbols in every prompt, and the Xbox 360 wording
  replaced, in all five of the game's languages.
- 120 Hz output on a TV that runs it: the game still steps 60 times a second,
  as the original does, and draws the frames in between.
- The first start makes the game's data on the console itself (geow2's
  extractor, with FFmpeg's XMA decoder for the sound).
- The PlayStation 5 version's credits at the top of the game's credits.

## Known limits

- The game is in English on the console (German, French, Spanish and Italian
  are in the data but not yet picked from the console's language).
- The Controls page still shows the Xbox 360 controller picture.
- A package that is not the supported release ends at a screen that offers to
  choose another file, which the console cannot do: close the game, put the
  right package in `dump/` and start it again.
- No home-screen music yet.

## Building

Builds in the Lima VM `ps5` with the PS5 payload SDK and PS5_Vulkan's RADV:

```sh
ps5/tools/vm.sh build                 # dist/PPSA99322
ps5/tools/console.sh deploy           # to the console over FTP
ps5/tools/console.sh run 60           # launch it and follow the log
ps5/tools/package-release.sh 1.0.0    # dist/GeometryWars2-PS5-1.0.0.zip
```

`vendor/geow2` is geow2 at its pinned commit; the console's changes to it are
`ps5/patches/geow2.patch`. `server/` is the online scoreboard (geow2-scores
with a public join), a Cloudflare Worker.

## Credits

- **geow2**: [Derek Quenneville (techknight)](https://github.com/techknight/geow2),
  MIT. The game itself, its data extractor and
  [geow2-scores](https://github.com/techknight/geow2-scores).
- **PS5 port**: Gary Riches.
- [SDL](https://libsdl.org) (zlib), [FFmpeg](https://ffmpeg.org) (LGPL 2.1),
  Mesa's RADV (MIT) through [PS5_Vulkan](https://github.com/mihawk-99/PS5_Vulkan)
  (GPL-3.0), and the [PS5 payload SDK](https://github.com/ps5-payload-dev/sdk).
- *Geometry Wars: Retro Evolved 2* is by Bizarre Creations. This is an
  unofficial project, not affiliated with or endorsed by Activision, Bizarre
  Creations or Microsoft.

## Licence

GPL-3.0 ([LICENSE](LICENSE)). The licences of every part are in the release's
`licenses/` folder.
