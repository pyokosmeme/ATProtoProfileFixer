# Bluesky Profile Fixer — Static GitHub Pages Tool

A lightweight, static web app to **update or “repair”** a Bluesky profile on a custom PDS (e.g., Blacksky) — including re‑uploading missing blobs (avatar/banner), editing display name and bio, and sending **null/empty field updates** to clear stale data. Built for **GitHub Pages** (pure client‑side, no server).

---

## 1) Project Goals

**Primary**
- Let a user authenticate with a Bluesky **App Password** and update their profile via AT Protocol XRPC.
- Re‑upload avatar (and optionally banner) blobs to the **current PDS**, fixing “blob error” from migrations.
- Edit **display name** and **bio**; preview and crop avatar before upload.
- Support **null updates** (e.g., clear avatar, clear banner, clear bio).

**Secondary**
- Minimal, portable, static site: no build step required (one HTML file, one JS file, one CSS file).
- Safe handling of secrets: keep credentials only in memory; optionally **load from a local file** (never uploaded).
- Robust error reporting with guidance tailored to common PDS migration issues.

---

## 2) Constraints & Assumptions

- Runs entirely in the browser (CORS to the user’s PDS must be allowed; most PDSs enable this).
- Auth is via **App Password** (created in Bluesky’s settings). No OAuth flow.
- We use either **raw XRPC calls** or the official **`@atproto/api`** client (loaded via ESM CDN). Raw XRPC keeps deps minimal; the client SDK improves DX and type‑safety.
- Profile record is stored in the user’s repo under collection **`app.bsky.actor.profile`** (`rkey = "self"`). Updates use **`com.atproto.repo.putRecord`**. Blobs are uploaded via **`com.atproto.repo.uploadBlob`**.
- “Null update” means: send a new profile record **omitting** a field to leave it unchanged, or **explicitly setting it to `null`** to clear it (SDK serializes `null` appropriately). Different PDS versions have varied historical behavior; provide both **“clear”** (set null) and **“leave blank”** (omit) options in UI.

> **Why this fixes migration blob errors:** When moving to a new PDS, old **blob CIDs** (avatar/banner) may be missing. Re‑uploading the image to the **new** PDS and writing a fresh profile record with the **new blob reference** resolves “blob not found” / “blob error”.

---

## 3) UX & Feature Checklist (TODO)

- [ ] **Auth Panel**
  - [ ] Inputs: **Handle or DID**, **App Password**, **PDS URL** (defaults to `https://api.bsky.app` or user’s PDS).
  - [ ] Option: **Load creds from local file** (JSON) via file picker; parse client‑side only.
  - [ ] Button: **Create Session** (calls `com.atproto.server.createSession`).
  - [ ] Show DID, session scope, and current PDS after login.
- [ ] **Current Profile Loader**
  - [ ] Fetch current record via `com.atproto.repo.getRecord` (repo = DID, collection = `app.bsky.actor.profile`, rkey = `self`).
  - [ ] Display current displayName, description, avatar/banner presence (with thumbnails if available).
- [ ] **Editor**
  - [ ] **Display Name** (char counter).
  - [ ] **Bio / Description** (char counter).
  - [ ] **Avatar Uploader** with image preview and **cropper** (square). Export cropped PNG/JPEG as Blob.
  - [ ] **Banner Uploader** (optional; wide aspect).
  - [ ] **Null Update Controls**: checkboxes to **Clear avatar**, **Clear banner**, **Clear bio**. Tooltips explain difference between *omit* and *null*.
- [ ] **Actions**
  - [ ] **Upload Blobs** (`com.atproto.repo.uploadBlob`) for avatar/banner and hold returned blob refs.
  - [ ] **Put Profile Record** using `com.atproto.repo.putRecord` (collection `app.bsky.actor.profile`, rkey `self`).
  - [ ] **Force re‑write** option: write record even if unchanged, to patch missing blobs.
- [ ] **Diagnostics**
  - [ ] Structured error box that surfaces XRPC status, error codes, and hints.
  - [ ] Specific guidance for **blob not found** / **record not found** / **invalid token**.
- [ ] **Security**
  - [ ] Never persist the app password; keep in memory only.
  - [ ] Optional: “Paste once, then forget” (clear after session created).
- [ ] **Deploy**
  - [ ] Single‑page app hosted via **GitHub Pages**.
  - [ ] No server, no analytics, no trackers.

---

## 4) Architecture

**Pure static:** `index.html`, `app.js`, `styles.css` (+ optional `cropper.js` or lightweight inlined cropper).

**Data flow**
1. **Create Session**  
   `POST /xrpc/com.atproto.server.createSession` with `{ identifier, password }` → returns `{ did, handle, accessJwt, refreshJwt, ... }`.
