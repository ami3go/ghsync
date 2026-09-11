/* Feature 15: recent repository commit history. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    if (!m) return;

    function show(name, text) {
        var old = document.getElementById("ghs-history-modal"); if (old) old.remove();
        var cover = document.createElement("div"), box = document.createElement("div"), title = document.createElement("h2"), pre = document.createElement("pre"), close = document.createElement("button");
        cover.id = "ghs-history-modal";
        cover.style.cssText = "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:1rem";
        box.style.cssText = "background:#fff;max-width:64rem;width:100%;max-height:85vh;overflow:auto;border-radius:4px;padding:1.25rem;box-shadow:0 10px 30px rgba(0,0,0,.3)";
        title.textContent = "Recent commits — " + name; title.style.marginTop = "0";
        pre.className = "ghs-log"; pre.style.maxHeight = "28rem"; pre.textContent = text || "No commits.";
        close.className = "ghs-btn ghs-btn--primary"; close.type = "button"; close.textContent = "Close"; close.onclick = function () { cover.remove(); };
        cover.onclick = function (e) { if (e.target === cover) cover.remove(); };
        box.appendChild(title); box.appendChild(pre); box.appendChild(close); cover.appendChild(box); document.body.appendChild(cover);
    }
    function history(name) {
        m.runGit(name, ["log", "-10", "--date=short", "--pretty=format:%h%x09%ad%x09%an%x09%s"])
            .then(function (out) {
                var formatted = out.split("\n").filter(Boolean).map(function (line) {
                    var f = line.split("\t"); return (f[0] || "") + "  " + (f[1] || "") + "  " + (f[2] || "") + "  " + (f.slice(3).join(" ") || "");
                }).join("\n");
                show(name, formatted);
            }).catch(function (e) { window.alert("Could not read history for " + name + ": " + (e.message || String(e))); });
    }
    m.registerAction({ label: "Recent history…", run: history });
})();
