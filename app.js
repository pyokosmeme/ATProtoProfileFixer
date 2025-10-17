const elements = {
  pds: document.getElementById('pds'),
  handle: document.getElementById('handle'),
  password: document.getElementById('password'),
  clearPassword: document.getElementById('clearPassword'),
  login: document.getElementById('login'),
  logout: document.getElementById('logout'),
  credsFile: document.getElementById('credsfile'),
  profileSection: document.getElementById('profile'),
  currentProfile: document.getElementById('current'),
  displayName: document.getElementById('displayName'),
  displayNameCount: document.getElementById('displayNameCount'),
  description: document.getElementById('description'),
  descriptionCount: document.getElementById('descriptionCount'),
  clearBio: document.getElementById('clearBio'),
  avatarFile: document.getElementById('avatarFile'),
  avatarCanvas: document.getElementById('avatarCanvas'),
  avatarZoom: document.getElementById('avatarZoom'),
  clearAvatar: document.getElementById('clearAvatar'),
  bannerFile: document.getElementById('bannerFile'),
  bannerCanvas: document.getElementById('bannerCanvas'),
  clearBanner: document.getElementById('clearBanner'),
  save: document.getElementById('save'),
  refresh: document.getElementById('refresh'),
  log: document.getElementById('log'),
  sessionInfo: document.getElementById('sessionInfo'),
  forceRewrite: document.getElementById('forceRewrite'),
};

const state = {
  session: null,
  currentRecord: null,
  currentRecordCid: null,
  avatar: {
    image: null,
    file: null,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    mimeType: 'image/png',
  },
  banner: {
    image: null,
    file: null,
    objectUrl: null,
  },
  pending: false,
};

const MAX_DISPLAY_NAME = 64;
const MAX_DESCRIPTION = 256;

function appendLog(message, payload = null, level = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  const timestamp = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${escapeHtml(message)}`;
  if (payload) {
    const block = document.createElement('pre');
    block.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    entry.appendChild(block);
  }
  elements.log.appendChild(entry);
  elements.log.scrollTop = elements.log.scrollHeight;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setPending(isPending) {
  state.pending = isPending;
  const buttons = [elements.login, elements.logout, elements.save, elements.refresh];
  buttons.forEach((btn) => {
    if (!btn) return;
    if (isPending) {
      if (!btn.dataset.prevDisabled) {
        btn.dataset.prevDisabled = btn.disabled ? 'true' : 'false';
      }
      btn.disabled = true;
    } else {
      const wasDisabled = btn.dataset.prevDisabled === 'true';
      btn.disabled = wasDisabled;
      delete btn.dataset.prevDisabled;
    }
  });
}

function setSession(session) {
  state.session = session;
  if (session) {
    enableProfileSection(true);
    elements.logout.disabled = false;
    elements.save.disabled = false;
    elements.refresh.disabled = false;
    elements.forceRewrite.disabled = false;
    renderSessionInfo(session);
  } else {
    enableProfileSection(false);
    elements.logout.disabled = true;
    elements.save.disabled = true;
    elements.refresh.disabled = true;
    elements.forceRewrite.checked = false;
    elements.forceRewrite.disabled = true;
    clearSessionInfo();
  }
}

function enableProfileSection(enabled) {
  if (enabled) {
    elements.profileSection.removeAttribute('aria-disabled');
  } else {
    elements.profileSection.setAttribute('aria-disabled', 'true');
  }
}

function renderSessionInfo(session) {
  const { did, handle, pdsUrl } = session;
  const info = [
    ['DID', did],
    ['Handle', handle],
    ['PDS', pdsUrl],
  ];
  elements.sessionInfo.innerHTML = info
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');
  elements.sessionInfo.classList.remove('hidden');
}

function clearSessionInfo() {
  elements.sessionInfo.innerHTML = '';
  elements.sessionInfo.classList.add('hidden');
}

function normalizePdsUrl(raw) {
  const trimmed = (raw || '').trim();
  const fallback = 'https://api.bsky.app';
  const value = trimmed || fallback;
  try {
    const candidate = value.startsWith('http') ? value : `https://${value}`;
    const url = new URL(candidate);
    url.hash = '';
    url.search = '';
    const normalizedPath = url.pathname.replace(/\/$/, '');
    const basePath = normalizedPath === '/' || normalizedPath === '' ? '' : normalizedPath;
    return `${url.protocol}//${url.host}${basePath}`;
  } catch (err) {
    throw new Error('Invalid PDS URL. Include protocol (https://).');
  }
}

