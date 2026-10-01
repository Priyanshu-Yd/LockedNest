'use strict';

const browserNav = document.getElementById('browser-nav');
const addressWrap = document.getElementById('address-wrap');
const address = document.getElementById('address');
const scrollRoot = document.getElementById('scroll-root');
const sideNav = document.getElementById('side-nav');
const dashboard = document.getElementById('dashboard');
const settings = document.getElementById('settings');
const panelFiles = document.getElementById('panel-files');
const panelPhotos = document.getElementById('panel-photos');
const panelVideos = document.getElementById('panel-videos');
const panelDownloads = document.getElementById('panel-downloads');
const panelClipboard = document.getElementById('panel-clipboard');
const panelNotes = document.getElementById('panel-notes');
const panelBrowserHub = document.getElementById('panel-browser-hub');
const spaceSelect = document.getElementById('space-select');
const spacesList = document.getElementById('spaces-list');
const recentList = document.getElementById('recent-list');
const recentEmpty = document.getElementById('recent-empty');
const recentError = document.getElementById('recent-error');
const domainsList = document.getElementById('domains-list');
const activityList = document.getElementById('activity-list');
const autolockOptions = document.getElementById('autolock-options');
const settingsSpaceLabel = document.getElementById('settings-space-label');
const greetingTitle = document.getElementById('greeting-title');
const statusChip = document.getElementById('status-chip');
const statSpaces = document.getElementById('stat-spaces');
const statDomains = document.getElementById('stat-domains');
const statAutolock = document.getElementById('stat-autolock');
const statFiles = document.getElementById('stat-files');
const statPhotos = document.getElementById('stat-photos');
const statVideos = document.getElementById('stat-videos');
const statDownloads = document.getElementById('stat-downloads');
const lockScreen = document.getElementById('lock-screen');
const lockBlur = document.getElementById('lock-blur');
const lockSpace = document.getElementById('lock-space');
const lockLast = document.getElementById('lock-last');
const unlockForm = document.getElementById('unlock-form');
const unlockPassword = document.getElementById('unlock-password');
const unlockError = document.getElementById('unlock-error');
const unlockBtn = document.getElementById('unlock-btn');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');
const modalError = document.getElementById('modal-error');

const PERSONAL_PANELS = {
  files: panelFiles,
  photos: panelPhotos,
  videos: panelVideos,
  downloads: panelDownloads,
  clipboard: panelClipboard,
  notes: panelNotes,
  browserHub: panelBrowserHub,
};

let activeNoteId = null;

let isLocked = false;
let shellMode = 'dashboard';
let modalHandler = null;
let lenis = null;
let introPlayed = false;
let privateSpaceId = 'personal';

if (typeof window.createAtmosphere === 'function') {
  window.createAtmosphere(document.getElementById('atmosphere'));
}

function initLenis() {
  if (typeof Lenis !== 'function' || lenis) return;
  lenis = new Lenis({
    wrapper: scrollRoot,
    content: document.getElementById('scroll-content'),
    duration: 1.1,
    smoothWheel: true,
    touchMultiplier: 1.4,
  });
  function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);
}

function playIntro() {
  if (introPlayed || typeof gsap === 'undefined') return;
  introPlayed = true;
  const items = document.querySelectorAll('.reveal');
  gsap.set(items, { y: 28, opacity: 0 });
  gsap.to(items, {
    y: 0,
    opacity: 1,
    duration: 0.7,
    ease: 'power3.out',
    stagger: 0.08,
    delay: 0.05,
  });
}

function bindSpotlight(root) {
  root.querySelectorAll('.spotlight').forEach((card) => {
    if (card.dataset.spotlightBound) return;
    card.dataset.spotlightBound = '1';
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    });
  });
}

function showErrorEl(el, message) {
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.hidden = false;
  el.classList.remove('hidden');
  el.textContent = message;
}

function setBlurBackground(dataUrl) {
  lockBlur.style.backgroundImage = dataUrl ? `url("${dataUrl}")` : '';
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function closeModal() {
  modal.classList.add('hidden');
  modalBody.innerHTML = '';
  showErrorEl(modalError, '');
  modalHandler = null;
}

function openModal({ title, bodyHtml, confirmLabel, onConfirm }) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalConfirm.textContent = confirmLabel || 'Confirm';
  showErrorEl(modalError, '');
  modalHandler = onConfirm;
  modal.classList.remove('hidden');
  if (typeof gsap !== 'undefined') {
    gsap.fromTo(
      '.modal-card',
      { y: 18, opacity: 0, scale: 0.98 },
      { y: 0, opacity: 1, scale: 1, duration: 0.35, ease: 'power3.out' }
    );
  }
}

modalCancel.addEventListener('click', closeModal);
modalConfirm.addEventListener('click', async () => {
  if (!modalHandler) return;
  showErrorEl(modalError, '');
  const result = await modalHandler();
  if (result && result.ok === false) {
    showErrorEl(modalError, result.error || 'Something went wrong.');
    return;
  }
  closeModal();
  await refreshAll();
});

function setSideNavActive(mode) {
  let navMode = mode || 'dashboard';
  if (navMode === 'browser' || navMode === 'browserHub') {
    navMode = 'browser';
  }
  sideNav?.querySelectorAll('.side-link[data-nav]').forEach((btn) => {
    const key = btn.getAttribute('data-nav');
    if (key === 'lock') return;
    btn.classList.toggle(
      'is-active',
      key === navMode || (navMode === 'dashboard' && key === 'dashboard')
    );
  });
}

