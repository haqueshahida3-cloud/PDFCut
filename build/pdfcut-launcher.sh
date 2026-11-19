#!/bin/sh
# /usr/bin/pdfcut, installed by the PDFCut package.
# Command-line tasks run Electron as plain Node.js (ELECTRON_RUN_AS_NODE=1), so they need no display and work
# over SSH, in cron and on servers. Anything else opens the desktop app; files passed to it open in the app.
APP=/opt/PDFCut
case "${1:-}" in
  info|split|merge|compress|convert|protect|repair|ocr|watch|integrate|help|-h|--help|-v|--version)
    ELECTRON_RUN_AS_NODE=1 exec "$APP/pdfcut" "$APP/resources/cli/cli-main.cjs" "$@" ;;
esac
exec "$APP/pdfcut" "$@"