async function createSession() {
  if (state.pending) return;
  const pdsUrl = normalizePdsUrl(elements.pds.value);
  const identifier = elements.handle.value.trim();
  const password = elements.password.value;
  if (!identifier || !password) {
    appendLog('Provide both handle/DID and app password to authenticate.', null, 'error');
    return;
  }

  appendLog(`Creating session at ${pdsUrl}...`);
  setPending(true);
  try {
    const response = await fetch(`${pdsUrl}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identifier, password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      appendLog('Failed to create session.', payload, 'error');
      throw new Error(payload?.message || `Login failed (${response.status})`);
    }
    appendLog('Session created.', { did: payload.did, handle: payload.handle });
    elements.password.value = '';
    const session = {
      did: payload.did,
      handle: payload.handle,
      accessJwt: payload.accessJwt,
      refreshJwt: payload.refreshJwt,
      pdsUrl,
    };
    setSession(session);
    await loadProfile();
  } catch (error) {
    appendLog(`Login error: ${error.message}`, null, 'error');
  } finally {
    setPending(false);
  }
}

function clearSession() {
  setSession(null);
  state.currentRecord = null;
  state.currentRecordCid = null;
  appendLog('Session cleared.');
  renderCurrentProfile(null);
  seedEditorFromRecord(null);
}

function deepClone(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

async function apiFetch(path, { method = 'GET', headers = {}, body, expectJson = true } = {}) {
  if (!state.session) {
    throw new Error('Not authenticated.');
  }
  const url = `${state.session.pdsUrl}/xrpc/${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${state.session.accessJwt}`,
      ...headers,
    },
    body,
  });
  const text = await response.text();
  let data = text;
  if (expectJson) {
    try {
      data = text ? JSON.parse(text) : {};
    } catch (err) {
      const parseError = new Error('Invalid JSON response from server.');
      parseError.status = response.status;
      parseError.data = text;
      throw parseError;
    }
  }
  if (!response.ok) {
    const err = new Error(data?.message || `Request failed (${response.status})`);
    err.status = response.status;
    err.code = data?.error;
    err.data = data;
    throw err;
  }
  return data;
}

async function loadProfile() {
  if (!state.session) return;
  appendLog('Fetching current profile...');
  setPending(true);
  try {
    const params = new URLSearchParams({
      repo: state.session.did,
      collection: 'app.bsky.actor.profile',
      rkey: 'self',
    });
    const data = await apiFetch(`com.atproto.repo.getRecord?${params.toString()}`);
    state.currentRecord = data?.value || null;
    state.currentRecordCid = data?.cid || null;
    appendLog('Profile loaded.', data);
    renderCurrentProfile(state.currentRecord);
    seedEditorFromRecord(state.currentRecord);
  } catch (error) {
    if (error.status === 404) {
      appendLog('Profile record not found; you can create one now.', null, 'error');
      state.currentRecord = null;
      state.currentRecordCid = null;
      renderCurrentProfile(null);
      seedEditorFromRecord(null);
    } else {
      appendLog(`Failed to load profile: ${error.message}`, error.data, 'error');
    }
  } finally {
    setPending(false);
  }
}

function renderCurrentProfile(record) {
  if (!record) {
    elements.currentProfile.innerHTML = '<p>No existing profile record.</p>';
    return;
  }
  const displayName = record.displayName || '(no display name)';
  const description = record.description || '(no bio)';
  const avatarUrl = state.session ? `https://cdn.bsky.app/img/avatar/plain/${encodeURIComponent(state.session.did)}/avatar` : null;
  const bannerUrl = state.session ? `https://cdn.bsky.app/img/banner/plain/${encodeURIComponent(state.session.did)}/banner` : null;
  const avatarInfo = record.avatar ? `<img src="${avatarUrl}" alt="Avatar preview" />` : '<span class="badge">No avatar</span>';
  const bannerInfo = record.banner
    ? `<img src="${bannerUrl}" alt="Banner preview" style="width:100%;max-height:120px;object-fit:cover;border-radius:12px;" />`
    : '<span class="badge">No banner</span>';

  elements.currentProfile.innerHTML = `
    <div class="identity">
      ${avatarInfo}
      <div>
        <div class="name">${escapeHtml(displayName)}</div>
        <div class="handle">${escapeHtml(state.session.handle || state.session.did)}</div>
      </div>
    </div>
    <div class="bio">${escapeHtml(description)}</div>
    <div class="blob-status"><strong>Avatar:</strong> ${record.avatar ? 'Present' : 'Missing'} | <strong>Banner:</strong> ${record.banner ? 'Present' : 'Missing'}</div>
  `;
}

function seedEditorFromRecord(record) {
  elements.displayName.value = record?.displayName || '';
  elements.description.value = record?.description || '';
  elements.clearBio.checked = false;
  elements.clearAvatar.checked = false;
  elements.clearBanner.checked = false;
  updateCounters();
  resetAvatarState();
  resetBannerState();
  toggleAvatarInputs();
  toggleBannerInputs();
}

function updateCounters() {
  const displayLen = elements.displayName.value.length;
  const descriptionLen = elements.description.value.length;
  elements.displayNameCount.textContent = `${displayLen} / ${MAX_DISPLAY_NAME}`;
  elements.descriptionCount.textContent = `${descriptionLen} / ${MAX_DESCRIPTION}`;
  elements.description.disabled = elements.clearBio.checked;
}

elements.displayName.addEventListener('input', updateCounters);
elements.description.addEventListener('input', updateCounters);
elements.clearBio.addEventListener('change', updateCounters);

function resetAvatarState() {
  state.avatar = {
    image: null,
    file: null,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    mimeType: 'image/png',
  };
  elements.avatarZoom.value = '1';
  drawAvatarCanvas();
}

function resetBannerState() {
  if (state.banner.objectUrl) {
    URL.revokeObjectURL(state.banner.objectUrl);
  }
  state.banner = {
    image: null,
    file: null,
    objectUrl: null,
  };
  drawBannerCanvas();
}

elements.avatarFile.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    resetAvatarState();
    toggleAvatarInputs();
    return;
  }
  if (!file.type.startsWith('image/')) {
    appendLog('Avatar file must be an image.', null, 'error');
    event.target.value = '';
    resetAvatarState();
    toggleAvatarInputs();
    return;
  }
  try {
    const image = await loadImageFromFile(file);
    state.avatar.image = image;
    state.avatar.file = file;
    state.avatar.scale = computeInitialScale(image, elements.avatarCanvas);
    state.avatar.mimeType = file.type || 'image/png';
    elements.avatarZoom.value = state.avatar.scale.toFixed(2);
    clampAvatarOffsets();
    drawAvatarCanvas();
    appendLog(`Loaded avatar image (${file.type}, ${(file.size / 1024).toFixed(1)} KB).`);
  } catch (err) {
    appendLog(`Failed to read avatar: ${err.message}`, null, 'error');
    resetAvatarState();
  }
  toggleAvatarInputs();
});

