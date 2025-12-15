<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1t24yZRdzB4swJDSHs4hibgD7xZa42azS

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Security Notes

- **Content-Security-Policy (CSP)**: This project includes a strict CSP in `index.html` which now restricts scripts and styles to `self`, disallows workers, and blocks outbound connections (`connect-src 'none'`). This prevents scripts from exfiltrating data.
- **Least Privilege for File Access**: The app now requests `read` permission when selecting the source folder and will only request `readwrite` when you perform an action that requires it (delete/copy). This reduces accidental exposure.
- **Local styles (Tailwind)**: Removed Tailwind CDN and included Tailwind/PostCSS tooling locally so styles are bundled during development/build. The visible app style is unchanged.
- **Media privacy hardening**: Media elements (`img`, `video`) use `referrerPolicy="no-referrer"` to avoid leaking referrers when rendering blobs or data URLs.
- **Blob / dev console notes**: While running locally you may see console messages like:
   - `Connecting to 'http://localhost:5000/.well-known/appspecific/com.chrome.devtools.json' violates the following Content Security Policy directive: "connect-src 'none'".`
   - `GET blob:http://localhost:5000/... net::ERR_FILE_NOT_FOUND`.

   These are generally benign in development:
   - The first is DevTools/HMR attempting to connect; in development the secure preview server relaxes CSP to allow `connect-src` for `self` and `ws:`. In production CSP is strict and these requests are intentionally blocked.
   - The blob `ERR_FILE_NOT_FOUND` happens when a blob URL (created with `URL.createObjectURL`) is revoked or becomes invalid (e.g., due to HMR/module reload or the object URL being revoked). The app now retries and falls back to a data URL (via `FileReader`) when blobs repeatedly fail.

   If you want to run the secure preview server in development mode (relaxed CSP) use:

   ```bash
   NODE_ENV=development npm run start:secure
   ```

   For production testing, run the server without `NODE_ENV=development` so the strict CSP is applied.
- **Avoid untrusted extensions or browsers**: Browser extensions or compromised browsers can access pages and exfiltrate data. Use a clean, up-to-date browser and avoid untrusted extensions.
- **Bundle dependencies for higher security**: Loading libraries from CDNs (e.g., `esm.sh`) increases supply-chain risk. For a more secure deployment, install dependencies locally and build a bundled app.

If you want, I can help produce a production build and tighten the CSP further (remove any remaining allowances).

### Packaging as a native Windows app (.exe)

This project can be packaged as a standalone Windows executable using **Electron** and **electron-builder** (quick to set up). I added a minimal Electron wrapper and build config.

Quick steps to build a Windows installer locally:

1. Install dev dependencies (if you haven't):
```bash
npm install
```
2. Create a production build of the web app:
```bash
npm run build
```
3. Build the Windows installer (`.exe`):
```bash
npm run dist:win
```

The produced artifacts will be in the `dist/` folder (electron-builder output). For higher trust, sign the executable with a code-signing certificate and distribute over HTTPS.

To make the installer available for download from the site locally, copy the generated installer into `dist/installer/` (create the folder if necessary). The secure preview server will serve it at `http://localhost:5000/installer/<your-installer>.exe` and the app header will show a "Download" button that attempts to fetch `/installer/MediaCleaner-Setup.exe`.

Example:

```bash
# after running `npm run dist:win`
cp dist/MediaCleaner Setup.exe dist/installer/MediaCleaner-Setup.exe
```

If you'd like, I can proceed to:
- Add an application icon and installer customizations,
- Add automatic updates (optional),
- Add instructions for code-signing and publishing.


### Local Tailwind & dependencies

- Install new dev dependencies:

```bash
npm install
```

- During development Vite will use Tailwind via PostCSS automatically after installing the listed dev dependencies. For an explicit CSS build step (production), run:

```bash
npm run build:css
```

- After installing, start the app:

```bash
npm run dev
```

This removes the reliance on remote CDNs for styles and imports, reducing supply-chain exposure while keeping the app look identical.
