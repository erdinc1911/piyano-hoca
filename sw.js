self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())await caches.delete(k);await self.registration.unregister();const c=await self.clients.matchAll();c.forEach(x=>x.navigate(x.url));})()));