elements.avatarZoom.addEventListener('input', (event) => {
  if (!state.avatar.image || elements.clearAvatar.checked) return;
  state.avatar.scale = parseFloat(event.target.value);
  clampAvatarOffsets();
  drawAvatarCanvas();
});

elements.avatarCanvas.addEventListener('pointerdown', (event) => {
  if (!state.avatar.image || elements.clearAvatar.checked) return;
  state.avatar.dragging = true;
  state.avatar.lastX = event.clientX;
  state.avatar.lastY = event.clientY;
  elements.avatarCanvas.setPointerCapture(event.pointerId);
});

elements.avatarCanvas.addEventListener('pointermove', (event) => {
  if (!state.avatar.dragging || !state.avatar.image || elements.clearAvatar.checked) return;
  event.preventDefault();
  const dx = event.clientX - state.avatar.lastX;
  const dy = event.clientY - state.avatar.lastY;
  state.avatar.lastX = event.clientX;
  state.avatar.lastY = event.clientY;
  state.avatar.offsetX += dx;
  state.avatar.offsetY += dy;
  clampAvatarOffsets();
  drawAvatarCanvas();
});

elements.avatarCanvas.addEventListener('pointerup', endAvatarDrag);
elements.avatarCanvas.addEventListener('pointerleave', endAvatarDrag);