function applyMode(mode) {
  shellMode = mode || 'dashboard';
  const browsing = shellMode === 'browser';
  const personal = PERSONAL_PANELS[shellMode];

  dashboard.classList.toggle('hidden', shellMode !== 'dashboard');
  settings.classList.toggle('hidden', shellMode !== 'settings');
  for (const [key, panel] of Object.entries(PERSONAL_PANELS)) {
    panel?.classList.toggle('hidden', shellMode !== key);
  }

  browserNav.classList.toggle('hidden', !browsing);
  addressWrap.classList.toggle('hidden', !browsing);
  scrollRoot.classList.toggle('hidden', browsing);
  // Keep side nav visible so Browser / Clipboard / Files stay reachable.
  sideNav?.classList.remove('hidden');
  document.body.classList.toggle('is-browsing', browsing);
  setSideNavActive(shellMode);

  if (!browsing) {
    requestAnimationFrame(() => {
      playIntro();
      bindSpotlight(document);
    });
    if (personal && shellMode === 'notes') {
      void refreshNotes();
    } else if (personal && shellMode !== 'clipboard' && shellMode !== 'browserHub') {
      void loadLibrary(shellMode);
    }
  }
}

function renderBrowserHub(spaces, activeSpaceId, services, recent) {
  const spacesEl = document.getElementById('browser-hub-spaces');
  const servicesEl = document.getElementById('browser-hub-services');
  const servicesEmpty = document.getElementById('browser-hub-services-empty');
  const recentEl = document.getElementById('browser-hub-recent');
  const recentEmpty = document.getElementById('browser-hub-recent-empty');
  if (!spacesEl || !servicesEl) return;

  spacesEl.innerHTML = '';
  for (const space of spaces || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile spotlight';
    const count = space.domains.length;
    btn.innerHTML = `
      <div class="tile-main">
        <div class="tile-title"><span class="swatch ${space.color}"></span>${escapeHtml(space.name)}</div>
        <div class="tile-sub">${
          space.id === activeSpaceId ? 'Current space · ' : ''
        }${
          count === 1
            ? escapeHtml(space.domains[0].domain)
            : `${count} protected websites`
        }</div>
      </div>
    `;
    btn.addEventListener('click', async () => {
      const result = await window.vaultbrowse.openSpace(space.id);
      if (!result.ok) {
        showErrorEl(recentError, result.error || 'Could not open space.');
      }
    });
    spacesEl.appendChild(btn);
  }
  bindSpotlight(spacesEl);

  if (window.VaultPersonal) {
    // Reuse service card renderer into hub grid
    const grid = servicesEl;
    const empty = servicesEmpty;
    grid.innerHTML = '';
    const list = Array.isArray(services) ? services : [];
    empty?.classList.toggle('hidden', list.length > 0);
    for (const service of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'service-card spotlight';
      btn.dataset.type = service.id;
      btn.style.setProperty('--service-accent', service.accent || '#d7ff3c');
      btn.innerHTML = `
        <span class="service-mark">${escapeHtml(service.mark || '?')}</span>
        <span class="service-name">${escapeHtml(service.name)}</span>
        <span class="service-desc">${escapeHtml(service.description || 'Open in private browser')}</span>
      `;
      btn.addEventListener('click', () => openService(service));
      grid.appendChild(btn);
    }
    bindSpotlight(grid);
  }

  if (recentEl) {
    recentEl.innerHTML = '';
    const rows = Array.isArray(recent) ? recent : [];
    recentEmpty?.classList.toggle('hidden', rows.length > 0);
    for (const item of rows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tile spotlight';
      btn.innerHTML = `
        <div class="tile-main">
          <div class="tile-title">${escapeHtml(item.displayName)}</div>
          <div class="tile-sub">${escapeHtml(item.domain)}</div>
        </div>
      `;
      btn.addEventListener('click', async () => {
        showErrorEl(recentError, '');
        const result = await window.vaultbrowse.openRecent(item.domain);
        if (!result.ok) {
          showErrorEl(recentError, result.error || 'Could not open website.');
        }
      });
      recentEl.appendChild(btn);
    }
    bindSpotlight(recentEl);
  }
}

function renderSpaces(spaces, activeSpaceId) {
  spaceSelect.innerHTML = '';
  for (const space of spaces) {
    const opt = document.createElement('option');
    opt.value = space.id;
    opt.textContent = space.name;
    if (space.id === activeSpaceId) opt.selected = true;
    spaceSelect.appendChild(opt);
  }

  spacesList.innerHTML = '';
  for (const space of spaces) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile spotlight';
    const count = space.domains.length;
    btn.innerHTML = `
      <div class="tile-main">
        <div class="tile-title"><span class="swatch ${space.color}"></span>${escapeHtml(space.name)}</div>
        <div class="tile-sub">${
          count === 1
            ? escapeHtml(space.domains[0].domain)
            : `${count} protected websites`
        }</div>
      </div>
    `;
    btn.addEventListener('click', async () => {
      const result = await window.vaultbrowse.openSpace(space.id);
      if (!result.ok) {
        showErrorEl(recentError, result.error || 'Could not open space.');
      }
    });
    spacesList.appendChild(btn);
  }
  bindSpotlight(spacesList);
}

