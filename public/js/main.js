(function () {
  var form = document.getElementById('connect-form');
  if (!form) return;

  var resolved = false;
  form.addEventListener('submit', function () {
    resolved = true;
  });

  window.addEventListener('pagehide', function () {
    if (!resolved && navigator.sendBeacon) {
      navigator.sendBeacon('/connect/abandon');
    }
  });
})();