elements.clearAvatar.addEventListener('change', () => {
  if (elements.clearAvatar.checked) {
    elements.avatarFile.value = '';
    resetAvatarState();
  }
  toggleAvatarInputs();
});

elements.bannerFile.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    resetBannerState();
    toggleBannerInputs();
    return;
  }
  if (!file.type.startsWith('image/')) {
    appendLog('Banner file must be an image.', null, 'error');
    event.target.value = '';
    resetBannerState();
    toggleBannerInputs();
    return;
  }
  try {
    if (state.banner.objectUrl) {
      URL.revokeObjectURL(state.banner.objectUrl);
    }
    const objectUrl = URL.createObjectURL(file);
    const image = await loadImageFromUrl(objectUrl);
    state.banner.file = file;
    state.banner.image = image;
    state.banner.objectUrl = objectUrl;
    drawBannerCanvas();
    appendLog(`Loaded banner image (${file.type}, ${(file.size / 1024).toFixed(1)} KB).`);
  } catch (err) {
    appendLog(`Failed to read banner: ${err.message}`, null, 'error');
    resetBannerState();
  }
  toggleBannerInputs();
});

elements.clearBanner.addEventListener('change', () => {
  if (elements.clearBanner.checked) {
    elements.bannerFile.value = '';
    resetBannerState();
  }
  toggleBannerInputs();
});

elements.login.addEventListener('click', createSession);
elements.logout.addEventListener('click', clearSession);
elements.refresh.addEventListener('click', () => loadProfile());
elements.save.addEventListener('click', () => saveProfile());
elements.clearPassword.addEventListener('click', () => {
  elements.password.value = '';
});

elements.credsFile.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.pds) elements.pds.value = data.pds;
    if (data.handle || data.identifier) elements.handle.value = data.handle || data.identifier;
    if (data.password) elements.password.value = data.password;
    appendLog('Loaded credentials from local file.');
  } catch (err) {
    appendLog(`Failed to parse credentials file: ${err.message}`, null, 'error');
  } finally {
    event.target.value = '';
  }
});

function endAvatarDrag(event) {
  if (!state.avatar.dragging) return;
  state.avatar.dragging = false;
  try {
    elements.avatarCanvas.releasePointerCapture(event.pointerId);
  } catch (err) {
    // ignore
  }
}

function drawAvatarCanvas() {
  const canvas = elements.avatarCanvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.1)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state.avatar.image) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Avatar preview', canvas.width / 2, canvas.height / 2);
    return;
  }
  const { image, scale, offsetX, offsetY } = state.avatar;
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const drawX = canvas.width / 2 - drawWidth / 2 + offsetX;
  const drawY = canvas.height / 2 - drawHeight / 2 + offsetY;
  ctx.save();
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  ctx.restore();
}

function drawBannerCanvas() {
  const canvas = elements.bannerCanvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.1)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state.banner.image) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Banner preview', canvas.width / 2, canvas.height / 2);
    return;
  }
  const { image } = state.banner;
  const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const drawX = (canvas.width - drawWidth) / 2;
  const drawY = (canvas.height - drawHeight) / 2;
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

function clampAvatarOffsets() {
  if (!state.avatar.image) return;
  const canvas = elements.avatarCanvas;
  const { image, scale } = state.avatar;
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const limitX = Math.max(0, (drawWidth - canvas.width) / 2);
  const limitY = Math.max(0, (drawHeight - canvas.height) / 2);
  state.avatar.offsetX = clamp(state.avatar.offsetX, -limitX, limitX);
  state.avatar.offsetY = clamp(state.avatar.offsetY, -limitY, limitY);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function loadImageFromFile(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await loadImageFromUrl(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image.'));
    img.src = url;
  });
}

function computeInitialScale(image, canvas) {
  const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
  const clamped = Number.isFinite(scale) ? scale : 1;
  return clamp(clamped, 1, 3);
}

