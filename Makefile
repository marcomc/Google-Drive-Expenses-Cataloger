SHELL := /bin/bash
INSTALLER := ./scripts/install.sh
MARKDOWNLINT ?= markdownlint
MARKDOWNLINT_CONFIG ?= .markdownlint.json
SHELLCHECK ?= shellcheck

.DEFAULT_GOAL := help
.NOTPARALLEL: install install-resume install-debug install-resume-debug install-reset
.PHONY: help install install-resume install-check install-debug install-resume-debug install-reset
.PHONY: test lint lint-shell lint-md check

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "; printf "Usage: make <target>\n\nTargets:\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-22s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Start the interactive installer
	@$(INSTALLER)

install-resume: ## Resume after the browser handoff
	@$(INSTALLER) --resume

install-check: ## Check local prerequisites
	@$(INSTALLER) --check

install-debug: ## Start the installer with non-secret diagnostics
	@$(INSTALLER) --debug

install-resume-debug: ## Resume with non-secret diagnostics
	@$(INSTALLER) --resume --debug

install-reset: ## Remove private installer state only
	@$(INSTALLER) --reset

test: ## Run the verified core import seams
	@node tests/expense_core_test.js
	@node tests/installer_test.js
	@node tests/rebuild_state_test.js
	@bash tests/install_test.sh
	@bash tests/install_time_zone_push_test.sh
	@node scripts/validate-apps-script.js
	@bash tests/deploy_apps_script_test.sh

lint-shell: ## Lint shell scripts
	@$(SHELLCHECK) --enable=all --external-sources --source-path=scripts --source-path=. scripts/*.sh scripts/lib/*.sh tests/*.sh

lint-md: ## Lint Markdown files
	@$(MARKDOWNLINT) --config $(MARKDOWNLINT_CONFIG) README.md AGENTS.example.md TODO.md CHANGELOG.md docs/*.md

lint: lint-shell lint-md ## Run all linters

check: test lint ## Run tests and linters
