// service-worker.js
// Cache shell cơ bản (HTML/CSS/JS tĩnh) để mở nhanh hơn lần sau và có thể cài như app.
// KHÔNG cache dữ liệu Supabase — mọi query luôn đi mạng thật để đảm bảo dữ liệu mới nhất.

const CACHE_NAME = 'ttequip-shell-v1';
const SHELL_FILES = [
  './index.html',
  './login.html',
  './css/main.css',
  './js/main.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Không cache request tới Supabase — luôn lấy dữ liệu mới
  if (url.hostname.endsWith('.supabase.co')) return;

  // Cache-first cho file tĩnh trong app, network-first cho phần còn lại
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => cached);
    })
  );
});
