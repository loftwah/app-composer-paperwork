// Keep existing shared-menu and bookmarked pages working at the public address.
// Other instances retain their own host; no document or signature is transferred.
if (location.hostname === "composer-paperwork.loftwah.workers.dev") {
  const destination = new URL(location.href);
  destination.protocol = "https:";
  destination.host = "paperwork.loftwah.com";
  location.replace(destination.href);
}
