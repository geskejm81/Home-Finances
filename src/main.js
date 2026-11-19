// Entry point. Loads the UI, which boots itself.
import './ui/app.js';

// A home-screen app can stay open for days. When it comes back to the front,
// reload if a newer version has been published (index.html carries the version).
const mine = document.querySelector('meta[name="version"]')?.content;
async function checkVersion(){
  if (!mine || document.visibilityState !== 'visible') return;
  try {
    const html = await (await fetch(location.pathname, { cache: 'no-store' })).text();
    const live = html.match(/<meta name="version" content="([^"]+)"/)?.[1];
    // A new URL skips any cached copy of the page; try each version once so a stale cache can't loop.
    if (live && live !== mine && sessionStorage.getItem('household.reloaded') !== live){
      sessionStorage.setItem('household.reloaded', live);
      location.replace(`${location.pathname}?v=${live}${location.hash}`);
    }
  } catch {}
}
document.addEventListener('visibilitychange', checkVersion);
setTimeout(checkVersion, 3000);