function renderRecent(recent) {
  recentList.innerHTML = '';
  recentEmpty.classList.toggle('hidden', recent.length > 0);
  for (const item of recent) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile spotlight';
    btn.innerHTML = `
      <div class="tile-main">
        <div class="tile-title">${escapeHtml(item.displayName)}</div>
        <div class="tile-sub">${escapeHtml(item.domain)}</div>
      </div>
    `;
    btn.addEventListener('click', async () => {
      showErrorEl(recentError, '');
      const result = await window.vaultbrowse.openRecent(item.domain);
      if (!result.ok) {
        showErrorEl(
          recentError,
          result.code === 'NOT_ALLOWED'
            ? 'This website is no longer allowed. Manage it from Settings.'
            : result.error || 'Could not open website.'
        );
      }
    });
    recentList.appendChild(btn);
  }
  bindSpotlight(recentList);
}

function renderDomains(space) {
  domainsList.innerHTML = '';
  settingsSpaceLabel.textContent = space ? `Space: ${space.name}` : '';
  if (!space) return;
  for (const entry of space.domains) {
    const row = document.createElement('div');
    row.className = 'domain-row';
    row.innerHTML = `
      <div>
        <div>${escapeHtml(entry.domain)}</div>
        <div class="tile-sub">${entry.allowSubdomains ? 'Includes subdomains' : 'Exact domain only'}</div>
      </div>
      <button type="button" title="Remove" aria-label="Remove ${escapeAttr(entry.domain)}">×</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      confirmRemoveDomain(space.id, entry.domain);
    });
    domainsList.appendChild(row);
  }
}

function renderActivity(events) {
  activityList.innerHTML = '';
  if (!events.length) {
    activityList.innerHTML = '<p class="empty">No security events yet.</p>';
    return;
  }
  for (const event of events) {
    const row = document.createElement('div');
    row.className = 'activity-item';
    const meta = event.meta?.domain
      ? ` · ${event.meta.domain}`
      : event.meta?.category
        ? ` · ${event.meta.category}`
        : '';
    row.innerHTML = `
      <span>${escapeHtml(event.label || event.type)}${escapeHtml(meta)}</span>
      <span>${escapeHtml(formatTime(event.at))}</span>
    `;
    activityList.appendChild(row);
  }
}

function renderAutolock(autoLock, options) {
  autolockOptions.innerHTML = '';
  const current = autoLock.enabled ? autoLock.timeoutMinutes : 0;
  for (const opt of options) {
    const label = document.createElement('label');
    label.innerHTML = `
      <input type="radio" name="autolock" value="${opt.value}" ${
      opt.value === current ? 'checked' : ''
    } />
      <span>${escapeHtml(opt.label)}</span>
    `;
    label.querySelector('input').addEventListener('change', async (e) => {
      await window.vaultbrowse.setAutoLockMinutes(Number(e.target.value));
      await refreshAll();
    });
    autolockOptions.appendChild(label);
  }
}

function renderPrivacy(privacy, clipboardStatus) {
  const lockOs = document.getElementById('privacy-lock-os');
  const clearClip = document.getElementById('privacy-clear-clipboard');
  const clearRecent = document.getElementById('privacy-clear-recent');
  const clearBrowsing = document.getElementById('privacy-clear-browsing');
  const clearBrowsingPanic = document.getElementById('privacy-clear-browsing-panic');
  const blur = document.getElementById('privacy-blur');
  const retention = document.getElementById('clipboard-retention');
  if (!lockOs || !privacy) return;

  lockOs.checked = privacy.lockOnWindowsLock !== false;
  clearClip.checked = privacy.clearClipboardOnLock !== false;
  clearRecent.checked = Boolean(privacy.clearRecentFilesOnLock);
  if (clearBrowsing) clearBrowsing.checked = Boolean(privacy.clearBrowsingDataOnLock);
  if (clearBrowsingPanic) clearBrowsingPanic.checked = privacy.clearBrowsingDataOnPanic !== false;
  blur.checked = privacy.privacyBlur !== false;

  const bind = (el, key) => {
    if (el.dataset.bound === '1') return;
    el.dataset.bound = '1';
    el.addEventListener('change', async () => {
      await window.vaultbrowse.updatePrivacySettings({ [key]: el.checked });
      await refreshAll();
    });
  };
  bind(lockOs, 'lockOnWindowsLock');
  bind(clearClip, 'clearClipboardOnLock');
  bind(clearRecent, 'clearRecentFilesOnLock');
  if (clearBrowsing) bind(clearBrowsing, 'clearBrowsingDataOnLock');
  if (clearBrowsingPanic) bind(clearBrowsingPanic, 'clearBrowsingDataOnPanic');
  bind(blur, 'privacyBlur');

  if (retention) {
    retention.innerHTML = '';
    const options = clipboardStatus?.options || [
      { value: 30, label: '30 seconds' },
      { value: 60, label: '1 minute' },
      { value: 300, label: '5 minutes' },
      { value: 0, label: 'Until lock' },
    ];
    const current = Number(privacy.clipboardRetentionSeconds || 0);
    for (const opt of options) {
      const label = document.createElement('label');
      label.innerHTML = `
        <input type="radio" name="clip-retention" value="${opt.value}" ${
        opt.value === current ? 'checked' : ''
      } />
        <span>${escapeHtml(opt.label)}</span>
      `;
      label.querySelector('input').addEventListener('change', async (e) => {
        await window.vaultbrowse.updatePrivacySettings({
          clipboardRetentionSeconds: Number(e.target.value),
        });
        await refreshAll();
      });
      retention.appendChild(label);
    }
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

async function openService(service) {
  showErrorEl(recentError, '');
  const url = `https://${service.domain}/`;
  const result =
    service.action === 'openSpace'
      ? await window.vaultbrowse.openSpace(service.spaceId)
      : await window.vaultbrowse.openSpace(service.spaceId, url);
  if (!result?.ok) {
    showErrorEl(recentError, result?.error || 'This app is not available in your spaces.');
  }
}

async function openLibraryItem(category, item, allItems) {
  if (!window.VaultPersonal) return;
  if (category === 'photos' || item.type === 'image' || item.viewable) {
    await window.VaultPersonal.openPhotoViewer(
      category === 'photos' ? allItems : [item],
      item
    );
    return;
  }
  if (category === 'videos' || item.type === 'video' || item.playable) {
    await window.VaultPersonal.openVideoViewer({ ...item, category });
  }
}

async function loadLibrary(category) {
  if (!window.VaultPersonal || isLocked) return;
  const loaded = await window.VaultPersonal.loadCategory(category);
  if (!loaded.ok) {
    window.VaultPersonal.renderFileList(category, []);
    return;
  }
  window.VaultPersonal.renderFileList(category, loaded.items, {
    onRename: (item) => confirmRename(category, item),
    onDelete: (item) => confirmDelete(category, item),
    onOpen: (item, all) => openLibraryItem(category, item, all),
  });
}

async function runImport(category) {
  if (!window.VaultPersonal) return;
  window.VaultPersonal.setStatus(category, 'Importing…');
  const result = await window.vaultbrowse.importPrivateFiles(
    window.VaultPersonal.PRIVATE_SPACE_ID,
    category
  );
  if (result?.cancelled) {
    window.VaultPersonal.setStatus(category, '');
    return;
  }
  if (!result?.ok) {
    window.VaultPersonal.setStatus(
      category,
      result?.error || 'File could not be imported.',
      true
    );
    return;
  }
  window.VaultPersonal.setStatus(
    category,
    `Imported ${result.imported.length} file${result.imported.length === 1 ? '' : 's'}.`
  );
  await loadLibrary(category);
  await refreshAll();
}

async function runDropImport(category, paths) {
  if (!paths?.length || !window.VaultPersonal) return;
  window.VaultPersonal.setStatus(category, 'Importing…');
  const result = await window.vaultbrowse.importDroppedFiles(
    window.VaultPersonal.PRIVATE_SPACE_ID,
    category,
    paths
  );
  if (!result?.ok) {
    window.VaultPersonal.setStatus(
      category,
      result?.error || 'File could not be imported.',
      true
    );
    return;
  }
  window.VaultPersonal.setStatus(
    category,
    `Imported ${result.imported.length} file${result.imported.length === 1 ? '' : 's'}.`
  );
  await loadLibrary(category);
  await refreshAll();
}

function confirmRename(category, item) {
  openModal({
    title: 'Rename',
    bodyHtml: `
      <label for="rename-input">New name</label>
      <input id="rename-input" type="text" value="${escapeAttr(item.name)}" />
    `,
    confirmLabel: 'Rename',
    onConfirm: async () => {
      const next = document.getElementById('rename-input').value;
      const result = await window.vaultbrowse.renamePrivateFile(
        privateSpaceId,
        category,
        item.relativePath,
        next
      );
      if (result.ok) await loadLibrary(category);
      return result;
    },
  });
}

function confirmDelete(category, item) {
  openModal({
    title: 'Delete from your Nest?',
    bodyHtml: `<p class="muted">This removes the item from your protected local workspace.</p>`,
    confirmLabel: 'Delete',
    onConfirm: async () => {
      const result = await window.vaultbrowse.deletePrivateFile(
        privateSpaceId,
        category,
        item.relativePath
      );
      if (result.ok) await loadLibrary(category);
      return result;
    },
  });
}

function applyLockState(state) {
  isLocked = Boolean(state?.locked);
  document.body.classList.toggle('is-locked', isLocked);
  lockScreen.classList.toggle('hidden', !isLocked);

  if (state?.autoLock) {
    statAutolock.textContent = state.autoLock.enabled
      ? `${state.autoLock.timeoutMinutes} min`
      : 'Off';
  }

  if (state?.spaceName) {
    lockSpace.textContent = `${state.spaceName} Nest`;
  }
  if (state?.lastUnlockedAt) {
    lockLast.textContent = `Last unlocked: ${formatTime(state.lastUnlockedAt)}`;
  } else if (isLocked) {
    lockLast.textContent = '';
  }

  if (Object.prototype.hasOwnProperty.call(state || {}, 'blurBackground')) {
    setBlurBackground(state.blurBackground);
  }

  if (isLocked) {
    window.VaultPersonal?.clearMediaViewers();
    const clipInput = document.getElementById('clipboard-input');
    if (clipInput) clipInput.value = '';
    if (greetingTitle) greetingTitle.textContent = 'Your Nest is locked';
    statusChip?.classList.remove('is-active');
    statusChip?.classList.add('is-locked');
    unlockPassword.value = '';
    showErrorEl(unlockError, '');
    unlockBtn.disabled = false;
    if (typeof gsap !== 'undefined') {
      gsap.fromTo(
        '.lock-card',
        { y: 24, opacity: 0, scale: 0.97 },
        { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'power3.out' }
      );
    }
    setTimeout(() => unlockPassword.focus(), 40);
  } else {
    setBlurBackground(null);
    if (greetingTitle && window.VaultPersonal) {
      greetingTitle.textContent = window.VaultPersonal.greetingForNow();
    }
    statusChip?.classList.add('is-active');
    statusChip?.classList.remove('is-locked');
  }
}

async function refreshAll() {
  const dashboardData = await window.vaultbrowse.getDashboard();
  const {
    spaces,
    activeSpaceId,
    recent,
    recentFiles,
    autoLock,
    options,
    activity,
    locked,
    lastUnlockedAt,
    activeSpace,
    services,
    privateStats,
    privateSpaceId: psId,
    privacy,
    clipboard,
  } = dashboardData;

  if (psId) privateSpaceId = psId;

  renderSpaces(spaces, activeSpaceId);
  renderRecent(recent || []);
  renderDomains(activeSpace || spaces.find((s) => s.id === activeSpaceId));
  renderActivity(activity || []);
  renderAutolock(autoLock, options || []);
  renderPrivacy(privacy || {}, clipboard || {});

  if (window.VaultPersonal) {
    window.VaultPersonal.renderServices(services || [], openService);
    window.VaultPersonal.renderRecentFiles(recentFiles || [], async (item) => {
      const opened = await window.vaultbrowse.openRecentFile(
        item.spaceId,
        item.category,
        item.relativePath
      );
      if (!opened?.ok) {
        showErrorEl(recentError, opened?.error || 'This file is no longer available.');
        await refreshAll();
        return;
      }
      if (item.category === 'downloads') {
        await goPersonal('downloads');
        if (opened.item?.viewable || opened.item?.playable || opened.item?.type === 'image' || opened.item?.type === 'video') {
          await openLibraryItem('downloads', opened.item, [opened.item]);
        }
      } else if (item.category === 'photos' || opened.item?.type === 'image') {
        await goPersonal('photos');
        await openLibraryItem('photos', opened.item, [opened.item]);
      } else if (item.category === 'videos' || opened.item?.type === 'video') {
        await goPersonal('videos');
        await openLibraryItem('videos', opened.item, [opened.item]);
      } else {
        await goPersonal('files');
        if (opened.item?.viewable || opened.item?.type === 'image') {
          await openLibraryItem('files', opened.item, [opened.item]);
        }
      }
    });
    if (greetingTitle && !locked) {
      greetingTitle.textContent = window.VaultPersonal.greetingForNow();
    }
  }

  const stats = privateStats || {};
  if (statFiles) statFiles.textContent = String(stats.files ?? 0);
  if (statPhotos) statPhotos.textContent = String(stats.photos ?? 0);
  if (statVideos) statVideos.textContent = String(stats.videos ?? 0);
  if (statDownloads) statDownloads.textContent = String(stats.downloads ?? 0);

  statSpaces.textContent = String(spaces.length);
  statDomains.textContent = String(
    spaces.reduce((sum, space) => sum + space.domains.length, 0)
  );
  statAutolock.textContent = autoLock.enabled ? `${autoLock.timeoutMinutes} min` : 'Off';

  applyLockState({
    locked,
    autoLock,
    spaceName: activeSpace?.name,
    lastUnlockedAt,
  });

  if (PERSONAL_PANELS[shellMode] && !locked && shellMode === 'notes') {
    await refreshNotes();
  } else if (
    PERSONAL_PANELS[shellMode] &&
    !locked &&
    shellMode !== 'clipboard' &&
    shellMode !== 'browserHub'
  ) {
    await loadLibrary(shellMode);
  }

  if (!locked) {
    renderBrowserHub(spaces, activeSpaceId, services || [], recent || []);
  }

  bindSpotlight(document);
}

function confirmRemoveDomain(spaceId, domain) {
  openModal({
    title: 'Remove website?',
    bodyHtml: `<p><strong>${escapeHtml(domain)}</strong></p>
      <p class="muted">This website will no longer be accessible through your Nest.</p>`,
    confirmLabel: 'Remove',
    onConfirm: async () => window.vaultbrowse.removeDomain(spaceId, domain),
  });
}

async function goHome() {
  await window.vaultbrowse.showDashboard();
  applyMode('dashboard');
  await refreshAll();
}

async function goPersonal(section) {
  const result = await window.vaultbrowse.showPersonal(section);
  if (!result?.ok) {
    showErrorEl(recentError, result?.error || 'Could not open section.');
    return;
  }
  applyMode(section);
  await refreshAll();
}

document.getElementById('btn-add-domain').addEventListener('click', () => {
  const spaceId = spaceSelect.value;
  openModal({
    title: 'Add Protected Website',
    bodyHtml: `
      <label for="add-domain-input">Domain</label>
      <input id="add-domain-input" type="text" placeholder="example.com" />
      <label class="check"><input id="add-domain-sub" type="checkbox" /> Allow subdomains</label>
    `,
    confirmLabel: 'Add Website',
    onConfirm: async () => {
      const domain = document.getElementById('add-domain-input').value;
      const allowSubdomains = document.getElementById('add-domain-sub').checked;
      return window.vaultbrowse.addDomain(spaceId, domain, allowSubdomains);
    },
  });
  setTimeout(() => document.getElementById('add-domain-input')?.focus(), 30);
});

document.getElementById('btn-add-space').addEventListener('click', () => {
  openModal({
    title: 'Create Protected Space',
    bodyHtml: `
      <label for="space-name">Name</label>
      <input id="space-name" type="text" placeholder="Work" />
      <label for="space-domain">First website (optional)</label>
      <input id="space-domain" type="text" placeholder="github.com" />
      <label class="check"><input id="space-domain-sub" type="checkbox" /> Allow subdomains</label>
    `,
    confirmLabel: 'Create',
    onConfirm: async () => {
      const name = document.getElementById('space-name').value;
      const domain = document.getElementById('space-domain').value.trim();
      const allowSubdomains = document.getElementById('space-domain-sub').checked;
      const initial = domain ? [{ domain, allowSubdomains }] : [];
      return window.vaultbrowse.createSpace(name, initial);
    },
  });
});

document.getElementById('btn-change-password').addEventListener('click', () => {
  openModal({
    title: 'Change Nest password',
    bodyHtml: `
      <label for="pw-current">Current Nest password</label>
      <input id="pw-current" type="password" />
      <label for="pw-new">New Nest password</label>
      <input id="pw-new" type="password" />
      <label for="pw-confirm">Confirm Nest password</label>
      <input id="pw-confirm" type="password" />
    `,
    confirmLabel: 'Save',
    onConfirm: async () =>
      window.vaultbrowse.changePassword(
        document.getElementById('pw-current').value,
        document.getElementById('pw-new').value,
        document.getElementById('pw-confirm').value
      ),
  });
});

document.getElementById('btn-clear-activity').addEventListener('click', () => {
  openModal({
    title: 'Clear Activity Log?',
    bodyHtml: '<p class="muted">This permanently deletes local security activity history.</p>',
    confirmLabel: 'Clear',
    onConfirm: async () => window.vaultbrowse.clearActivity(),
  });
});

spaceSelect.addEventListener('change', async () => {
  const nextId = spaceSelect.value;
  if (shellMode === 'browser') {
    const opened = await window.vaultbrowse.openSpace(nextId);
    if (!opened.ok) {
      showErrorEl(recentError, opened.error || 'Could not open space.');
    }
    return;
  }
  const result = await window.vaultbrowse.switchSpace(nextId);
  if (!result.ok) {
    showErrorEl(recentError, result.error || 'Could not switch space.');
  }
  await refreshAll();
});

document.getElementById('btn-home').addEventListener('click', () => goHome());
document.getElementById('btn-settings').addEventListener('click', async () => {
  await window.vaultbrowse.showSettings();
  applyMode('settings');
  await refreshAll();
});
document.getElementById('btn-settings-home').addEventListener('click', () => goHome());

document.getElementById('btn-lock').addEventListener('click', () => window.vaultbrowse.lock());
document.getElementById('btn-lock-now').addEventListener('click', () => window.vaultbrowse.lock());
document.getElementById('btn-settings-lock').addEventListener('click', () => window.vaultbrowse.lock());
document.getElementById('btn-panic').addEventListener('click', () => window.vaultbrowse.panicLock());

document.getElementById('btn-back').addEventListener('click', () => window.vaultbrowse.navigate('back'));
document.getElementById('btn-forward').addEventListener('click', () => window.vaultbrowse.navigate('forward'));
document.getElementById('btn-reload').addEventListener('click', () => window.vaultbrowse.navigate('reload'));

sideNav?.addEventListener('click', async (event) => {
  const btn = event.target.closest('.side-link[data-nav]');
  if (!btn) return;
  const nav = btn.getAttribute('data-nav');
  if (nav === 'lock') {
    window.vaultbrowse.lock();
    return;
  }
  if (nav === 'dashboard') {
    await goHome();
    return;
  }
  if (nav === 'settings') {
    await window.vaultbrowse.showSettings();
    applyMode('settings');
    await refreshAll();
    return;
  }
  if (nav === 'browser') {
    // Full open-web browser starting at Google (not WhatsApp).
    try {
      const result = await window.vaultbrowse.openSpace('web', 'https://www.google.com/');
      if (!result?.ok) {
        openModal({
          title: 'Browser',
          bodyHtml: `<p>${escapeHtml(result?.error || 'Could not open the internet browser.')}</p>`,
          confirmLabel: 'OK',
          onConfirm: async () => ({ ok: true }),
        });
      }
    } catch (error) {
      openModal({
        title: 'Browser',
        bodyHtml: `<p>${escapeHtml(error?.message || 'Could not open the internet browser.')}</p>`,
        confirmLabel: 'OK',
        onConfirm: async () => ({ ok: true }),
      });
    }
    return;
  }
  if (PERSONAL_PANELS[nav]) {
    await goPersonal(nav);
  }
});

document.getElementById('address-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = address.value.trim();
  if (!value) return;
  const result = await window.vaultbrowse.navigateTo(value);
  if (!result?.ok) {
    showErrorEl(recentError, result?.error || 'This website is not allowed.');
    return;
  }
  if (result.url) {
    address.value = result.url;
  }
});

