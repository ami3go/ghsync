/* Release marker for the 2026 build sequence. */
(function () {
    "use strict";
    var version = "26.3";
    document.title = "GitHub Sync " + version;
    var title = document.querySelector(".ghs-title");
    if (title) title.textContent = "GitHub Sync " + version;
    window.GHSyncVersion = version;
})();
