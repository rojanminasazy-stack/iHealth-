// GitHub Pages serves 404.html for app pages it doesn't have as files (like /app/request/123).
// Send those back to the right web app, which then opens the page the person asked for.
(function () {
  var p = location.pathname;
  var base = p.indexOf("/app/") === 0 ? "/app/" : p.indexOf("/provider/") === 0 ? "/provider/" : null;
  if (!base) return;
  try { sessionStorage.setItem("ihealthe.spa", p.slice(base.length - 1) + location.search); } catch (e) {}
  location.replace(base);
})();
