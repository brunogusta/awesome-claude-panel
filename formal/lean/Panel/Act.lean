import Panel.Escape
/-!
Strings de ação (`data-act`) como `List Char`: construtores de page.ts e o parser de `act`
em actions.ts (`action.split(':')`, `verb = primeiro`, `tail = resto.join(':')`).
-/
namespace Panel.Act
open Panel.Escape

/-- `split(':')` sem o primeiro segmento separado: `(primeiro, demais)`. -/
def splitC : List Char → List Char × List (List Char)
  | [] => ([], [])
  | c :: cs =>
    let (h, t) := splitC cs
    if c = ':' then ([], h :: t) else (c :: h, t)

/-- `split(':')` completo: lista nunca vazia, como em JS. -/
def splitAll (s : List Char) : List (List Char) :=
  let (h, t) := splitC s
  h :: t

/-- `rest.join(':')`. -/
def joinColon : List (List Char) → List Char
  | [] => []
  | y :: r => y ++ r.flatMap (fun z => ':' :: z)

theorem joinColon_splitAll (s : List Char) : joinColon (splitAll s) = s := by
  induction s with
  | nil => rfl
  | cons c cs ih =>
    unfold splitAll at *
    simp only [splitC]
    generalize splitC cs = p at *
    obtain ⟨h, t⟩ := p
    by_cases hc : c = ':'
    · subst hc; simp [joinColon] at *; rw [← ih]
    · simp [hc, joinColon] at *; exact ih

theorem splitC_prefix (a b : List Char) (ha : ':' ∉ a) :
    splitC (a ++ ':' :: b) = (a, splitAll b) := by
  induction a with
  | nil => simp [splitC, splitAll]
  | cons c t ih =>
    have hc : c ≠ ':' := fun e => ha (by simp [e])
    have ht : ':' ∉ t := fun e => ha (by simp [e])
    simp only [List.cons_append, splitC, ih ht, hc, ite_false]

theorem splitAll_prefix (a b : List Char) (ha : ':' ∉ a) :
    splitAll (a ++ ':' :: b) = a :: splitAll b := by
  unfold splitAll
  rw [splitC_prefix a b ha]
  rfl

/-- Parser de `act`: `(verbo, cauda)`. -/
def parse (s : List Char) : List Char × List Char :=
  match splitAll s with
  | [] => ([], [])
  | v :: rest => (v, joinColon rest)

/-- Ramo `open`: `cli = rest[0]`, `abs = rest.slice(1).join(':')`. -/
def parseOpen (s : List Char) : List Char × List Char :=
  match splitAll s with
  | _ :: cli :: rest => (cli, joinColon rest)
  | _ => ([], [])

def build (verb abs : List Char) : List Char := verb ++ ':' :: abs
def buildOpen (cli abs : List Char) : List Char := "open".toList ++ ':' :: (cli ++ ':' :: abs)

/-- Verbos com caminho que a página monta. -/
def pathVerbs : List (List Char) :=
  ["file".toList, "copy".toList, "mention".toList, "folder".toList, "dir".toList]

/-- Verbos sem carga (`chip`/`tree`). -/
def bareVerbs : List (List Char) :=
  ["tree".toList, "refresh".toList, "collapse".toList, "sizes".toList, "hidden".toList, "scope".toList]

theorem verbs_no_colon : ∀ v ∈ pathVerbs ++ bareVerbs ++ ["open".toList], ':' ∉ v := by
  decide

/-- Para todo `abs` (qualquer caractere, inclusive `:`) e verbo sem `:`. -/
theorem parse_build (verb abs : List Char) (hv : ':' ∉ verb) :
    parse (build verb abs) = (verb, abs) := by
  unfold parse build
  rw [splitAll_prefix verb abs hv]
  simp [joinColon_splitAll]

theorem parse_build_pathVerbs (abs : List Char) :
    ∀ v ∈ pathVerbs, parse (build v abs) = (v, abs) := by
  intro v hv
  apply parse_build
  exact verbs_no_colon v (by simp [hv])

