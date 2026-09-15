/* First-time setup and diagnostics for the shared repository-list Sync tab. */
(function () {
    "use strict";
    var m = window.GHSyncRepoManager;
    var shared = window.GHSyncSharedList;
    if (!m || !shared) return;

    function $(id) { return document.getElementById(id); }
    function resize() { try { cockpit.transport.control("size-change"); } catch (e) { /* standalone */ } }
    function status(text, bad) {
        var el = $("sync-status");
        if (el) {
            el.textContent = text || "";
            el.className = "ghs-helper" + (bad ? " ghs-t-red" : "");
        }
        resize();
    }
    function message(error) { return error && error.message ? error.message : String(error || "Unknown error"); }
    function isMissing(error) { return /404|Not Found|Could not resolve to a Repository/i.test(message(error)); }
    function groups(value) {
        var seen = Object.create(null), result = [];
        String(value || "").split(/[\s,]+/).forEach(function (item) {
            item = item.trim();
            if (!item || seen[item]) return;
            seen[item] = true;
            result.push(item);
        });
        return result;
    }
    function encode64(text) {
        if (typeof TextEncoder !== "undefined") {
            var bytes = new TextEncoder().encode(text), binary = "";
            bytes.forEach(function (b) { binary += String.fromCharCode(b); });
            return btoa(binary);
        }
        return btoa(unescape(encodeURIComponent(text)));
    }
    function encodedPath(path) {
        return String(path || "").split("/").map(function (part) { return encodeURIComponent(part); }).join("/");
    }
    function cleanOrigin(value) {
        value = String(value || "").trim();
        if (!value) return "";
        if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
            try {
                var url = new URL(value);
                if (/^https?:$/i.test(url.protocol)) url.username = "";
                url.password = "";
                url.search = "";
                url.hash = "";
                value = url.toString();
            } catch (e) {
                value = value.replace(/^(https?:\/\/)[^/@]+@/i, "$1").replace(/[?#].*$/, "");
            }
        }
        return value;
    }
    function validEntry(name, url) {
        return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name) && !!url && url.charAt(0) !== "-" && !/[\r\n\t]/.test(url);
    }
    function formValues() {
        var source = $("sync-source-repo"), branch = $("sync-source-branch"), path = $("sync-source-path"), machine = $("sync-machine");
        if (!source || !branch || !path || !machine) throw new Error("Sync form is not available");
        var out = {
            sourceRepo: source.value.trim(),
            branch: branch.value.trim() || "main",
            path: path.value.trim() || "ghsync-repositories.json",
            machine: machine.value.trim(),
            groups: groups($("sync-groups") ? $("sync-groups").value : "")
        };
        if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(out.sourceRepo)) throw new Error("Configuration repository must be owner/repository");
        if (!out.machine || /[\r\n\t]/.test(out.machine)) throw new Error("Machine ID is required");
        if (!out.path || out.path.charAt(0) === "/" || /(^|\/)\.\.(\/|$)/.test(out.path) || !/^[A-Za-z0-9._/-]+$/.test(out.path))
            throw new Error("Manifest path must be a safe repository-relative path");
        return out;
    }

    var hostPromise = null;
    function configuredHost() {
        if (hostPromise) return hostPromise;
        hostPromise = m.runCore(["check"]).then(function (out) {
            var host = "";
            out.split("\n").some(function (line) {
                var f = line.split("\t");
                if (f[0] === "check" && f[1] === "host") { host = (f[2] || "").trim(); return true; }
                return false;
            });
            return host;
        }).catch(function () { return ""; });
        return hostPromise;
    }
    function ghApi(args) {
        return configuredHost().then(function (host) {
            var command = ["gh", "api"];
            if (host) command.push("--hostname", host);
            return cockpit.spawn(command.concat(args), { err: "message", superuser: null });
        });
    }
    function ghRepo(args) {
        return configuredHost().then(function (host) {
            var options = { err: "message", superuser: null };
            if (host) options.environ = ["GH_HOST=" + host];
            return cockpit.spawn(["gh", "repo"].concat(args), options);
        });
    }

    var repoState = { checked: false, exists: false, branchExists: false, manifestExists: false, defaultBranch: "", isPrivate: false };
    var checking = false;
    var timer = null;

    function applyState(next) {
        repoState = next || repoState;
        var create = $("btn-sync-create-repo"), initialize = $("btn-sync-init-manifest"), test = $("btn-sync-test-repo");
        if (create) {
            create.disabled = checking || !repoState.checked || repoState.exists;
            create.title = repoState.exists ? "The configured repository already exists" : "Create the configured repository as private";
        }
        if (initialize) {
            initialize.disabled = checking || !repoState.exists || repoState.manifestExists;
            initialize.title = !repoState.exists ? "Create or choose a repository first" :
                (repoState.manifestExists ? "The shared manifest already exists" : "Create the first shared manifest from repositories on this PC");
        }
        if (test) test.disabled = checking;
        var stateEl = $("sync-repository-state");
        if (stateEl) {
            if (!repoState.checked) stateEl.textContent = "Repository has not been checked yet.";
            else if (!repoState.exists) stateEl.textContent = "Repository not found with the current GitHub CLI login.";
            else if (!repoState.branchExists) stateEl.textContent = "Repository exists but is empty. Initialize the manifest to create the first commit.";
            else if (!repoState.manifestExists) stateEl.textContent = "Repository is reachable, but the configured manifest does not exist yet.";
            else stateEl.textContent = "Repository and shared manifest are accessible.";
        }
        resize();
    }

    function inspectRepository(showStatus) {
        var current;
        try { current = formValues(); }
        catch (e) {
            repoState = { checked: false, exists: false, branchExists: false, manifestExists: false, defaultBranch: "", isPrivate: false };
            applyState(repoState);
            if (showStatus) status(message(e), true);
            return Promise.reject(e);
        }
        checking = true;
        applyState(repoState);
        return ghApi(["repos/" + current.sourceRepo]).then(function (out) {
            var meta = JSON.parse(out || "{}");
            var defaultBranch = String(meta.default_branch || current.branch || "main");
            var next = {
                checked: true,
                exists: true,
                branchExists: false,
                manifestExists: false,
                defaultBranch: defaultBranch,
                isPrivate: meta.private === true
            };
            return ghApi(["repos/" + current.sourceRepo + "/branches/" + encodeURIComponent(current.branch)]).then(function () {
                next.branchExists = true;
                var endpoint = "repos/" + current.sourceRepo + "/contents/" + encodedPath(current.path) + "?ref=" + encodeURIComponent(current.branch);
                return ghApi([endpoint]).then(function () { next.manifestExists = true; }, function (e) {
                    if (!isMissing(e)) throw e;
                });
            }, function (e) {
                if (!isMissing(e)) throw e;
            }).then(function () { return next; });
        }, function (e) {
            if (isMissing(e)) return { checked: true, exists: false, branchExists: false, manifestExists: false, defaultBranch: "", isPrivate: false };
            throw e;
        }).then(function (next) {
            repoState = next;
            if (repoState.exists && !repoState.branchExists && repoState.defaultBranch && $("sync-source-branch"))
                $("sync-source-branch").value = repoState.defaultBranch;
            applyState(repoState);
            if (showStatus) {
                if (!repoState.exists) status("Repository is not accessible or does not exist. Create it here or check the gh login and repository name.", true);
                else if (!repoState.branchExists) status("Repository connection OK. It is empty; initialize the shared manifest to create the first commit.");
                else if (!repoState.manifestExists) status("Repository connection OK. The branch exists, but the shared manifest has not been initialized yet.");
                else status("Repository connection OK. Shared manifest is accessible.");
            }
            return repoState;
        }).catch(function (e) {
            if (showStatus) status("Repository check failed: " + message(e), true);
            throw e;
        }).finally(function () {
            checking = false;
            applyState(repoState);
        });
    }

    function scheduleInspect() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () { inspectRepository(false).catch(function () {}); }, 450);
    }

    function createRepository() {
        var current;
        try { current = formValues(); } catch (e) { status(message(e), true); return Promise.reject(e); }
        if (repoState.exists) {
            status("Repository already exists; creation is disabled.");
            return Promise.resolve(repoState);
        }
        checking = true;
        applyState(repoState);
        status("Creating private repository " + current.sourceRepo + "…");
        return ghRepo(["create", current.sourceRepo, "--private", "--add-readme", "--description", "Shared ghsync repository list"]).then(function () {
            status("Private repository created. Checking its default branch…");
            return inspectRepository(false);
        }).then(function (next) {
            if (next.defaultBranch && $("sync-source-branch")) $("sync-source-branch").value = next.defaultBranch;
            status("Private repository created. Initialize the manifest or use Push list to publish this PC's repository list.");
            return next;
        }).catch(function (e) {
            status("Could not create repository: " + message(e), true);
            throw e;
        }).finally(function () {
            checking = false;
            applyState(repoState);
        });
    }

    function collectLocal() {
        return m.statusSnapshot().then(function (rows) {
            return m.mapLimit(rows, 6, function (row) {
                return m.runGit(row.name, ["remote", "get-url", "origin"]).then(function (origin) {
                    origin = cleanOrigin(origin);
                    return validEntry(row.name, origin) ? { name: row.name, url: origin } : null;
                }, function () { return null; });
            });
        }).then(function (entries) {
            return entries.filter(Boolean).sort(function (a, b) { return a.name.localeCompare(b.name); });
        });
    }

    function initializeManifest() {
        var current;
        try { current = formValues(); } catch (e) { status(message(e), true); return Promise.reject(e); }
        status("Preparing the initial shared manifest…");
        return inspectRepository(false).then(function (state) {
            if (!state.exists) throw new Error("The configuration repository does not exist or is not accessible");
            if (state.manifestExists) throw new Error("The shared manifest already exists");
            return collectLocal().then(function (entries) {
                var manifest = shared.mergeLocal(shared.normalizeManifest({ version: 1, repositories: [], groups: {}, machines: {} }), entries, current);
                var endpoint = "repos/" + current.sourceRepo + "/contents/" + encodedPath(current.path);
                var args = ["--method", "PUT", endpoint,
                    "-f", "message=Initialize ghsync shared repository list from " + current.machine,
                    "-f", "content=" + encode64(JSON.stringify(manifest, null, 2) + "\n")];
                /* GitHub explicitly supports PUT contents without a branch to make
                   the first commit in an empty repository. */
                if (state.branchExists) args.push("-f", "branch=" + current.branch);
                return ghApi(args).then(function (out) {
                    var result = JSON.parse(out || "{}");
                    return { count: entries.length, result: result, manifest: manifest };
                });
            });
        }).then(function (created) {
            return inspectRepository(false).then(function (next) {
                if (next.defaultBranch && $("sync-source-branch")) $("sync-source-branch").value = next.defaultBranch;
                status("Shared manifest initialized with " + created.count + " local repositories. Push list and Sync now are ready to use.");
                return created;
            });
        }).catch(function (e) {
            status("Could not initialize shared manifest: " + message(e), true);
            throw e;
        });
    }

    function guardExistingButton(id, mode) {
        var button = $(id);
        if (!button || button.dataset.syncBootstrapGuard === "yes") return;
        button.dataset.syncBootstrapGuard = "yes";
        var original = button.onclick;
        button.onclick = function (event) {
            return inspectRepository(false).then(function (state) {
                if (!state.exists) {
                    status("The configuration repository does not exist or is not accessible. Use Create private repository or Test connection first.", true);
                    return;
                }
                if (mode === "push" && !state.branchExists) return initializeManifest();
                if ((mode === "pull" || mode === "sync") && !state.manifestExists) {
                    status("The shared manifest does not exist yet. Use Initialize manifest or Push list first.", true);
                    return;
                }
                if (original) return original.call(button, event);
            }).catch(function (e) {
                status("Repository check failed: " + message(e), true);
            });
        };
    }

    function addControls() {
        var panel = $("panel-sync"), form = panel && panel.querySelector(".ghs-form");
        if (!form || $("sync-repository-setup")) return;
        var anchor = $("btn-sync-config-save");
        var group = document.createElement("div");
        group.id = "sync-repository-setup";
        group.className = "ghs-form-group";
        group.innerHTML =
            '<span class="ghs-label">Configuration repository setup</span>' +
            '<div class="ghs-form-actions">' +
            '<button id="btn-sync-test-repo" class="ghs-btn ghs-btn--secondary" type="button">Test connection</button>' +
            '<button id="btn-sync-create-repo" class="ghs-btn ghs-btn--secondary" type="button" disabled>Create private repository</button>' +
            '<button id="btn-sync-init-manifest" class="ghs-btn ghs-btn--secondary" type="button" disabled>Initialize manifest</button>' +
            '</div>' +
            '<p id="sync-repository-state" class="ghs-helper">Repository has not been checked yet.</p>' +
            '<p class="ghs-helper">Create repository is only enabled when the configured owner/repository cannot be found. Initialize manifest creates the first shared list; for an empty repository it also creates the first commit.</p>';
        var saveGroup = anchor && anchor.parentNode;
        if (saveGroup && saveGroup.parentNode === form) form.insertBefore(group, saveGroup.nextSibling);
        else form.insertBefore(group, form.firstChild);

        $("btn-sync-test-repo").onclick = function () { inspectRepository(true).catch(function () {}); };
        $("btn-sync-create-repo").onclick = function () { createRepository().catch(function () {}); };
        $("btn-sync-init-manifest").onclick = function () { initializeManifest().catch(function () {}); };
        ["sync-source-repo", "sync-source-branch", "sync-source-path"].forEach(function (id) {
            if ($(id)) {
                $(id).addEventListener("input", scheduleInspect);
                $(id).addEventListener("change", scheduleInspect);
            }
        });
        applyState(repoState);
        scheduleInspect();
    }

    addControls();
    guardExistingButton("btn-shared-pull", "pull");
    guardExistingButton("btn-shared-push", "push");
    guardExistingButton("btn-shared-reconcile", "sync");

    window.GHSyncSyncBootstrap = {
        inspectRepository: inspectRepository,
        initializeManifest: initializeManifest,
        createRepository: createRepository,
        applyState: applyState,
        state: function () { return repoState; }
    };
})();
