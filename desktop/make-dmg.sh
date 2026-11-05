#!/bin/bash
# Собирает .dmg для Mac (Apple Silicon и Intel) из готовых .app.
# Приложение подписывается «ad-hoc» — без этого на Mac с Apple Silicon оно не запустится.
set -euo pipefail
cd "$(dirname "$0")"
VER=$(node -p "require('./package.json').version")
for dir in dist/mac*/; do
  app=$(ls -d "$dir"*.app | head -1)
  arch=intel; [[ "$dir" == *arm64* ]] && arch=apple-silicon
  codesign --force --deep --sign - "$app"
  stage=$(mktemp -d)
  cp -R "$app" "$stage/"
  ln -s /Applications "$stage/Applications"
  hdiutil create -volname "AI Trener" -srcfolder "$stage" -ov -format UDZO "dist/AI-Trener-$VER-mac-$arch.dmg"
  rm -rf "$stage"
done
ls -la dist/*.dmg