2. **Get current profile**  
   `GET /xrpc/com.atproto.repo.getRecord?repo=<DID>&collection=app.bsky.actor.profile&rkey=self`.
3. **Upload avatar/banner** (optional)  
   `POST /xrpc/com.atproto.repo.uploadBlob` (Content‑Type: image/*) → returns `{ blob: { $type: "blob", ref: { $link: "…" }, mimeType, size } }`.
4. **Put profile**  
   `POST /xrpc/com.atproto.repo.putRecord` with body:
   ```json
   {
     "repo": "<DID>",
     "collection": "app.bsky.actor.profile",
     "rkey": "self",
     "record": {
       "$type": "app.bsky.actor.profile",
       "displayName": "New Name",
       "description": "New bio",
       "avatar": { "$type": "blob", "ref": { "$link": "..." }, "mimeType": "image/png", "size": 12345 },
       "banner": { ... } // optional
     },
     "validate": true,
     "swapRecord": null
   }
   ```
   - For **null updates** (to clear): set `avatar: null` (or `banner: null`, `description: null`).  
     For **omit (no‑change)**: simply leave the field out of `record`.
5. **Verify** by re‑fetching the record; confirm new blob refs are on the new PDS.

**Note on endpoints:** If using a non‑default PDS, prefix requests with that PDS’s base URL (e.g., `https://<your-pds-host>/xrpc/...`).

---

## 5) Handling Migration “Blob Error”

- Symptom: attempts to change profile fail with errors referencing **missing blobs** after moving to a new PDS.
- Resolution path in this tool:
  1. Authenticate against the **current** PDS.
  2. Upload a **fresh avatar/banner** via `uploadBlob` (generates new blob CIDs on the new PDS).
  3. Write the profile record referencing these **new blob refs** via `putRecord`.
  4. If you want to **remove** the avatar/banner entirely, use the **Null Update** controls to set them to `null`.
- Edge case: if `getRecord` for `self` returns 404, create the record with `putRecord` anyway; some repos may lack an existing profile record after unusual migrations.

---

## 6) Implementation Guide (Raw XRPC, minimal deps)

### 6.1 Session
```js
async function createSession(pds, identifier, password) {
  const res = await fetch(pds + "/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password })
  });
  if (!res.ok) throw await res.json().catch(() => ({ error: res.statusText }));
  return res.json();
}
```

### 6.2 Auth header
Use `Authorization: Bearer <accessJwt>` for subsequent calls. Do **not** store the password once tokens are acquired.

### 6.3 Get current profile
```js
async function getProfile(pds, did, token) {
  const url = new URL(pds + "/xrpc/com.atproto.repo.getRecord");
  url.searchParams.set("repo", did);
  url.searchParams.set("collection", "app.bsky.actor.profile");
  url.searchParams.set("rkey", "self");
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return null;
  if (!res.ok) throw await res.json().catch(() => ({ error: res.statusText }));
  return res.json();
}
```

### 6.4 Upload blob
```js
async function uploadBlob(pds, token, file) {
  const res = await fetch(pds + "/xrpc/com.atproto.repo.uploadBlob", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: file // raw binary; fetch sets Content-Type automatically
  });
  if (!res.ok) throw await res.json().catch(() => ({ error: res.statusText }));
  const j = await res.json();
  return j.blob;
}
```

### 6.5 Put profile record
```js
async function putProfile(pds, did, token, { displayName, description, avatar, banner }, clear={}) {
  const record = { "$type": "app.bsky.actor.profile" };
  if (displayName !== undefined) record.displayName = displayName;
  if (description !== undefined) record.description = description;
  if (avatar !== undefined)   record.avatar = avatar;             // set to a blob object or null
  if (banner !== undefined)   record.banner = banner;             // set to a blob object or null

  // Optional: explicit clears (null)
  if (clear.avatar) record.avatar = null;
  if (clear.banner) record.banner = null;
  if (clear.description) record.description = null;

  const body = {
    repo: did,
    collection: "app.bsky.actor.profile",
    rkey: "self",
    record,
    validate: true,
    swapRecord: null
  };

  const res = await fetch(pds + "/xrpc/com.atproto.repo.putRecord", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw await res.json().catch(() => ({ error: res.statusText }));
  return res.json();
}
```

---

## 7) Image Cropping

- Use a lightweight cropper (e.g., **CropperJS**) or canvas‑based custom crop.
- Steps: load the selected file → render to `<canvas>` → user adjusts crop → export with `canvas.toBlob(...)` → pass Blob to `uploadBlob`.
- Recommended avatar aspect: **1:1** square. Banner: wide (e.g., 3:1). Validate file size & type before upload.

---

## 8) Error Handling Playbook

Common failure cases and what to surface in the UI:

| Symptom | Likely Cause | Next Step |
|---|---|---|
| 401 Unauthorized | Bad app password or expired token | Re‑auth; clear stored tokens and retry |
| 403 Forbidden | PDS policy or repo not writable | Confirm DID and PDS; check you’re logged into the correct PDS |
| 404 Record not found | Profile record missing (post‑migration) | Proceed with `putRecord` to create `self` |
| Blob not found / CID missing | Old blobs not present on new PDS | Re‑upload avatar/banner and rewrite profile |
| CORS error in browser | PDS misconfigured CORS | Try your direct PDS URL; if self‑hosted PDS, enable CORS for `*` or your domain |
| Invalid record | Field constraints (length, type) violated | Trim name/bio; verify mime/size on blobs |

Also log returned `error` and `message` fields from XRPC JSON for visibility.

---

## 9) Security Notes

- **Never** hardcode or persist app passwords. Keep in **memory only**.
- Offer **“load creds from file”**: use `<input type="file">` and parse JSON client‑side; do not upload anywhere.
- Clear sensitive fields after session creation.
- If publishing a demo, clearly warn users that they are running this tool **at their own risk** and that they should use a dedicated app password they can revoke.

---

## 10) Folder Layout

```
/ (GitHub Pages root)
├─ index.html        # UI shell
├─ app.js            # XRPC calls, state, UI actions
├─ styles.css        # minimal styling
├─ cropper.min.js    # optional library (or inline ES module)
└─ README.md         # this doc (or link to it)
```

---

## 11) Minimal HTML Skeleton (outline)

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Bluesky Profile Fixer</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <section id="auth">
    <h2>Authenticate</h2>
    <input id="pds" placeholder="https://api.bsky.app" />
    <input id="handle" placeholder="yourname.bsky.social or DID" />
    <input id="password" placeholder="App Password" type="password" />
    <input id="credsfile" type="file" />
    <button id="login">Create Session</button>
  </section>

  <section id="profile">
    <h2>Current Profile</h2>
    <div id="current"></div>

    <h3>Edit</h3>
    <input id="displayName" placeholder="Display name" />
    <textarea id="description" placeholder="Bio"></textarea>

    <div>
      <input id="avatarFile" type="file" accept="image/*" />
      <canvas id="avatarCanvas"></canvas>
      <label><input type="checkbox" id="clearAvatar" /> Clear avatar (null)</label>
    </div>

    <div>
      <input id="bannerFile" type="file" accept="image/*" />
      <canvas id="bannerCanvas"></canvas>
      <label><input type="checkbox" id="clearBanner" /> Clear banner (null)</label>
    </div>

    <label><input type="checkbox" id="clearBio" /> Clear bio (null)</label>

    <button id="save">Save Profile</button>
    <pre id="log"></pre>
  </section>

  <script type="module" src="app.js"></script>
</body>
</html>
```

---

## 12) Testing Checklist

- [ ] Login succeeds on both **bsky.social** and **custom PDS** (Blacksky).
- [ ] `getRecord` returns the profile or `404` (handled).
- [ ] Upload avatar; verify `uploadBlob` returns a blob with `$link`.
- [ ] `putRecord` updates avatar and reflects immediately in `getRecord`.
- [ ] Clear avatar/banner/bio via **null** fields; verify they disappear.
- [ ] Try with **no avatar** but with banner (and vice‑versa).
- [ ] Simulate lost blob (set avatar to old `$link`) → write new blob and confirm error resolved.
- [ ] Validate CORS in GitHub Pages context.
- [ ] Revoke app password and confirm login fails as expected.

---

## 13) Future Enhancements

- Use `@atproto/api` SDK for stronger typing, refresh token flow, and utilities.
- Add **handle transfer** helpers or PDS discovery.
- Support other record patches (labels, links, etc.).
- Localization, dark mode.

---

## 14) Quick Start (for “vibe coding”)

1. Create **`index.html`**, **`app.js`**, **`styles.css`** from the skeleton above.
2. Implement the four calls: `createSession`, `getProfile`, `uploadBlob`, `putProfile`.
3. Wire the **cropper** to produce a square avatar blob, then call `uploadBlob`.
4. Compose the `record` with any new blob refs and text fields.
5. Click **Save Profile** → confirm via `getRecord` → done.

---

**Notes for the implementer LLM:** Favor explicit, readable code; return structured errors; avoid storing secrets; expose a clear log pane for users to self‑diagnose PDS issues.
