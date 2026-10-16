# Startbar

A taskbar for macOS. A bar along the bottom of the screen with a Start button, one button per open window, pinned apps and a clock. Free to use.

## Install

```
npm install -g startbar
startbar
```

Startbar needs Node 18 or newer. The first start takes a moment while it reads your app icons.

The install also adds Startbar to the Applications folder in your home folder, so you can open it again from Spotlight or the Start menu after you quit it.

## Uninstall

```
npm uninstall -g startbar
```

Then move Startbar from the Applications folder in your home folder to the Trash.

## What it does

The bar follows your Mac's light or dark setting and your accent color. A Classic 2001 theme is in the settings if you want the retro look.

The Start button opens a menu that lists your apps with a search box, your recent apps, your main folders and Sleep, Log Out and Shut Down. Control Space also opens it.

## Limits

macOS does not let an app reserve space at the bottom of the screen, so other windows can overlap the bar. Set the Dock to hide automatically and the bar has the bottom edge to itself.

Other apps' menu bar icons can't be moved into the bar. They stay in the menu bar at the top.

Window buttons need the Accessibility permission. Startbar asks once and explains why. Without it the bar shows app icons only.

## Help

Open an issue at https://github.com/pratherbytecraft/startbar/issues.

## License

All rights reserved. Prather Bytecraft.
