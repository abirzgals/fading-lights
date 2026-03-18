// Minimal service worker — NEVER cache JS/HTML (always fresh from network)
// Only cache large static assets (images, audio) for offline/speed

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
    // Nuke ALL old caches on activate
    e.waitUntil(
        caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const url = e.request.url;
    // Never intercept: websockets, API, JS, HTML, CSS
    if (url.includes('onrender.com') || url.startsWith('ws')) return;
    if (url.endsWith('.js') || url.endsWith('.html') || url.endsWith('.css')) return;
    // Let browser handle everything else normally (no caching)
});