document.getElementById('browser-hub-open-downloads')?.addEventListener('click', () => {
  void goPersonal('downloads');
});

document.querySelectorAll('[data-open-section]').forEach((el) => {
  el.addEventListener('click', async () => {
    const section = el.getAttribute('data-open-section');
    if (PERSONAL_PANELS[section]) await goPersonal(section);
  });
});

document.querySelectorAll('.btn-new-folder').forEach((btn) => {
  btn.addEventListener('click', () => {
    const category = btn.getAttribute('data-category') || 'files';
    openModal({
      title: 'New folder',
      bodyHtml: `
        <label for="folder-name">Folder name</label>
        <input id="folder-name" type="text" placeholder="Documents" />
      `,
      confirmLabel: 'Create',
      onConfirm: async () => {
        const name = document.getElementById('folder-name').value;
        const result = await window.vaultbrowse.createPrivateFolder(
          privateSpaceId,
          category,
          '',
          name
        );
        if (result.ok) await loadLibrary(category);
        return result;
      },
    });
  });
});

document.querySelectorAll('.btn-import').forEach((btn) => {
  btn.addEventListener('click', () => {
    const category = btn.getAttribute('data-category') || 'files';
    void runImport(category);
  });
});

window.VaultPersonal?.bindDropZones((category, paths) => {
  void runDropImport(category, paths);
});

