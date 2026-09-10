# ghsync — see README.md
PREFIX      ?= /usr/local
DESTDIR     ?=
COCKPIT_DIR ?= /usr/share/cockpit/ghsync
COCKPIT_FILES = manifest.json index.html ghsync.css ghsync.js

.PHONY: help install install-system uninstall uninstall-system lint test

help:
	@echo "make install          install for the current user"
	@echo "make install-system   install for all users (PREFIX=$(PREFIX), needs root)"
	@echo "make uninstall        remove the per-user installation"
	@echo "make lint             shellcheck + JS + JSON validation"
	@echo "make test             run the Cockpit page DOM test (needs jsdom)"

install:
	@./install.sh

install-system:
	install -Dm755 bin/ghsync $(DESTDIR)$(PREFIX)/bin/ghsync
	install -Dm755 bin/ghsync $(DESTDIR)$(COCKPIT_DIR)/ghsync
	@for f in $(COCKPIT_FILES); do \
		install -Dm644 cockpit/$$f $(DESTDIR)$(COCKPIT_DIR)/$$f; \
	done
	@echo "Installed. Reload Cockpit to see GitHub Sync under Tools."

uninstall:
	@./install.sh --uninstall

uninstall-system:
	rm -f $(DESTDIR)$(PREFIX)/bin/ghsync
	rm -rf $(DESTDIR)$(COCKPIT_DIR)

lint:
	shellcheck bin/ghsync install.sh
	bash -n bin/ghsync install.sh
	node --check cockpit/ghsync.js
	python3 -m json.tool cockpit/manifest.json > /dev/null
	@echo "All checks passed."

test:
	@command -v npm >/dev/null || { echo "npm is required for the DOM test"; exit 1; }
	@test -d node_modules/jsdom || npm install --no-save jsdom
	node test/ui-test.js
