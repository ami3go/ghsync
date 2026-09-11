/* Feature 10: persistent favourites pinned to the top. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m || !m.loadMeta) return;
    var applying = false;

    if (!document.getElementById("ghs-favorite-style")) {
        var style = document.createElement("style");
        style.id = "ghs-favorite-style";
        style.textContent = ".ghs-repo-name--favorite::before{content:'★ ';}";
        document.head.appendChild(style);
    }

    function nameOf(row) {
        if (m.rowName) return m.rowName(row);
        var cell = row.querySelector(".ghs-repo-name");
        return cell ? cell.textContent.trim() : "";
    }
    function apply() {
        if (applying) return;
        applying = true;
        m.loadMeta().then(function (meta) {
            var body = document.getElementById("repos"); if (!body) return;
            var rows = Array.prototype.slice.call(body.querySelectorAll("tr"));
            rows.forEach(function (row) {
                var cell = row.querySelector(".ghs-repo-name"); if (!cell) return;
                var name = nameOf(row), favorite = !!(meta.favorites && meta.favorites[name]);
                cell.classList.toggle("ghs-repo-name--favorite", favorite);
                cell.title = favorite ? "Favourite" : "";
                row.dataset.favorite = favorite ? "1" : "0";
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