function setClipboardStatus(message, isError) {
  const el = document.getElementById('clipboard-status');
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.classList.remove('hidden');
  el.classList.toggle('is-error', Boolean(isError));
  el.textContent = message;
}

document.getElementById('btn-clipboard-save')?.addEventListener('click', async () => {
  const text = document.getElementById('clipboard-input')?.value || '';
  const result = await window.vaultbrowse.setPrivateClipboard(text);
  if (!result?.ok) {
    setClipboardStatus(result?.error || 'Could not save clipboard.', true);
    return;
  }
  setClipboardStatus('Saved to Private Clipboard.');
  const input = document.getElementById('clipboard-input');
  if (input) input.value = '';
});

document.getElementById('btn-clipboard-load')?.addEventListener('click', async () => {
  const result = await window.vaultbrowse.getPrivateClipboard();
  if (!result?.ok) {
    setClipboardStatus(result?.error || 'Could not load clipboard.', true);
    return;
  }
  if (result.empty) {
    setClipboardStatus('Private Clipboard is empty.');
    return;
  }
  const input = document.getElementById('clipboard-input');
  if (input) input.value = result.text || '';
  setClipboardStatus('Loaded from Private Clipboard.');
});

function setNotesStatus(message, isError = false) {
  const el = document.getElementById('notes-status');
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.classList.remove('hidden');
  el.textContent = message;
  el.classList.toggle('is-error', Boolean(isError));
}

