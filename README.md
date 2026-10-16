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

The Start button opens a menu that lists your apps with a search box, your recent apps, your main folders and Sleep, Log Out and Shut Down. Control Space also opens it. Search can also find files in your home folder, and you can add your own folders to the menu.

Apps pinned next to the Start button open with one click. Drag them to reorder them. Right click an app in the Start menu or a window button and pick Pin to Bar to add one.

The tray shows the volume, Wi-Fi and battery next to the clock. Click one for a small panel to change the volume, turn Wi-Fi on or off, or see how much charge is left. Click the clock for a small calendar.

With more than one display, each display gets its own bar with that display's windows. The bar can also show windows from every Space, and clicking one switches to its Space.

Open Startbar Settings from the Start menu or by right clicking the bar. Everything above is set there, with a preview of the bar that changes as you go. Settings also has Open at login, export and import of your settings, and a button that hides the Dock for you.

Right click an empty part of the bar to hide it. While the bar is hidden, a Startbar icon sits in the menu bar. Click it, press Control Space or open Startbar again to bring the bar back.

## Updates

Startbar checks for a newer version now and then and shows it on the About page and in the Start menu. It never installs anything by itself. To update, run `npm install -g startbar` again, then quit Startbar and open it.

## Limits

macOS does not let an app reserve space at the bottom of the screen. Startbar moves windows up when they would cover the bar, but a window can still sit over it for a moment. Set the Dock to hide automatically and the bar has the bottom edge to itself.

Other apps' menu bar icons can't be moved into the bar. They stay in the menu bar at the top.

Window buttons need the Accessibility permission. Startbar asks once and explains why. Without it the bar shows one button per app. To turn it on later, open Startbar Settings, go to General and click Open System Settings.

The Hide the Dock button asks macOS for permission to control System Events the first time you use it. Nothing else needs it.

The Wi-Fi panel doesn't show the network name, since macOS only gives that out with the Location permission.

## Help

Open an issue at https://github.com/pratherbytecraft/startbar/issues.

## License

All rights reserved. Prather Bytecraft.
