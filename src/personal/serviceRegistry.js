'use strict';

/**
 * UI metadata for Personal Space service cards.
 * Does NOT grant domain access — spaceManager / navigationGuard decide that.
 */

const SERVICE_REGISTRY = Object.freeze({
  whatsapp: {
    id: 'whatsapp',
    name: 'WhatsApp',
    domain: 'web.whatsapp.com',
    spaceId: 'whatsapp',
    action: 'openSpace',
    description: 'Personal messaging',
    accent: '#25d366',
    mark: 'Wa',
    typography: 'whatsapp',
  },
  gmail: {
    id: 'gmail',
    name: 'Gmail',
    domain: 'mail.google.com',
    spaceId: 'work',
    action: 'openDomain',
    description: 'Mail',
    accent: '#ea4335',
    mark: 'Gm',
    typography: 'gmail',
  },
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    domain: 'chatgpt.com',
    spaceId: 'chatgpt',
    action: 'openSpace',
    description: 'AI assistant',
    accent: '#10a37f',
    mark: 'GPT',
    typography: 'chatgpt',
  },
  github: {
    id: 'github',
    name: 'GitHub',
    domain: 'github.com',
    spaceId: 'work',
    action: 'openDomain',
    description: 'Code & projects',
    accent: '#f0f6fc',
    mark: 'GH',
    typography: 'github',
  },
  googleDrive: {
    id: 'googleDrive',
    name: 'Google Drive',
    domain: 'drive.google.com',
    spaceId: null,
    action: 'openDomain',
    description: 'Files in the cloud',
    accent: '#4285f4',
    mark: 'Dr',
    typography: 'drive',
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    domain: 'youtube.com',
    spaceId: null,
    action: 'openDomain',
    description: 'Videos',
    accent: '#ff0033',
    mark: 'Yt',
    typography: 'youtube',
  },
});

/**
 * Build service cards from spaces that actually allow the domain.
 * Registry entry alone never overrides allowlisting.
 */
function getAvailableServices(spaces) {
  const list = Array.isArray(spaces) ? spaces : [];
  const allowed = [];

  for (const service of Object.values(SERVICE_REGISTRY)) {
    const owners = list.filter((space) =>
      (space.domains || []).some((entry) => {
        const d = String(entry.domain || '').toLowerCase();
        const target = service.domain.toLowerCase();
        if (d === target) return true;
        if (entry.allowSubdomains && target.endsWith(`.${d}`)) return true;
        if (entry.allowSubdomains && d === target.replace(/^www\./, '')) return true;
        // Exact host match only — no substring tricks.
        return false;
      })
    );

    if (owners.length === 0) {
      continue;
    }

    const preferred =
      (service.spaceId && owners.find((s) => s.id === service.spaceId)) || owners[0];

    allowed.push({
      id: service.id,
      name: service.name,
      domain: service.domain,
      spaceId: preferred.id,
      action: service.action === 'openSpace' && preferred.id === service.spaceId
        ? 'openSpace'
        : 'openDomain',
      description: service.description,
      accent: service.accent,
      mark: service.mark,
      typography: service.typography,
    });
  }

  return allowed;
}

function getServiceById(id) {
  return SERVICE_REGISTRY[id] || null;
}

module.exports = {
  SERVICE_REGISTRY,
  getAvailableServices,
  getServiceById,
};