function setBackupStatus(message, isError = false) {
  const el = document.getElementById('backup-status');
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.classList.remove('hidden');
  el.textContent = message;
  el.classList.toggle('is-error', Boolean(isError));
}

async function selectNote(id) {
  activeNoteId = id;
  const titleEl = document.getElementById('note-title');
  const bodyEl = document.getElementById('note-body');
  if (!id) {
    if (titleEl) titleEl.value = '';
    if (bodyEl) bodyEl.value = '';
    document.querySelectorAll('.note-row').forEach((row) => row.classList.remove('is-active'));
    return;
  }
  const result = await window.vaultbrowse.getNote(id);
  if (!result?.ok) {
    setNotesStatus(result?.error || 'Could not open note.', true);
    return;
  }
  if (titleEl) titleEl.value = result.note.title || '';
  if (bodyEl) bodyEl.value = result.note.body || '';
  document.querySelectorAll('.note-row').forEach((row) => {
    row.classList.toggle('is-active', row.getAttribute('data-id') === id);
  });
  setNotesStatus('');
}

async function refreshNotes() {
  const list = document.getElementById('notes-list');
  if (!list || isLocked) return;
  const result = await window.vaultbrowse.listNotes();
  if (!result?.ok) {
    list.innerHTML = '';
    setNotesStatus(result?.error || 'Could not load notes.', true);
    return;
  }
  list.innerHTML = '';
  for (const note of result.notes || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `note-row${note.id === activeNoteId ? ' is-active' : ''}`;
    btn.setAttribute('data-id', note.id);
    btn.innerHTML = `
      <strong>${escapeHtml(note.title || 'Untitled')}</strong>
      <span>${escapeHtml(note.preview || 'Empty note')}</span>
    `;
    btn.addEventListener('click', () => {
      void selectNote(note.id);
    });
    list.appendChild(btn);
  }
  if (activeNoteId && !(result.notes || []).some((n) => n.id === activeNoteId)) {
    activeNoteId = null;
    await selectNote(null);
  }
}

