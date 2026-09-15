/* Keep repository-list import/export controls together with shared synchronization. */
(function () {
    "use strict";
    var panel = document.getElementById("panel-sync");
    var group = document.getElementById("repo-list-settings");
    var form = panel && panel.querySelector(".ghs-form");
    if (!panel || !group || !form) return;

    var label = group.querySelector(".ghs-label");
    var helper = group.querySelector(".ghs-helper");
    if (label) label.textContent = "Local import / export";
    if (helper) helper.textContent = "TSV import/export remains compatible with previous releases. Import clones missing repositories but never deletes local repositories.";

    form.appendChild(group);
    try { cockpit.transport.control("size-change"); } catch (e) { /* standalone */ }
})();
