'use strict';

/**
 * Domain whitelist helpers — delegates to protected spaces.
 */

const spaceManager = require('../spaces/spaceManager');
const { normalizeHostname, hostnameMatches } = require('./hostnameUtils');

function getAllowedDomains() {
  return spaceManager.getDomainsForSpace(spaceManager.getActiveSpace()?.id).map((d) => d.domain);
}

function isHostnameAllowed(hostname, spaceId) {
  return spaceManager.isHostnameAllowedInSpace(
    hostname,
    spaceId || spaceManager.getActiveSpace()?.id
  );
}

function isUrlAllowed(urlString, spaceId) {
  return spaceManager.isUrlAllowedInSpace(
    urlString,
    spaceId || spaceManager.getActiveSpace()?.id
  );
}

function addDomain(domainInput, allowSubdomains = false, spaceId) {
  const target = spaceId || spaceManager.getActiveSpace()?.id;
  return spaceManager.addDomainToSpace(target, domainInput, allowSubdomains);
}

function removeDomain(domain, spaceId) {
  const target = spaceId || spaceManager.getActiveSpace()?.id;
  return spaceManager.removeDomainFromSpace(target, domain);
}

function listDomainEntries(spaceId) {
  return spaceManager.getDomainsForSpace(spaceId || spaceManager.getActiveSpace()?.id);
}

module.exports = {
  normalizeHostname,
  hostnameMatches,
  getAllowedDomains,
  isHostnameAllowed,
  isUrlAllowed,
  addDomain,
  removeDomain,
  listDomainEntries,
};