document.getElementById('btn-note-new')?.addEventListener('click', async () => {
  const created = await window.vaultbrowse.createNote('Untitled', '');
  if (!created?.ok) {
    setNotesStatus(created?.error || 'Could not create note.', true);
    return;
  }
  activeNoteId = created.note.id;
  await refreshNotes();
  await selectNote(created.note.id);
  document.getElementById('note-title')?.focus();
});

document.getElementById('btn-note-save')?.addEventListener('click', async () => {
  const title = document.getElementById('note-title')?.value || '';
  const body = document.getElementById('note-body')?.value || '';
  if (!activeNoteId) {
    const created = await window.vaultbrowse.createNote(title, body);
    if (!created?.ok) {
      setNotesStatus(created?.error || 'Could not save note.', true);
      return;
    }
    activeNoteId = created.note.id;
  } else {
    const updated = await window.vaultbrowse.updateNote(activeNoteId, title, body);
    if (!updated?.ok) {
      setNotesStatus(updated?.error || 'Could not save note.', true);
      return;
    }
  }
  setNotesStatus('Saved.');
  await refreshNotes();
});

document.getElementById('btn-note-delete')?.addEventListener('click', async () => {
  if (!activeNoteId) {
    setNotesStatus('Select a note to delete.', true);
    return;
  }
  const id = activeNoteId;
  openModal({
    title: 'Delete note?',
    bodyHtml: '<p>This note will be removed from your vault.</p>',
    confirmLabel: 'Delete',
    onConfirm: async () => {
      const deleted = await window.vaultbrowse.deleteNote(id);
      if (!deleted?.ok) {
        return deleted;
      }
      activeNoteId = null;
      await selectNote(null);
      await refreshNotes();
      setNotesStatus('Note deleted.');
      return { ok: true };
    },
  });
});

