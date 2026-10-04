# SM exporter

A Figma plugin for exporting social-media creatives. Select frames, pick formats (JPEG, PNG, WebP, SVG, PDF),
then download them or upload them straight to a Google Drive folder.

**Open source** (MIT). No data is collected. Files go only to your own Google Drive, and your Google credentials
are stored only on your computer, inside Figma.

## Install

- **From Figma Community:** search for "SM exporter" and click *Install* (link coming once published).
- **From source:** download this repository (Code → Download ZIP), unzip it, then in the Figma desktop app choose
  **Plugins → Development → Import plugin from manifest…** and select `manifest.json`.

## Upload to Google Drive (one-time setup)

Downloading works right away. Uploading to Drive needs a one-time setup with your own Google client
(about 5 minutes, free): see **[SETUP-GUIDE.md](SETUP-GUIDE.md)**.

**Sharing with a team:** one person follows the guide once, then either sends the Client ID and secret to teammates
privately, or bakes them into `ui.html` and shares that file privately inside the team (guide, Part 3).
Never post a file containing your secret publicly.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Plugin manifest (network access limited to Google APIs) |
| `code.ts` / `code.js` | Plugin sandbox: frame selection, rendering, settings storage (`npm run build` compiles `.ts` to `.js`) |
| `ui.html` | Panel UI, image/PDF/ZIP generation, Google Drive upload (includes pdf-lib and fflate, both MIT) |
| `oauth-callback.html` | Optional hosted redirect page for Google sign-in |
| `SETUP-GUIDE.md` / `.html` | How to create your Google client |

## Contributing

Issues and pull requests are welcome. Please never include a Client ID or secret in a pull request.

## License

MIT, see [LICENSE](LICENSE). The "SM exporter" name and logo are not covered by the license: please don't use them
to present a modified copy as the original.
