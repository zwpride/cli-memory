#!/bin/bash

# CLI Memory 构建脚本
# 默认产出 fork 本地命名的 release 二进制，而不是复用上游 GitHub Releases 资产名。

set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SCRIPT_SOURCE" ]; do
    SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" && pwd)"
    SCRIPT_SOURCE="$(readlink "$SCRIPT_SOURCE")"
    [[ "$SCRIPT_SOURCE" != /* ]] && SCRIPT_SOURCE="$SCRIPT_DIR/$SCRIPT_SOURCE"
done
PROJECT_ROOT="$(cd -P "$(dirname "$SCRIPT_SOURCE")" && pwd)"

cd "$PROJECT_ROOT"

OUTPUT_DIR="${WEB_RELEASE_DIR:-$PROJECT_ROOT/release-web}"
SOURCE_BINARY_NAME="cli-memory"
SOURCE_BINARY_PATH="$PROJECT_ROOT/crates/server/target/release/$SOURCE_BINARY_NAME"
RELEASE_VERSION=""
RELEASE_PRODUCT_NAME=""
RELEASE_PLATFORM_TAG=""
RELEASE_ASSET_NAME=""
RELEASE_ASSET_PATH=""
RELEASE_CHECKSUM_PATH=""

export CARGO_INCREMENTAL=1
export CARGO_TARGET_DIR="$PROJECT_ROOT/crates/server/target"

require_command() {
    local cmd="$1"
    local message="$2"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "❌ Error: $message"
        exit 1
    fi
}

resolve_package_manager() {
    if command -v pnpm >/dev/null 2>&1; then
        PACKAGE_MANAGER="pnpm"
        return
    fi

    if command -v npm >/dev/null 2>&1; then
        PACKAGE_MANAGER="npm"
        return
    fi

    echo "❌ Error: pnpm or npm not found."
    exit 1
}

run_web_build() {
    if [[ "$PACKAGE_MANAGER" == "pnpm" ]]; then
        pnpm build:web
    else
        npm run build:web
    fi
}

install_smoke_browser() {
    local playwright_bin="$PROJECT_ROOT/node_modules/.bin/playwright"

    if [[ -x "$playwright_bin" ]]; then
        "$playwright_bin" install chromium
        return
    fi

    npx playwright install chromium
}

run_release_smoke() {
    local binary_path="$1"

    if [[ "${CLI_MEMORY_SKIP_RELEASE_SMOKE:-0}" == "1" ]]; then
        echo "⏭️  Skipping Web release smoke check (CLI_MEMORY_SKIP_RELEASE_SMOKE=1)"
        return
    fi

    echo ""
    echo "🌐 Installing browser runtime for release smoke check..."
    install_smoke_browser

    echo ""
    echo "🧪 Running Web release smoke check..."
    node "$PROJECT_ROOT/scripts/web-release-smoke.mjs" --binary "$binary_path"
}

normalize_os() {
    case "$(uname -s)" in
        Linux) echo "linux" ;;
        Darwin) echo "macos" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *) uname -s | tr '[:upper:]' '[:lower:]' ;;
    esac
}

normalize_arch() {
    case "$(uname -m)" in
        x86_64|amd64) echo "x86_64" ;;
        aarch64|arm64) echo "arm64" ;;
        *) uname -m | tr '[:upper:]' '[:lower:]' ;;
    esac
}

echo "╔════════════════════════════════════════════════════╗"
echo "║          CLI Memory Builder                    ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

require_command cargo "cargo not found. Please install Rust."
require_command node "node not found. Please install Node.js."
resolve_package_manager

RELEASE_VERSION="${RELEASE_VERSION:-$(node -p "require('./package.json').version")}"
RELEASE_PRODUCT_NAME="${RELEASE_PRODUCT_NAME:-zwpride-cli-memory-web}"
RELEASE_PLATFORM_TAG="${RELEASE_PLATFORM_TAG:-$(normalize_os)-$(normalize_arch)}"
RELEASE_ASSET_NAME="${RELEASE_ASSET_NAME:-${RELEASE_PRODUCT_NAME}-v${RELEASE_VERSION}-${RELEASE_PLATFORM_TAG}}"
RELEASE_ASSET_PATH="$OUTPUT_DIR/$RELEASE_ASSET_NAME"
RELEASE_CHECKSUM_PATH="$RELEASE_ASSET_PATH.sha256"

if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
    echo "❌ Error: node_modules not found."
    echo "   Please run \`${PACKAGE_MANAGER} install\` first."
    exit 1
fi

echo "📦 Using package manager: $PACKAGE_MANAGER"
echo "🏷️  Release version: $RELEASE_VERSION"
echo "🧾 Product name: $RELEASE_PRODUCT_NAME"
echo "🖥️  Platform tag: $RELEASE_PLATFORM_TAG"
echo "📁 Output directory: $OUTPUT_DIR"
echo "📌 Asset name: $RELEASE_ASSET_NAME"
echo ""

echo "🧹 Preparing output directory..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo ""
echo "🎨 Building frontend assets..."
run_web_build

if [[ ! -f "$PROJECT_ROOT/dist/index.html" ]]; then
    echo "❌ Error: frontend build failed, dist/index.html not found."
    exit 1
fi

echo ""
echo "🔨 Building backend binary..."
cargo build --release --manifest-path "$PROJECT_ROOT/crates/server/Cargo.toml"

if [[ ! -x "$SOURCE_BINARY_PATH" ]]; then
    echo "❌ Error: backend build failed, binary not found at $SOURCE_BINARY_PATH"
    exit 1
fi

cp "$SOURCE_BINARY_PATH" "$RELEASE_ASSET_PATH"
chmod +x "$RELEASE_ASSET_PATH"

run_release_smoke "$RELEASE_ASSET_PATH"

(
    cd "$OUTPUT_DIR"
    sha256sum "$RELEASE_ASSET_NAME" > "$(basename "$RELEASE_CHECKSUM_PATH")"
)

BINARY_SIZE="$(du -h "$RELEASE_ASSET_PATH" | cut -f1)"

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║                 Build Complete                    ║"
echo "╠════════════════════════════════════════════════════╣"
printf "║  Output: %-40s ║\n" "$RELEASE_ASSET_PATH"
printf "║  SHA256: %-40s ║\n" "$RELEASE_CHECKSUM_PATH"
printf "║  Size:   %-40s ║\n" "$BINARY_SIZE"
echo "╠════════════════════════════════════════════════════╣"
echo "║  Run:                                              ║"
printf "║    %s%-43s ║\n" "" "$RELEASE_ASSET_PATH"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo "Use RELEASE_PRODUCT_NAME / RELEASE_PLATFORM_TAG / RELEASE_ASSET_NAME to override naming when needed."