document.getElementById('btn-panic-lock')?.addEventListener('click', () => {
  window.vaultbrowse.panicLock();
});

document.getElementById('btn-backup-export')?.addEventListener('click', () => {
  openModal({
    title: 'Export encrypted backup',
    bodyHtml: `
      <p class="muted">Enter your Nest password to encrypt the backup file.</p>
      <label class="field-label" for="backup-password">Nest password</label>
      <input id="backup-password" type="password" autocomplete="current-password" />
    `,
    confirmLabel: 'Export',
    onConfirm: async () => {
      const password = document.getElementById('backup-password')?.value || '';
      const result = await window.vaultbrowse.exportVaultBackup(password);
      if (result?.cancelled) {
        return { ok: true };
      }
      if (!result?.ok) {
        return result;
      }
      setBackupStatus(`Backup saved (${result.fileCount || 0} files).`);
      return { ok: true };
    },
  });
});

document.getElementById('btn-backup-import')?.addEventListener('click', () => {
  openModal({
    title: 'Restore encrypted backup',
    bodyHtml: `
      <p class="muted">This merges backup files into your Nest. Enter your Nest password.</p>
      <label class="field-label" for="backup-password">Nest password</label>
      <input id="backup-password" type="password" autocomplete="current-password" />
    `,
    confirmLabel: 'Restore',
    onConfirm: async () => {
      const password = document.getElementById('backup-password')?.value || '';
      const result = await window.vaultbrowse.importVaultBackup(password);
      if (result?.cancelled) {
        return { ok: true };
      }
      if (!result?.ok) {
        return result;
      }
      setBackupStatus(`Restored ${result.restored || 0} files.`);
      await refreshAll();
      return { ok: true };
    },
  });
});

document.getElementById('btn-clipboard-clear')?.addEventListener('click', async () => {
  await window.vaultbrowse.clearPrivateClipboard();
  const input = document.getElementById('clipboard-input');
  if (input) input.value = '';
  setClipboardStatus('Private Clipboard cleared.');
});

unlockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showErrorEl(unlockError, '');
  unlockBtn.disabled = true;
  try {
    const result = await window.vaultbrowse.unlock(unlockPassword.value);
    if (!result?.ok) {
      showErrorEl(unlockError, result?.error || 'Incorrect password.');
      unlockPassword.value = '';
      unlockPassword.focus();
      unlockBtn.disabled = false;
      return;
    }
    await refreshAll();
  } catch {
    showErrorEl(unlockError, 'Could not unlock your Nest.');
    unlockBtn.disabled = false;
  }
});

window.vaultbrowse.onUrlChange((url) => {
  if (typeof url === 'string') address.value = url;
});

window.vaultbrowse.onLockChange((state) => {
  if (state?.clearPrivateMedia || state?.locked) {
    window.VaultPersonal?.clearMediaViewers();
  }
  if (state?.clearPrivateClipboard || state?.locked) {
    const clipInput = document.getElementById('clipboard-input');
    if (clipInput) clipInput.value = '';
  }
  if (state?.clearNotesEditor || state?.locked) {
    activeNoteId = null;
    const titleEl = document.getElementById('note-title');
    const bodyEl = document.getElementById('note-body');
    if (titleEl) titleEl.value = '';
    if (bodyEl) bodyEl.value = '';
    const list = document.getElementById('notes-list');
    if (list) list.innerHTML = '';
  }
  applyLockState(state);
});

window.vaultbrowse.onShellMode((payload) => {
  applyMode(payload?.mode);
  if (payload?.mode === 'browser' && payload.url) {
    address.value = payload.url;
  }
  refreshAll();
});

window.vaultbrowse.onRecentUpdated((recent) => {
  renderRecent(recent || []);
});

let lastActivityPing = 0;
function pingActivity() {
  if (isLocked) return;
  const now = Date.now();
  if (now - lastActivityPing < 2000) return;
  lastActivityPing = now;
  window.vaultbrowse.noteActivity();
}
['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach((name) => {
  window.addEventListener(name, pingActivity, { passive: true });
});

initLenis();
applyMode('dashboard');
refreshAll().then(() => {
  playIntro();
  bindSpotlight(document);
});
