#!/bin/sh
# Swish installer for macOS and Linux.
#
# Browsers don't let outside programs install extensions silently, so this
# copies Swish to a permanent folder and tells you the one click left to make.
set -e

here=$(cd "$(dirname "$0")" && pwd)
source="$here/extension"

if [ ! -f "$source/manifest.json" ]; then
  echo "Can't find the extension files next to this installer." >&2
  echo "Unzip the whole download first, then run install.sh from the unzipped folder." >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin) dest="$HOME/Library/Application Support/Swish" ;;
  *) dest="${XDG_DATA_HOME:-$HOME/.local/share}/swish" ;;
esac

updating=no
[ -f "$dest/manifest.json" ] && updating=yes
rm -rf "$dest"
mkdir -p "$(dirname "$dest")"
cp -R "$source" "$dest"

echo
echo "  Swish installed to $dest"
echo
if [ "$updating" = yes ]; then
  echo "  Updated. Open your extensions page and click the reload icon on Swish."
else
  echo "  One last step in your browser:"
  echo "    1. Open chrome://extensions (or edge://extensions, brave://extensions)."
  echo "    2. Turn on Developer mode."
  echo "    3. Click \"Load unpacked\" and choose: $dest"
  echo
  echo "  Keep that folder where it is; the browser loads Swish from there."
fi
echo
