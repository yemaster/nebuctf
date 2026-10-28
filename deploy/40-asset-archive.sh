#!/bin/sh
set -eu
# Hashed chunks from older tabs remain available across atomic image replacements.
archive=/var/cache/nebuctf
for directory in assets pdfjs; do
  mkdir -p "$archive/$directory"
  cp -R "/usr/share/nginx/html/$directory/." "$archive/$directory/"
done
# Retain builds for 30 days; current files were just refreshed above.
find "$archive" -type f -mtime +30 -delete
