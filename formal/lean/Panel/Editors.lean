import Panel.Act
/-!
`findEditors` (hooks/core/editors.ts): o `cli` de cada editor entra em `open:cli:abs`, então não
pode ter `:`. Há duas defesas: os candidatos fixos não têm `:` e o resultado final passa por
`filter(e => !e.cli.includes(':'))`. Aqui as duas são provadas e ligadas ao parse de `Act`.
-/
namespace Panel.Editors
open Panel.Act

structure Candidate where
  name : List Char
  cli : List Char
  app : List Char

def candidates : List Candidate :=
  [ ⟨"VS Code".toList, "code".toList, "Visual Studio Code".toList⟩,
    ⟨"Cursor".toList, "cursor".toList, "Cursor".toList⟩,
    ⟨"Windsurf".toList, "windsurf".toList, "Windsurf".toList⟩,
    ⟨"Zed".toList, "zed".toList, "Zed".toList⟩,
    ⟨"Sublime Text".toList, "subl".toList, "Sublime Text".toList⟩ ]

structure Editor where
  name : List Char
  cli : List Char

/-- Probe de uma candidata: `(candidata, exitCode == 0, stdout)`. -/
abbrev Probe := Candidate × Bool × List Char

/-- Ramo Linux: `which` achou e o caminho não tem `:`; o `cli` é `c.cli`. -/
def foundLinux (ps : List Probe) : List Editor :=
  ps.filterMap fun (c, ok, out) =>
    if ok && !out.contains ':' then some ⟨c.name, c.cli⟩ else none

/-- Ramo macOS: `open -Ra` achou; o `cli` é o nome do aplicativo. -/
def foundMac (ps : List Probe) : List Editor :=
  ps.filterMap fun (c, ok, _) => if ok then some ⟨c.name, c.app⟩ else none

def finalFilter (es : List Editor) : List Editor := es.filter fun e => !e.cli.contains ':'

theorem candidates_no_colon :
    ∀ c ∈ candidates, ':' ∉ c.cli ∧ ':' ∉ c.app := by decide

theorem finalFilter_no_colon (es : List Editor) : ∀ e ∈ finalFilter es, ':' ∉ e.cli := by
  intro e he
  unfold finalFilter at he
  rw [List.mem_filter] at he
  have := he.2
  simpa using this

theorem finalFilter_keeps (es : List Editor) (e : Editor) (he : e ∈ es) (h : ':' ∉ e.cli) :
    e ∈ finalFilter es := by
  unfold finalFilter
  rw [List.mem_filter]
  exact ⟨he, by simpa using h⟩

/-- Defesa 1: sem o filtro final, os candidatos fixos já bastam nos dois ramos. -/
theorem found_cli_from_candidates (ps : List Probe) (hp : ∀ p ∈ ps, p.1 ∈ candidates) :
    (∀ e ∈ foundLinux ps, ':' ∉ e.cli) ∧ (∀ e ∈ foundMac ps, ':' ∉ e.cli) := by
  constructor
  · intro e he
    unfold foundLinux at he
    rw [List.mem_filterMap] at he
    obtain ⟨⟨c, ok, out⟩, hm, h⟩ := he
    have hc := (candidates_no_colon c (hp _ hm)).1
    simp only at h
    split at h
    · cases h; exact hc
    · cases h
  · intro e he
    unfold foundMac at he
    rw [List.mem_filterMap] at he
    obtain ⟨⟨c, ok, out⟩, hm, h⟩ := he
    have hc := (candidates_no_colon c (hp _ hm)).2
    simp only at h
    split at h
    · cases h; exact hc
    · cases h

/-- A precondição do `parseOpen` vale para todo editor que `findEditors` devolve. -/
theorem open_roundtrip_for_found (ps : List Probe) (abs : List Char) (isMac : Bool)
    (e : Editor) (he : e ∈ finalFilter (if isMac then foundMac ps else foundLinux ps)) :
    parseOpen (buildOpen e.cli abs) = (e.cli, abs) :=
  (parse_buildOpen e.cli abs (finalFilter_no_colon _ e he)).2

/-- E, contraposta: um editor cujo `cli` tem `:` é descartado, nunca chega a `open:`. -/
theorem colon_cli_dropped (es : List Editor) (e : Editor) (h : ':' ∈ e.cli) : e ∉ finalFilter es :=
  fun m => finalFilter_no_colon es e m h

end Panel.Editors
