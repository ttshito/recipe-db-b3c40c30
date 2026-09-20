#!/bin/bash
# 更新を公開する。資産のURLに版を付け直して、スマホのキャッシュに古い画面が残らないようにする。
# 使い方: ./release.sh "コミットメッセージ"
set -euo pipefail
cd "$(dirname "$0")"
V=$(date +%Y%m%d-%H%M)
sed -i -E "s/(style\.css\?v=)[0-9-]+/\1$V/; s/(app\.js\?v=)[0-9-]+/\1$V/" index.html
sed -i -E "s/^const BUILD = '[0-9-]+';/const BUILD = '$V';/" app.js
git add -A
git commit -q -m "${1:-更新} (版 $V)"
git push -q
echo "版 $V を公開しました。反映まで1〜2分かかります。"
