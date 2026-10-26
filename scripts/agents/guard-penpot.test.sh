#!/usr/bin/env bash
# Macierz decyzji hooka .claude/hooks/guard-penpot.sh: BLOCK (exit 2) lub ALLOW.
set -uo pipefail

hook="$(git rev-parse --show-toplevel)/.claude/hooks/guard-penpot.sh"
pass=0 fail=0

t() {
  local expected=$1 agent=$2 code=$3 rc result
  jq -n --arg c "$code" --arg a "$agent" \
    '{tool_input:{code:$c}} + (if $a == "" then {} else {agent_type:$a} end)' | env -u AUTERVA_PENPOT_WRITE "$hook" >/dev/null 2>&1
  rc=$?
  result=$([[ $rc -eq 2 ]] && echo BLOCK || echo ALLOW)
  if [[ "$result" == "$expected" ]]; then pass=$((pass + 1)); else
    fail=$((fail + 1)); echo "FAIL expected=$expected got=$result agent=[$agent] code=$code"
  fi
}

# Odczyt — dozwolony wszystkim
t ALLOW "" 'return penpotUtils.getPages();'
t ALLOW auterva-qa 'const b = penpotUtils.findShapeById("x"); return penpotUtils.shapeStructure(b, 2);'
t ALLOW auterva-reviewer 'storage.boards = penpotUtils.findShapes(s => s.type === "board", penpot.root); return storage.boards.length;'
t ALLOW "" 'storage.fn = (a) => a.width >= 100 && a.name !== "x"; return 1;'
t ALLOW "" 'return penpot.generateStyle(penpot.selection, { type: "css", withChildren: true });'
t ALLOW "" '// shape.name = "x" w komentarzu
return penpot.currentPage.name;'
t ALLOW "" 'const r = { x: 1, fills: [] }; let n = 0; n = 2; return r;'

# Zapis — blokowany poza auterva-frontend
t BLOCK "" 'const s = penpotUtils.findShapeById("x"); if (s) s.name = "y";'
t BLOCK auterva-qa 'shape.fills = [{ fillColor: "#151515", fillOpacity: 1 }];'
t BLOCK auterva-reviewer 'board.resize(390, 844);'
t BLOCK "" 'penpot.createRectangle();'
t BLOCK "" 'shape.remove();'
t BLOCK "" 'parent.appendChild(shape);'
t BLOCK "" 'penpot.library.local.createColor();'
t BLOCK "" 'shape.layoutChild.absolute = true;'
t BLOCK "" 'storage.s.x += 4;'
t BLOCK auterva-scout 'set.addToken({type: "color", name: "a", value: "#000000"});'

# Wyznaczony edytor
t ALLOW auterva-frontend 'shape.name = "Sidebar item"; board.resize(390, 844);'

echo "guard-penpot: pass=$pass fail=$fail"
[[ $fail -eq 0 ]]
