export function getServiceWorkerScript(): string {
  return `self.addEventListener("install", () => self.skipWaiting())

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("message", async (event) => {
  const data = event.data || {}
  if (data.type !== "SHOW_NOTIFICATION") return

  const title = data.title || "Agent View"
  const body = data.body || ""
  const url = data.url || "/"

  await self.registration.showNotification(title, {
    body,
    tag: data.tag || "agent-view",
    renotify: true,
    data: { url },
  })
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification?.data?.url || "/"

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true })
    for (const client of allClients) {
      if ("focus" in client) {
        await client.focus()
        if ("navigate" in client) {
          try { await client.navigate(url) } catch {}
        }
        return
      }
    }
    await clients.openWindow(url)
  })())
})`
}
