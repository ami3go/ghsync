/* Feature 10: persistent favourites pinned to the top. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.loadMeta) return;
    var applying = false;

    function apply() {
        if (applying) return;
        applying = true;
        m.loadMeta().then(function (meta) {
            var body = document.getElementById("repos"); if (!body) return;
            var rows = Array.prototype.slice.call(body.querySelectorAll("tr"));
            rows.forEach(function (row) {
                var cell = row.querySelector(".ghs-repo-name"); if (!cell) return;
                var name = cell.childNodes[0] ? cell.childNodes[0].textContent.trim() : cell.textContent.trim();
                var star = cell.querySelector(".ghs-favorite-star");
                if (meta.favorites && meta.favorites[name]) {
                    if (!star) { star = document.createElement("span"); star.className = "ghs-favorite-star"; star.textContent = "★ "; star.title = "Favourite"; cell.insertBefore(star, cell.firstChild); }
                } else if (star) star.remove();
                row.dataset.favorite = meta.favorites && meta.favorites[name] ? "1" : "0";
            });
            rows.sort(function (a, b) {
                var fav = (b.dataset.favorite || "0").localeCompare(a.dataset.favorite || "0");
                if (fav) return fav;
                return a.querySelector(".ghs-repo-name").textContent.localeCompare(b.querySelector(".ghs-repo-name").textContent);
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
