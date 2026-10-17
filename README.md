# Startbar

A taskbar for macOS. A bar along the bottom of the screen with a Start button, one button per open window, pinned apps and a clock. Free to use.

![Startbar with the Start menu open](https://raw.githubusercontent.com/pratherbytecraft/startbar/main/docs/screenshots/menu-system.png)

## Install

```
npm install -g startbar
startbar
```

Or with Homebrew:

```
brew install pratherbytecraft/tap/startbar
startbar
```

Startbar needs Node 18 or newer and Apple's Command Line Tools, which the install uses to build a small helper. If they're missing, the install says so; run `xcode-select --install`, then `npm rebuild -g startbar`. The first start takes a moment while it reads your app icons.

The install also adds Startbar to the Applications folder in your home folder, so you can open it again from Spotlight or the Start menu after you quit it.

## Uninstall

```
npm uninstall -g startbar
```

Or `brew uninstall startbar` if you installed it with Homebrew.

Then move Startbar from the Applications folder in your home folder to the Trash.

## What it does

The bar follows your Mac's light or dark setting and your accent color, with a round Start button and window buttons that light up in each app's color. Classic 2009, Classic 2001 and Classic 1995 themes are in the settings if you want a retro look, each with its own color schemes, and Classic 1995 lets you pick your own colors. Each theme keeps its own look and size settings, and each can be reset on its own.

![Classic 2009 theme](https://raw.githubusercontent.com/pratherbytecraft/startbar/main/docs/screenshots/menu-2009.png)

![Classic 2001 theme](https://raw.githubusercontent.com/pratherbytecraft/startbar/main/docs/screenshots/menu-2001.png)

![Classic 1995 theme](https://raw.githubusercontent.com/pratherbytecraft/startbar/main/docs/screenshots/menu-1995.png)

Some of the color schemes: Classic 2009 in Ruby, Classic 2001 in Olive Green and Silver, Classic 1995 in Rose and Marine.

![Classic 2009 in Ruby](https://raw.githubusercontent.com/pratherbytecraft/startbar/main/docs/screenshots/bar-2009-ruby.png)
![Classic 2001 in Olive Green](https://raw.githubusercontent.com/pratherbytecraft/startbar/main/docs/screenshots/bar-2001-olive.png)
![Classic 2001 in Silver](https://raw.githubusercontent.com/pratherbytecraft/startbar/main/docs/screenshots/bar-2001-silver.png)
![Classic 1995 in Rose](https://raw.githubusercontent.com/pratherbytecraft/startbar/main/docs/screenshots/bar-1995-rose.png)
![Classic 1995 in Marine](https://raw.githubusercontent.com/pratherbytecraft/startbar/main/docs/screenshots/bar-1995-marine.png)

The Start button opens a menu that lists your apps with a search box, up to five recent apps, your main folders and Sleep, Log Out and Shut Down. Control Space also opens it, or throw the mouse into the bottom left corner and click. Start typing to search. Search can also find files in your home folder, and you can add your own folders to the menu. Right click a recent app to remove it from the list.

Apps pinned next to the Start button open with one click, and an app that already has a window open gets a new one. Drag them to reorder them. Right click an app in the Start menu or a window button and pick Pin to Bar to add one. Pins can also sit in the row with the window buttons, where a pinned app's button turns into its window buttons once it opens.

Right click a window button to minimize, close or quit, pin the app, or open a new window. Turn on previews and hovering a window button shows a picture of each of its windows, and a click on a group keeps them open. A strip at the right end of the bar can hide every app to show the desktop, and a second click brings them back.

A window can be pulled out of its app's group onto its own button. Drag its picture out of the preview, or its row out of the group list, down onto the bar. Drag the button back onto the group to put it back, or pick Put back in the group on its right click menu. Startbar remembers pulled out windows by app and title, so the same window comes back on its own button the next time it opens.

![Window previews over a Finder group](https://raw.githubusercontent.com/pratherbytecraft/startbar/main/docs/screenshots/preview-system.png)

The tray shows Bluetooth, the volume, Wi-Fi and the battery next to the clock. Click one for a small panel to change the volume, turn Wi-Fi or Bluetooth on or off, connect a Bluetooth device, or see how much charge is left. Click the clock for a small calendar.

![The calendar above the clock](https://raw.githubusercontent.com/pratherbytecraft/startbar/main/docs/screenshots/calendar-system.png)

With more than one display, each display gets its own bar with that display's windows. The bar can also show windows from every Space, and clicking one switches to its Space.

Open Startbar Settings from the Start menu or by right clicking the bar. Everything above is set there, with a preview of the bar that changes as you go. Settings also has Open at login, export and import of your settings, and buttons that hide the Dock or move it to the bottom.

![Startbar Settings](https://raw.githubusercontent.com/pratherbytecraft/startbar/main/docs/screenshots/settings-appearance.png)

With [Filedrawer](https://github.com/pratherbytecraft/filedrawer) installed, the General page can open the Start menu's folders in Filedrawer instead of Finder.

Right click an empty part of the bar to hide it. While the bar is hidden, a Startbar icon sits in the menu bar. Click it, press Control Space or open Startbar again to bring the bar back.

## Updates

Startbar checks for a newer version now and then and shows it on the About page and in the Start menu. It never installs anything by itself. To update, run `npm install -g startbar` again, or `brew upgrade startbar` if you installed it with Homebrew, then quit Startbar and open it. The About page shows the line that fits your copy, with a Copy button.

## Limits

macOS does not let an app reserve space at the bottom of the screen. Startbar moves windows up when they would cover the bar, but a window can still sit over it for a moment. Set the Dock to hide automatically and the bar has the bottom edge to itself.

Other apps' menu bar icons can't be moved into the bar. They stay in the menu bar at the top.

## Permissions

The Permissions page in Startbar Settings shows each permission Startbar can use, whether it's allowed, and a button to allow it or open System Settings. Apart from Accessibility, nothing is asked until you press that button or use the feature.

- Accessibility shows window titles on the bar and brings a window forward when you click its button. Startbar asks once when it first opens. Without it the bar shows one button per app.
- Automation for System Events lets the Dock buttons hide the Dock or move it to the bottom.
- Location shows the Wi-Fi network's name in the tray. macOS counts the network name as location. Startbar doesn't read where you are.
- Bluetooth shows Bluetooth in the tray with your devices and their battery.
- Screen Recording shows the window previews, when you turn them on. Startbar doesn't record or keep your screen.

## Help

Open an issue at https://github.com/pratherbytecraft/startbar/issues.

## License

Copyright 2026 Prather Bytecraft. All rights reserved. Startbar is free to install and use, and its source code can be read, but it can't be copied, changed or shared. See LICENSE.
