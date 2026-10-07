# Swish 🏀

An open-source Chrome extension that turns every file upload field on the web into a basketball hoop.

It's a two-step shot:

1. **Drag a file onto any page** with an upload field. A hoop appears at the bottom of the field. Drop the file anywhere and it sits on the page like a ball.
2. **Grab the ball and drag to aim.** A dotted arc shows your shot. Let go and the file spins through the air, swishes through the net, and lands in the input exactly as if you had picked it with the file dialog.

Press Esc (or the × on the ball) to put it down without uploading.

## Features

- Works on any site with an `<input type="file">`, including custom dropzones that hide the real input
- Aims at the upload field closest to your cursor
- Respects `multiple`: single-file inputs only get the first file
- Files are labeled by type (PDF, PNG, ZIP…) and shot one after another
- Synthesized net "swish" sound (Web Audio, no assets), with a mute toggle
- Swish counter in the toolbar popup
- Honors `prefers-reduced-motion`
- No network access, no tracking. The only permission is `storage`, for your settings and the counter.

## Install

1. Download `swish-vX.Y.Z.zip` from the [latest release](https://github.com/ndunl075/swish/releases/latest) and unzip it.
2. **Windows:** double-click `Install Swish.cmd`. **macOS / Linux:** run `sh install.sh`.
3. In the extensions page it opens, turn on **Developer mode**, click **Load unpacked**, and pick the folder the installer printed (on Windows it's already on your clipboard).

Browsers only allow extensions from outside the Chrome Web Store to be added by hand, so that last step can't be automated. Works in Chrome, Edge, Brave and other Chromium browsers. To update, run the new release's installer and click reload on the Swish card.

### From source

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the repo folder.

To build the release zips (`dist/`), run `python scripts/build.py`.

To try it on the bundled demo page from disk, enable **Allow access to file URLs** on the extension's details page, or serve the repo locally:

```bash
npx http-server -p 5173 .
```

then open http://localhost:5173/demo/. The demo also includes the content script directly, so it works without installing the extension.

## How it works

`src/content.js` runs on every page. When a drag carrying files enters the window, it finds the nearest `input[type=file]` (or the visible container of a hidden one), and draws the hoop in a Shadow DOM overlay so page styles can't interfere. The overlay catches the drop and holds the files as a ball; nothing reaches the page until you shoot. After the shot it assigns the files with a `DataTransfer` and dispatches `input` and `change` events. Frameworks like React and libraries like react-dropzone see this as a normal file selection.

File delivery runs on a timer, not at the end of the animation, so an upload never waits on a cosmetic effect (for example when the tab goes to the background mid-shot).

## Page hooks

Pages can opt into tighter integration through attributes on `<html>` (the demo uses all three):

- `data-swish-bare`: the page draws its own upload UI, so Swish only adds the hoop and ball.
- `data-swish-muted`: no swish sound on this page.
- `data-swish-state`: set by Swish to `incoming`, `holding`, `aiming` or `shooting` while a shot is in progress, so the page can react with CSS.

## Known limitations

- Dropzones with no `<input type="file">` at all (pure drag-and-drop handlers) aren't targeted yet; on those pages Swish stays out of the way.
- Inputs inside closed shadow roots aren't found.

## License

[MIT](LICENSE)
