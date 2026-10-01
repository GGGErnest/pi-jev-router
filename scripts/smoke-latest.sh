#!/usr/bin/env bash
# Smoke-run the test suite against the latest published Pi, independent of the nub
# lockfile that CI pins. Mirrors the plan's final verification:
# "Smoke-check Pi 0.99.1 can load the modified extension through a local extension
# invocation without configuring Jev credentials or changing ~/.pi/agent/settings.json".
set -euo pipefail
cd "$(dirname "$0")/.."

pi_version="${1:-0.99.1}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Keep the exact runtime dependencies from the published manifest (so the peer-dependency
# test still passes), then install the requested Pi packages on top of them.
node - <<'NODE' > "$tmp/package.json"
const p = require("./package.json");
process.stdout.write(JSON.stringify({
	name: "pi-jev-router-smoke",
	private: true,
	type: "module",
	dependencies: p.dependencies,
}));
NODE

cp index.ts index.test.mjs "$tmp/"
(
	cd "$tmp"
	npm install --no-save --ignore-scripts --no-audit --no-fund --no-package-lock \
		"@earendil-works/pi-coding-agent@${pi_version}" \
		"@earendil-works/pi-ai@${pi_version}"
	node --test index.test.mjs
)
