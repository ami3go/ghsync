/* Feature 10: persistent favourites pinned to the top. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.loadMeta) return;
    var applying = false;

    function nameOf(row) {
        if (m.rowName) return m.rowName(row);
        var cell = row.querySelector(".ghs-repo-name"); if (!cell) return "";
        var clone = cell.cloneNode(true); clone.querySelectorAll(".ghs-repo-meta,.ghs-favorite-star").forEach(function (el) { el.remove(); });
        return clone.textContent.trim();
    }
    function apply() {
        if (applying) return;
        applying = true;
        m.loadMeta().then(function (meta) {
            var body = document.getElementById("repos"); if (!body) return;
            var rows = Array.prototype.slice.call(body.querySelectorAll("tr"));
            rows.forEach(function (row) {
                var cell = row.querySelector(".ghs-repo-name"); if (!cell) return;
                var name = nameOf(row), star = cell.querySelector(".ghs-favorite-star");
                if (meta.favorites && meta.favorites[name]) {
                    if (!star) { star = document.createElement("span"); star.className = "ghs-favorite-star"; star.textContent = "★ "; star.title = "Favourite"; cell.insertBefore(star, cell.firstChild); }
                } else if (star) star.remove();
                row.dataset.favorite = meta.favorites && meta.favorites[name] ? "1" : "0";
            });
            rows.sort(function (a, b) {
                var fav = (b.dataset.favorite || "0").localeCompare(a.dataset.favorite || "0");
                return fav || nameOf(a).localeCompare(nameOf(b));
            }).forEach(function (row) { body.appendChild(row); });
        }).finally(function () { applying = false; });
    }

    function toggle(name) {
        m.loadMeta().then(function (meta) {
            meta.favorites = meta.favorites || {};
            if (meta.favorites[name]) delete meta.favorites[name]; else meta.favorites[name] = true;
            return m.saveMeta();
        }).then(apply).catch(function (e) { window.alert("Could not update favourite: " + (e.message || String(e))); });
    }
    m.registerAction({ label: "Toggle favourite", run: toggle });
    var body = document.getElementById("repos");
    if (body) new MutationObserver(function () { setTimeout(apply, 0); }).observe(body, { childList: true });
    apply();
})();