async function saveProfile() {
  if (!state.session) {
    appendLog('Please authenticate first.', null, 'error');
    return;
  }
  if (state.pending) return;

  setPending(true);
  appendLog('Preparing profile update...');
  try {
    const record = state.currentRecord ? deepClone(state.currentRecord) : { $type: 'app.bsky.actor.profile' };

    const displayName = elements.displayName.value.trim();
    if (displayName) {
      record.displayName = displayName;
    } else {
      delete record.displayName;
    }

    if (elements.clearBio.checked) {
      delete record.description;
    } else {
      const description = elements.description.value.trim();
      if (description) {
        record.description = description;
      } else {
        delete record.description;
      }
    }

    const avatarAction = await maybeUploadAvatar();
    const bannerAction = await maybeUploadBanner();
    const avatarOmitted = avatarAction === null;
    const bannerOmitted = bannerAction === null;

    if (avatarAction === 'remove') {
      delete record.avatar;
    } else if (avatarAction && avatarAction.blob) {
      record.avatar = avatarAction.blob;
    }

    if (bannerAction === 'remove') {
      delete record.banner;
    } else if (bannerAction && bannerAction.blob) {
      record.banner = bannerAction.blob;
    }

    const force = elements.forceRewrite.checked;
    if (!force && !hasMeaningfulChange(record, state.currentRecord, { avatarOmitted, bannerOmitted })) {
      appendLog('No changes detected; enable "Force rewrite" to push the same record.', null, 'error');
      return;
    }

    const payload = {
      repo: state.session.did,
      collection: 'app.bsky.actor.profile',
      rkey: 'self',
      record,
      validate: true,
    };

    if (state.currentRecordCid) {
      payload.swapRecord = state.currentRecordCid;
    }

    appendLog('Sending profile update...');
    const response = await apiFetch('com.atproto.repo.putRecord', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    appendLog('Profile updated successfully.', response);
    await loadProfile();
    elements.forceRewrite.checked = false;
  } catch (err) {
    appendLog(`Failed to save profile: ${err.message}`, err.data, 'error');
  } finally {
    setPending(false);
  }
}

async function maybeUploadAvatar() {
  if (elements.clearAvatar.checked) {
    return 'remove';
  }
  if (!state.avatar.image || !state.avatar.file) {
    return null;
  }
  const blob = await canvasToBlob(elements.avatarCanvas, state.avatar.mimeType || 'image/png');
  appendLog('Uploading avatar blob...');
  const response = await apiFetch('com.atproto.repo.uploadBlob', {
    method: 'POST',
    headers: {
      'Content-Type': blob.type || 'image/png',
    },
    body: blob,
  });
  appendLog('Avatar blob uploaded.', response);
  return response;
}

async function maybeUploadBanner() {
  if (elements.clearBanner.checked) {
    return 'remove';
  }
  if (!state.banner.file) {
    return null;
  }
  appendLog('Uploading banner blob...');
  const file = state.banner.file;
  const response = await apiFetch('com.atproto.repo.uploadBlob', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'image/png',
    },
    body: file,
  });
  appendLog('Banner blob uploaded.', response);
  return response;
}

function hasMeaningfulChange(nextRecord, previousRecord, options = {}) {
  const { avatarOmitted = false, bannerOmitted = false } = options;
  const nextComparable = sanitizeRecord(nextRecord);
  const prevComparable = sanitizeRecord(previousRecord);
  if (avatarOmitted) {
    delete nextComparable.avatar;
    delete prevComparable.avatar;
  }
  if (bannerOmitted) {
    delete nextComparable.banner;
    delete prevComparable.banner;
  }
  return JSON.stringify(nextComparable) !== JSON.stringify(prevComparable);
}

function sanitizeRecord(record) {
  if (!record) return {};
  return deepClone(record);
}

function canvasToBlob(canvas, mimeType) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Unable to create image blob.'));
        return;
      }
      resolve(blob);
    }, mimeType);
  });
}

elements.description.disabled = elements.clearBio.checked;
elements.logout.disabled = true;
elements.save.disabled = true;
elements.refresh.disabled = true;
elements.forceRewrite.disabled = true;
enableProfileSection(false);
updateCounters();
drawAvatarCanvas();
drawBannerCanvas();
toggleAvatarInputs();
toggleBannerInputs();

function toggleAvatarInputs() {
  const disabled = elements.clearAvatar.checked;
  elements.avatarFile.disabled = disabled;
  elements.avatarZoom.disabled = disabled || !state.avatar.image;
  elements.avatarCanvas.classList.toggle('disabled', disabled);
}

function toggleBannerInputs() {
  const disabled = elements.clearBanner.checked;
  elements.bannerFile.disabled = disabled;
  elements.bannerCanvas.classList.toggle('disabled', disabled);
}
