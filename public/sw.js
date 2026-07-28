// public/sw.js — Web Push service worker.
//
// Registered by lib/push-client.ts's subscribeToPush(). Handles incoming
// push events and notification taps. This is the browser-side half of the
// notification backbone referenced in lib/push-server.ts — nothing calls
// sendPushToProfile() from any flow yet, this just makes the browser ready
// for when something does (booking confirmed, order shipped, etc.), and
// gives the eventual mobile app the same push-payload shape to reuse.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Umuhle", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Umuhle";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
