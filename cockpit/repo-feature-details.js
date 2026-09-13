/* Feature 4: repository details dialog. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    function safe(promise, fallback) { return promise.catch(function () { return fallback || ""; }); }
    function displayRemote(value) {
        value = (value || "").trim();
        if (!/^https?:\/\//i.test(value)) return value;
        try {
            var url = new URL(value);
            url.username = "";
            url.password = "";
            url.search = "";
            url.hash = "";
            return url.toString();
        } catch (e) {
            return value.replace(/^(https?:\/\/)[^/@]+@/i, "$1").replace(/[?#].*$/, "");
        }
    }
    function show(title, fields) {
        var old = document.getElementById("ghs-repo-modal"); if (old) old.remove();
        var cover = document.createElement("div"), box = document.createElement("div"), close = document.createElement("button");
        cover.id = "ghs-repo-modal";
        cover.style.cssText = "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:1rem";
        box.style.cssText = "background:var(--ghs-surface);color:var(--ghs-text);border:1px solid var(--ghs-border);max-width:48rem;width:100%;max-height:85vh;overflow:auto;border-radius:var(--ghs-radius);padding:1.25rem;box-shadow:var(--ghs-shadow-menu,0 10px 30px rgba(0,0,0,.3))";
        var h = document.createElement("h2"); h.textContent = title; h.style.marginTop = "0"; box.appendChild(h);
        var dl = document.createElement("dl"); dl.className = "ghs-dl";
        fields.forEach(function (f) {
            var g = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
            g.className = "ghs-dl__group"; dt.className = "ghs-dl__term"; dd.className = "ghs-dl__desc";
            dt.textContent = f[0]; dd.textContent = f[1] || "—"; if (f[2]) dd.classList.add("ghs-mono"); g.appendChild(dt); g.appendChild(dd); dl.appendChild(g);
        });
        box.appendChild(dl); close.className = "ghs-btn ghs-btn--primary"; close.textContent = "Close"; close.onclick = function () { cover.remove(); }; box.appendChild(close);
        cover.onclick = function (e) { if (e.target === cover) cover.remove(); }; cover.appendChild(box); document.body.appendChild(cover);
    }

    function details(name) {
        return m.repoDirectory(name).then(function (dir) {
            return Promise.all([
                safe(m.runGit(name, ["remote", "get-url", "origin"]), ""),
                safe(m.runGit(name, ["symbolic-ref", "--quiet", "--short", "HEAD"]), "detached"),
                safe(m.runGit(name, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]), "none"),
                safe(m.runGit(name, ["log", "-1", "--format=%h\t%s\t%an\t%ct"]), ""),
                safe(cockpit.spawn(["du", "-sh", dir], { err: "ignore" }), ""),
                safe(cockpit.spawn(["sh", "-c", 'p="$1"; [ -e "$p/.git/FETCH_HEAD" ] && stat -c %Y "$p/.git/FETCH_HEAD" || [ -e "$p/FETCH_HEAD" ] && stat -c %Y "$p/FETCH_HEAD" || true', "sh", dir], { err: "ignore" }), "")
            ]).then(function (v) {
                var log = (v[3] || "").trim().split("\t"), fetched = parseInt((v[5] || "").trim(), 10);
                show(name, [
                    ["Local path", dir, true], ["Origin", displayRemote(v[0]), true], ["Branch", (v[1] || "").trim()],
                    ["Upstream", (v[2] || "").trim()], ["Latest commit", log.length > 1 ? log[0] + "  " + log[1] : ""],
                    ["Commit author", log[2] || ""], ["Commit time", log[3] ? new Date(parseInt(log[3], 10) * 1000).toLocaleString() : ""],
                    ["Last fetch", fetched ? new Date(fetched * 1000).toLocaleString() : "Never recorded"], ["On disk", (v[4] || "").trim().split(/\s+/)[0]]
                ]);
            });
        }).catch(function (e) { window.alert("Could not read repository details: " + (e.message || String(e))); });
    }
    m.registerAction({ label: "Details…", run: details });
})();
