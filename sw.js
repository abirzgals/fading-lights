const CACHE_NAME = 'fading-light-v2';
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/config.js',
    './js/audio.js',
    './js/network.js',
    './js/mobile.js',
    './js/textures.js',
    './js/menu.js',
    './js/game.js',
    './js/main.js',
    './manifest.json',
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // Skip WebSocket/API requests
    if (e.request.url.includes('onrender.com') || e.request.url.startsWith('ws')) return;

    // Network-first: always try to get fresh version, fall back to cache if offline
    e.respondWith(
        fetch(e.request).then((response) => {
            if (response && response.status === 200) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
            }
            return response;
        }).catch(() => caches.match(e.request))
    );
});
