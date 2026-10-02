'use strict';
const CACHE='rental-equipment-static-v1';
const FILES=['./','./index.html','./assets/app.css','./assets/app.js','./assets/domain.js','./assets/repository.js','./manifest.webmanifest','./assets/icons/app.svg','./assets/icons/apple-touch-icon.png','./assets/icons/app-192.png','./assets/icons/app-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('rental-equipment-static-')&&k!==CACHE).map(k=>caches.delete(k))))));
// Network-first prevents an old app shell from hiding published updates.
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request).then(cached=>cached||Response.error())));});
