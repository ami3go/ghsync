/* Release marker for the 2026 build sequence. */
(function () {
    "use strict";
    var version = "26.4";
    document.title = "GitHub Sync " + version;

    /* Cockpit already provides the surrounding page context, so avoid spending
     * vertical space on a second page header inside the plugin. */
    var pageHeader = document.querySelector(".ghs-page-section--light");
    if (pageHeader) pageHeader.remove();

    /* Keep the version visible in the compact Overview card header. */
    var overviewTitle = document.querySelector(".ghs-card__title");
    if (overviewTitle) overviewTitle.textContent = "Github Sync " + version;

    window.GHSyncVersion = version;
})();
