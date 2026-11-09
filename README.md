# SlaveDriver

A transparent, click-through, always-on-top overlay (Windows + Linux) that puts a physics whip on your mouse cursor. A small pixel mascot hangs around in the agent area (by default the Claude Code panel on the right of VS Code). Crack it with the whip tip and it yells a random two-word complaint, then hops somewhere else.

## Run

```sh
npm install
npm start                 # agent area outline hidden (default)
npm run start:target      # same, but with the agent area outline visible
```

`npm start -- --show-target` also works. The outline can be toggled at runtime from the tray menu.

A tray icon appears. Clicking it (or the hotkey) toggles the whip.

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+W` | Draw / holster whip |
| `Ctrl+Alt+T` | Drag a box to set the agent area (Esc cancels) |

The overlay never takes focus and passes all clicks through, so you can keep working while whipping.

## Words

Edit [`words.json`](words.json). A message is `random(first) + " " + random(second)`. Changes are picked up as soon as you save the file.

## Config

`config.json` in the app data dir (`%APPDATA%\slavedriver` on Windows, `~/.config/slavedriver` on Linux). Open it from the tray menu, then pick **Reload config + words**.

- `target`: absolute screen rect, or `null` for the default (right 30% of the primary display)
- `mascot`: `true` = you must hit the mascot; `false` = any fast tip inside the agent area counts
- `hitSpeed` / `crackSpeed`: tip speed in px/s needed for a hit / crack (raise `hitSpeed` to make hits harder)
- `hitCooldownMs`, `speak`, `sound`
- `whip`: physics (`segments`, `segmentLength`, `gravity`, `damping`, `drag`, `stiffness`, `iterations`)
- `shortcuts`: Electron accelerator strings

## Linux notes

- Transparency needs a compositor (most desktop environments have one).
- Works best on **X11**. On Wayland, global cursor position and global shortcuts are restricted. Run with `npm start -- --ozone-platform=x11` (XWayland) if the whip does not follow the cursor.
- Text-to-speech needs `speech-dispatcher`. Without it the overlay stays silent.
