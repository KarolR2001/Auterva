#!/usr/bin/env bash
# PreToolUse(mcp__penpot__execute_code): zapis do Penpota wykonuje jeden wyznaczony
# agent (design/AGENTS.md). Dopuszcza modyfikacje tylko z subagenta auterva-frontend
# albo z sesji uruchomionej z AUTERVA_PENPOT_WRITE=1. Pozostałym blokuje kod, który
# wygląda na zapis. Heurystyka, nie granica bezpieczeństwa.
set -uo pipefail

input=$(cat)
agent=$(jq -r '.agent_type // ""' <<<"$input")

[[ "$agent" == "auterva-frontend" || "${AUTERVA_PENPOT_WRITE:-}" == "1" ]] && exit 0

reason=$(jq -r '.tool_input.code // ""' <<<"$input" | perl -0777 -ne '
  s{/\*.*?\*/}{}gs; s{//[^\n]*}{}g;
  if (/\.(remove|clone|appendChild|insertChild|resize|rotate|bringToFront|sendToBack|bringForward|sendBackward|setParentIndex|detach|applyToken|applyToShapes|applyTypography|applyToText|applyToRange|addFlexLayout|addGridLayout|addRulerGuide|addInteraction|addFlow|addProperty|renameProperty|setVariantProperty|switchVariant|addToken|addSet|addTheme|toggleActive|connectLibrary|setPluginData|setSharedPluginData|setParentXY|createVariantContainer|createVariantFromComponents)\s*\(/) { print "metoda $1"; exit }
  if (/\b(create[A-Z]\w*|group|ungroup|flatten|createBoolean|uploadMediaUrl|uploadMediaData|undo|redo)\s*\(/) { print "metoda $1"; exit }
  while (/(?<![\w\$.])([A-Za-z_\$][\w\$]*(?:\??\.[\w\$]+|\[[^\]]+\])+)\s*(?:[-+*\/%]|\?\?|\|\||&&)?=(?![=>])/g) { next if $1 =~ /^storage\.[\w\$]+$/; print "przypisanie $1"; exit }
')

if [[ -n "$reason" ]]; then
  echo "Zablokowane przez .claude/hooks/guard-penpot.sh: kod wygląda na zapis do Penpota ($reason). Zapis wykonuje wyłącznie wyznaczony agent auterva-frontend albo sesja z AUTERVA_PENPOT_WRITE=1. Do pomocniczych danych używaj obiektu storage." >&2
  exit 2
fi
exit 0
