// Talesreach website helpers: offline/fast loading (service worker) and "Install" button.
(function () {
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  }

  var installBtn = document.getElementById("install");
  var iosHint = document.getElementById("ios-hint");
  var deferred = null;

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    if (installBtn) installBtn.hidden = false;
  });
  if (installBtn) {
    installBtn.addEventListener("click", function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.finally(function () {
        deferred = null;
        installBtn.hidden = true;
      });
    });
  }
  // iPhone/iPad have no install prompt: show how to add to the home screen instead.
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
  if (ios && iosHint) iosHint.hidden = false;
})();
