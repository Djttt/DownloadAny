# LumeAny installer assets

This directory is the single replacement point for Windows installer branding.
Keep the filenames unchanged when replacing an asset.

| File | Required format / size | Purpose |
| --- | --- | --- |
| `installer.ico` | multi-resolution ICO | Setup executable and installer window |
| `uninstaller.ico` | multi-resolution ICO | Installed `uninstall.exe` |
| `installer-sidebar.bmp` | 164 x 314, 24-bit BMP | Welcome and finish pages |
| `installer-header.bmp` | 150 x 57, 24-bit BMP | Installer inner pages |
| `uninstaller-header.bmp` | 150 x 57, 24-bit BMP | Uninstaller pages |

Run `powershell -ExecutionPolicy Bypass -File scripts/generate-installer-assets.ps1`
from the project root to regenerate the default artwork. The ICO files are copied
from `src-tauri/icons/icon.ico`, whose master is `public/app-icon.png`.

## External artwork

The auxiliary cloud-download and trash line icons are adapted from
[Lucide Icons](https://lucide.dev/icons), downloaded from the official repository:

- `sources/lucide-cloud-download.svg`
- `sources/lucide-trash.svg`

Lucide is distributed under the ISC license. A copy is stored at
`sources/LUCIDE-LICENSE.txt`. The LumeAny logo, composition, colors, and
generated installer bitmaps are project artwork.

The uninstaller only removes files inside the application install directory.
Its optional “delete application data” checkbox targets the Tauri data folders
for `com.dengjun.downloadany`; it never deletes the user's media download folder.
