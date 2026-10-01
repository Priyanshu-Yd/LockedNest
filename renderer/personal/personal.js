'use strict';

/**
 * Nest UI helpers (vanilla). Relies on window.vaultbrowse IPC only.
 * Internal API name VaultPersonal kept for compatibility.
 */
window.VaultPersonal = (() => {
  const PRIVATE_SPACE_ID = 'personal';

  let photoItems = [];
  let photoIndex = 0;

  function greetingForNow() {
    return 'Welcome to your Nest';
  }

  function formatBytes(size) {
    const n = Number(size) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function typeLabel(item) {
    if (item.isDirectory) return 'Folder';
    if (item.type === 'image') return 'Image';
    if (item.type === 'video') return 'Video';
    if (item.type === 'document') return 'Document';
    if (item.type === 'executable') return 'Stored privately';
    return 'File';
  }

  function markForType(item) {
    if (item.isDirectory) return 'DIR';
    if (item.type === 'image') return 'IMG';
    if (item.type === 'video') return 'VID';
    if (item.type === 'document') return 'DOC';
    return 'FILE';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setStatus(category, message, isError) {
    const el = document.getElementById(`${category}-status`);
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

  function renderServices(services, onOpen) {
    const grid = document.getElementById('services-grid');
    const empty = document.getElementById('services-empty');
    if (!grid) return;
    grid.innerHTML = '';
    const list = Array.isArray(services) ? services : [];
    empty?.classList.toggle('hidden', list.length > 0);
    for (const service of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'service-card spotlight';
      btn.dataset.type = service.id;
      btn.style.setProperty('--service-accent', service.accent || '#5eb8a8');
      btn.innerHTML = `
        <span class="service-mark">${escapeHtml(service.mark || '?')}</span>
        <span class="service-name">${escapeHtml(service.name)}</span>
        <span class="service-desc">${escapeHtml(service.description || '')}</span>
      `;
      btn.addEventListener('click', () => onOpen(service));
      grid.appendChild(btn);
    }
  }

  function renderRecentFiles(items, onOpen) {
    const list = document.getElementById('recent-files-list');
    const empty = document.getElementById('recent-files-empty');
    if (!list) return;
    list.innerHTML = '';
    const rows = Array.isArray(items) ? items : [];
    empty?.classList.toggle('hidden', rows.length > 0);
    for (const item of rows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tile spotlight';
      btn.innerHTML = `
        <div class="tile-main">
          <div class="tile-title">${escapeHtml(item.name)}</div>
          <div class="tile-sub">${escapeHtml(item.action)} · ${escapeHtml(item.category)}</div>
        </div>
      `;
      btn.addEventListener('click', () => onOpen(item));
      list.appendChild(btn);
    }
  }

  function clearMediaViewers() {
    const photoViewer = document.getElementById('photo-viewer');
    const videoViewer = document.getElementById('video-viewer');
    const img = document.getElementById('photo-viewer-img');
    const video = document.getElementById('video-viewer-el');
    photoViewer?.classList.remove('is-open');
    videoViewer?.classList.remove('is-open');
    photoViewer?.classList.add('hidden');
    videoViewer?.classList.add('hidden');
    if (img) {
      img.removeAttribute('src');
      img.alt = '';
    }
    if (video) {
      try {
        video.pause();
      } catch {
        // ignore
      }
      video.removeAttribute('src');
      video.load();
    }
    photoItems = [];
    photoIndex = 0;
  }

  async function showPhotoAt(index) {
    if (!photoItems.length) return;
    photoIndex = (index + photoItems.length) % photoItems.length;
    const item = photoItems[photoIndex];
    // Downloads/Files images live outside Photos — use the item's category.
    const category = item.category || 'photos';
    const media = await window.vaultbrowse.getPrivateMediaUrl(
      PRIVATE_SPACE_ID,
      category,
      item.relativePath
    );
    if (!media?.ok) {
      setStatus(category, media?.error || 'This item cannot be accessed.', true);
      return;
    }
    const img = document.getElementById('photo-viewer-img');
    const name = document.getElementById('photo-viewer-name');
    const viewer = document.getElementById('photo-viewer');
    if (name) name.textContent = item.name;
    if (img) {
      img.alt = item.name;
      img.src = media.url;
    }
    viewer?.classList.remove('hidden');
    requestAnimationFrame(() => viewer?.classList.add('is-open'));
  }

  async function openPhotoViewer(items, startItem) {
    photoItems = (items || []).filter((i) => i.viewable || i.type === 'image');
    const idx = Math.max(
      0,
      photoItems.findIndex((i) => i.relativePath === startItem.relativePath)
    );
    await showPhotoAt(idx);
  }

  async function openVideoViewer(item) {
    const media = await window.vaultbrowse.getPrivateMediaUrl(
      PRIVATE_SPACE_ID,
      item.category || 'videos',
      item.relativePath
    );
    if (!media?.ok) {
      setStatus(item.category || 'videos', media?.error || 'This item cannot be accessed.', true);
      return;
    }
    const video = document.getElementById('video-viewer-el');
    const name = document.getElementById('video-viewer-name');
    const viewer = document.getElementById('video-viewer');
    if (name) name.textContent = item.name;
    if (video) {
      video.src = media.url;
      video.play().catch(() => {});
    }
    viewer?.classList.remove('hidden');
    requestAnimationFrame(() => viewer?.classList.add('is-open'));
  }

  function renderFileList(category, items, handlers = {}) {
    const listId = `${category}-list`;
    const emptyId = `${category}-empty`;
    const list = document.getElementById(listId);
    const empty = document.getElementById(emptyId);
    if (!list) return;
    list.innerHTML = '';
    const rows = Array.isArray(items) ? items : [];
    empty?.classList.toggle('hidden', rows.length > 0);
    list.classList.toggle('hidden', rows.length === 0);

    if (category === 'photos') {
      for (const item of rows.filter((row) => !row.isDirectory)) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'photo-tile';
        tile.innerHTML = `
          <div class="file-name">${escapeHtml(item.name)}</div>
          <div class="file-meta">${escapeHtml(formatBytes(item.size))}</div>
        `;
        tile.addEventListener('click', () => handlers.onOpen?.(item, rows));
        list.appendChild(tile);
      }
      return;
    }

    for (const item of rows) {
      const row = document.createElement('div');
      row.className = 'file-row';
      const openable =
        (category === 'videos' && (item.playable || item.type === 'video')) ||
        (category === 'downloads' && (item.viewable || item.playable)) ||
        (category === 'files' && (item.viewable || item.playable));
      row.innerHTML = `
        <div class="file-ico">${escapeHtml(markForType(item))}</div>
        <div>
          <div class="file-name">${escapeHtml(item.name)}</div>
          <div class="file-meta">${escapeHtml(typeLabel(item))} · ${escapeHtml(formatBytes(item.size))}</div>
        </div>
        <div class="file-actions">
          ${openable ? '<button type="button" class="text-btn" data-act="open">Open</button>' : ''}
          <button type="button" class="text-btn" data-act="rename">Rename</button>
          <button type="button" class="text-btn" data-act="delete">Delete</button>
        </div>
      `;
      row.querySelector('[data-act="open"]')?.addEventListener('click', () => handlers.onOpen?.(item, rows));
      row.querySelector('[data-act="rename"]')?.addEventListener('click', () => handlers.onRename?.(item));
      row.querySelector('[data-act="delete"]')?.addEventListener('click', () => handlers.onDelete?.(item));
      list.appendChild(row);
    }
  }

  async function loadCategory(category) {
    setStatus(category, '');
    const result = await window.vaultbrowse.listPrivateFiles(PRIVATE_SPACE_ID, category, '');
    if (!result?.ok) {
      renderFileList(category, []);
      setStatus(category, result?.error || 'Could not load files.', true);
      return { ok: false, items: [] };
    }
    return { ok: true, items: result.items || [] };
  }

  function bindDropZones(onDrop) {
    document.querySelectorAll('.drop-zone[data-drop-category]').forEach((zone) => {
      if (zone.dataset.bound === '1') return;
      zone.dataset.bound = '1';
      const category = zone.getAttribute('data-drop-category');
      zone.addEventListener('dragover', (event) => {
        event.preventDefault();
        zone.classList.add('is-active');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('is-active'));
      zone.addEventListener('drop', (event) => {
        event.preventDefault();
        zone.classList.remove('is-active');
        const paths = window.vaultbrowse.pathsForDroppedFiles(event.dataTransfer?.files);
        onDrop(category, paths);
      });
    });
  }

  function bindViewerControls() {
    document.getElementById('photo-close')?.addEventListener('click', clearMediaViewers);
    document.getElementById('video-close')?.addEventListener('click', () => {
      clearMediaViewers();
    });
    document.getElementById('photo-prev')?.addEventListener('click', () => showPhotoAt(photoIndex - 1));
    document.getElementById('photo-next')?.addEventListener('click', () => showPhotoAt(photoIndex + 1));
    window.addEventListener('keydown', (event) => {
      const photoOpen = !document.getElementById('photo-viewer')?.classList.contains('hidden');
      const videoOpen = !document.getElementById('video-viewer')?.classList.contains('hidden');
      if (!photoOpen && !videoOpen) return;
      if (event.key === 'Escape') {
        clearMediaViewers();
      }
      if (photoOpen && event.key === 'ArrowLeft') {
        void showPhotoAt(photoIndex - 1);
      }
      if (photoOpen && event.key === 'ArrowRight') {
        void showPhotoAt(photoIndex + 1);
      }
    });
  }

  bindViewerControls();

  return {
    PRIVATE_SPACE_ID,
    greetingForNow,
    renderServices,
    renderRecentFiles,
    renderFileList,
    loadCategory,
    setStatus,
    bindDropZones,
    clearMediaViewers,
    openPhotoViewer,
    openVideoViewer,
    formatBytes,
  };
})();
