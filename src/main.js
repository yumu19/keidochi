import { readSharedLink, viewPageUrl } from './shared-records.js';

// Redirect legacy links before loading any editor code or accessing local storage.
function redirectSharedLink() {
  if (!readSharedLink(window.location.href)) {
    document.documentElement.classList.remove('redirecting-to-viewer');
    return false;
  }
  document.documentElement.classList.add('redirecting-to-viewer');
  window.location.replace(viewPageUrl(window.location.href));
  return true;
}

if (!redirectSharedLink()) {
  window.addEventListener('hashchange', redirectSharedLink);
  window.addEventListener('pageshow', redirectSharedLink);
  await import('./app.js');
}
