#!/usr/bin/env bash
# Copy the deployable atlas files into your website source tree,
# then deploy the site as usual (rsync).
#
# Usage: ./scripts/sync-to-site.sh /path/to/toa-site/ecosystem
set -euo pipefail

#DEST="${1:?Usage: sync-to-site.sh /path/to/toa-site/ecosystem}"
DEST="forge@toa-forge:the-open-accelerator.com/public/ecosystem/"

scp index.html data.js "$DEST"

echo "✓ Synced index.html + data.js → $DEST"
echo "  Now rsync your site as usual. The atlas will be live at /ecosystem/"