theorem splitAll_nocolon (v : List Char) (hv : ':' ∉ v) : splitAll v = [v] := by
  induction v with
  | nil => rfl
  | cons c t ih =>
    have hc : c ≠ ':' := fun e => hv (by simp [e])
    have ht := ih (fun e => hv (by simp [e]))
    unfold splitAll at *
    simp only [splitC, hc, ite_false]
    generalize splitC t = p at *
    obtain ⟨h, r⟩ := p
    simp at ht
    simp [ht]

theorem parse_bare : ∀ v ∈ bareVerbs, parse v = (v, []) := by
  intro v hv
  have hn : ':' ∉ v := verbs_no_colon v (by simp [hv])
  simp [parse, splitAll_nocolon v hn, joinColon]

/-- `open:cli:abs` com `cli` sem `:` e `abs` arbitrário. -/
theorem parse_buildOpen (cli abs : List Char) (hc : ':' ∉ cli) :
    parse (buildOpen cli abs) = ("open".toList, cli ++ ':' :: abs) ∧
    parseOpen (buildOpen cli abs) = (cli, abs) := by
  have ho : ':' ∉ "open".toList := verbs_no_colon _ (by simp)
  have e : splitAll (buildOpen cli abs) = "open".toList :: cli :: splitAll abs := by
    unfold buildOpen
    rw [splitAll_prefix _ _ ho, splitAll_prefix _ _ hc]
  constructor
  · have := parse_build "open".toList (cli ++ ':' :: abs) ho
    exact this
  · simp [parseOpen, e, joinColon_splitAll]

/-- O que o navegador entrega ao clicar: `data-act` passa por `esc` e é decodificado de volta. -/
theorem roundtrip_attr (verb abs : List Char) (hv : ':' ∉ verb) :
    parse (unesc (esc (build verb abs))) = (verb, abs) := by
  rw [unesc_esc]; exact parse_build verb abs hv

theorem roundtrip_attr_open (cli abs : List Char) (hc : ':' ∉ cli) :
    parseOpen (unesc (esc (buildOpen cli abs))) = (cli, abs) := by
  rw [unesc_esc]; exact (parse_buildOpen cli abs hc).2


/-- Todo segmento devolvido por `split(':')` é livre de `:`. -/
theorem splitC_fst_no_colon (s : List Char) : ':' ∉ (splitC s).1 := by
  induction s with
  | nil => simp [splitC]
  | cons c cs ih =>
    simp only [splitC]
    generalize splitC cs = p at *
    obtain ⟨h, t⟩ := p
    by_cases hc : c = ':'
    · simp [hc]
    · simp only [hc, ite_false]
      intro m
      rcases List.mem_cons.mp m with e | m
      · exact hc e.symm
      · exact ih m

/-- Um `cli` com `:` quebra o parse: o cli lido nunca é o original (nem mesmo igual a ele). -/
theorem parseOpen_breaks_on_colon (cli abs : List Char) (hc : ':' ∈ cli) :
    (parseOpen (buildOpen cli abs)).1 ≠ cli := by
  intro e
  have hopen : ':' ∉ "open".toList := verbs_no_colon _ (by simp)
  have hs : splitAll (buildOpen cli abs) =
      "open".toList :: (splitAll (cli ++ ':' :: abs)) := by
    unfold buildOpen
    exact splitAll_prefix _ _ hopen
  have hp : (parseOpen (buildOpen cli abs)).1 = (splitC (cli ++ ':' :: abs)).1 := by
    unfold parseOpen
    rw [hs]
    unfold splitAll
    rfl
  rw [hp] at e
  exact splitC_fst_no_colon _ (e ▸ hc)

/-- Contraexemplo concreto: `open:a:b:/x` lê cli `a` e caminho `b:/x`. -/
theorem parseOpen_counterexample :
    parseOpen (buildOpen "a:b".toList "/x".toList) = ("a".toList, "b:/x".toList) ∧
    parseOpen (buildOpen "a:b".toList "/x".toList) ≠ ("a:b".toList, "/x".toList) := by
  decide

end Panel.Act
