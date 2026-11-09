# List the recipes
default:
    @just --list

# Install dependencies (also runs `wxt prepare`)
install:
    npm install

# Run the dev server with hot reload (browser: chrome, edge or firefox)
dev browser="chrome":
    npx wxt -b {{browser}}

# Build the extension into .output/<browser>-mv3
build browser="chrome":
    npx wxt build -b {{browser}}

# Build and zip the extension for distribution
zip browser="chrome":
    npx wxt zip -b {{browser}}

# Type-check without emitting
typecheck:
    npm run compile

# Run the tests once (extra args go to vitest)
test *args:
    npx vitest run {{args}}

# Run the tests in watch mode
test-watch *args:
    npx vitest {{args}}

# Lint the Firefox build with web-ext
lint-firefox: (build "firefox")
    npx web-ext lint --self-hosted --source-dir .output/firefox-mv3

# Check the Astryx usage in the source
doctor:
    npx astryx doctor --built .

# Run the same checks as CI
ci: typecheck test build lint-firefox

# Tag a release (e.g. `just release 1.2.3`) and push it, which triggers the release workflow
release version: ci
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "$(git status --porcelain)" ]]; then
        echo "The working tree isn't clean" >&2
        exit 1
    fi
    git tag "v{{version}}"
    git push origin "v{{version}}"

# Redraw the dev build's icons (public-dev) from public/favicon.svg in orange; macOS only (sips)
dev-icons:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p public-dev/icon
    sed 's/#7c3aed/#ea580c/g' public/favicon.svg > public-dev/favicon.svg
    for size in 16 32 48 96 128; do
        sips -s format png -z "$size" "$size" public-dev/favicon.svg --out "public-dev/icon/$size.png" > /dev/null
    done

# Remove build output
clean:
    rm -rf .output
