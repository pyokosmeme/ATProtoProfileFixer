# Bluesky Profile Fixer

A static, browser-only tool for repairing and updating Bluesky profiles — especially after migrating to a new PDS where older avatar/banner blobs may have gone missing.

## Features

- Authenticate with a handle/DID, app password, and custom PDS endpoint
- Load and display the current profile record (`app.bsky.actor.profile`)
- Edit display name and bio with character counters and null/clear toggles
- Re-upload avatar (with draggable + zoomable crop) and banner images
- Explicitly clear avatar, banner, or bio by sending `null` fields
- Optional “Force rewrite” to push the record even when nothing changed
- Structured diagnostic log showing XRPC responses and error payloads
- Local-only credentials handling with optional JSON import helper

## Usage

1. Provide your PDS URL (defaults to `https://api.bsky.app`), handle or DID, and an app password.
2. Click **Create Session**. After a successful login, the current profile is fetched and the editor unlocks.
3. Adjust display name, bio, avatar, or banner as needed. Use the clear toggles to send nulls for empty fields.
4. Press **Save Profile** to upload any new blobs and rewrite `app.bsky.actor.profile` via `com.atproto.repo.putRecord`.
5. Monitor the diagnostics pane for detailed request/response output and troubleshooting tips.

> **Security tip:** Use a dedicated Bluesky app password and revoke it after you’re done. Credentials are kept only in memory inside your browser tab.

Deploy the three static assets (`index.html`, `styles.css`, `app.js`) to GitHub Pages or any static host.
