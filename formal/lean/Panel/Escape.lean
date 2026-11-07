/-!
Modelo de `esc` (hooks/page/format.ts). Cadeias de texto como `List Char`;
os cinco caracteres especiais são ASCII, então pares substitutos UTF-16 não mudam nada.
-/
namespace Panel.Escape

def escChar (c : Char) : List Char :=
  if c = '&' then "&amp;".toList
  else if c = '<' then "&lt;".toList
  else if c = '>' then "&gt;".toList
  else if c = '"' then "&quot;".toList
  else if c = '\'' then "&#39;".toList
  else [c]

def esc (s : List Char) : List Char := s.flatMap escChar

/-- Decodificação de entidades feita pelo navegador ao ler o atributo. -/
def unesc : List Char → List Char
  | [] => []
  | '&' :: 'a' :: 'm' :: 'p' :: ';' :: r => '&' :: unesc r
  | '&' :: 'l' :: 't' :: ';' :: r => '<' :: unesc r
  | '&' :: 'g' :: 't' :: ';' :: r => '>' :: unesc r
  | '&' :: 'q' :: 'u' :: 'o' :: 't' :: ';' :: r => '"' :: unesc r
  | '&' :: '#' :: '3' :: '9' :: ';' :: r => '\'' :: unesc r
  | c :: r => c :: unesc r

def entities : List (List Char) :=
  ["&amp;".toList, "&lt;".toList, "&gt;".toList, "&quot;".toList, "&#39;".toList]

def startsEntity (t : List Char) : Bool := entities.any (fun e => e.isPrefixOf t)

/-- Todo `&` do texto começa uma das cinco entidades. -/
def AmpOk : List Char → Prop
  | [] => True
  | '&' :: r => startsEntity ('&' :: r) = true ∧ AmpOk r
  | _ :: r => AmpOk r

theorem unesc_plain (c : Char) (r : List Char) (h : c ≠ '&') :
    unesc (c :: r) = c :: unesc r := by
  rw [unesc]
  all_goals (intros; simp_all)

theorem unesc_esc_cons (c : Char) (r : List Char) :
    unesc (escChar c ++ r) = c :: unesc r := by
  by_cases h1 : c = '&'
  · subst h1; simp [escChar, unesc]
  by_cases h2 : c = '<'
  · subst h2; simp [escChar, unesc]
  by_cases h3 : c = '>'
  · subst h3; simp [escChar, unesc]
  by_cases h4 : c = '"'
  · subst h4; simp [escChar, unesc]
  by_cases h5 : c = '\''
  · subst h5; simp [escChar, unesc]
  have : escChar c = [c] := by simp [escChar, h1, h2, h3, h4, h5]
  rw [this]
  exact unesc_plain c r h1

/-- `unesc` é inversa à esquerda de `esc`. -/
theorem unesc_esc (s : List Char) : unesc (esc s) = s := by
  induction s with
  | nil => rfl
  | cons c t ih => simp only [esc, List.flatMap_cons] at *; rw [unesc_esc_cons, ih]

/-- (b) injetividade. -/
theorem esc_injective {a b : List Char} (h : esc a = esc b) : a = b := by
  have := congrArg unesc h
  rwa [unesc_esc, unesc_esc] at this

theorem esc_no_raw (s : List Char) :
    ∀ c ∈ esc s, c ≠ '<' ∧ c ≠ '>' ∧ c ≠ '"' ∧ c ≠ '\'' := by
  induction s with
  | nil => simp [esc]
  | cons d t ih =>
    intro c hc
    simp only [esc, List.flatMap_cons, List.mem_append] at hc
    rcases hc with hc | hc
    · by_cases h1 : d = '&'
      · subst h1; simp [escChar] at hc
        rcases hc with h | h | h | h | h <;> subst h <;> decide
      by_cases h2 : d = '<'
      · subst h2; simp [escChar] at hc
        rcases hc with h | h | h | h <;> subst h <;> decide
      by_cases h3 : d = '>'
      · subst h3; simp [escChar] at hc
        rcases hc with h | h | h | h <;> subst h <;> decide
      by_cases h4 : d = '"'
      · subst h4; simp [escChar] at hc
        rcases hc with h | h | h | h | h | h <;> subst h <;> decide
      by_cases h5 : d = '\''
      · subst h5; simp [escChar] at hc
        rcases hc with h | h | h | h | h <;> subst h <;> decide
      have : escChar d = [d] := by simp [escChar, h1, h2, h3, h4, h5]
      rw [this] at hc; simp at hc; subst hc
      exact ⟨fun e => h2 e, fun e => h3 e, fun e => h4 e, fun e => h5 e⟩
    · exact ih c hc

theorem ampOk_plain (c : Char) (r : List Char) (h : c ≠ '&') :
    AmpOk (c :: r) ↔ AmpOk r := by
  rw [AmpOk]
  all_goals (intros; simp_all)

theorem ampOk_amp (r : List Char) :
    AmpOk ('&' :: r) ↔ (startsEntity ('&' :: r) = true ∧ AmpOk r) := by
  rw [AmpOk]

theorem ampOk_esc (s : List Char) : AmpOk (esc s) := by
  induction s with
  | nil => simp [esc, AmpOk]
  | cons c t ih =>
    simp only [esc, List.flatMap_cons] at *
    by_cases h1 : c = '&'
    · subst h1; simp [escChar, AmpOk, startsEntity, entities]; exact ih
    by_cases h2 : c = '<'
    · subst h2; simp [escChar, AmpOk, startsEntity, entities]; exact ih
    by_cases h3 : c = '>'
    · subst h3; simp [escChar, AmpOk, startsEntity, entities]; exact ih
    by_cases h4 : c = '"'
    · subst h4; simp [escChar, AmpOk, startsEntity, entities]; exact ih
    by_cases h5 : c = '\''
    · subst h5; simp [escChar, AmpOk, startsEntity, entities]; exact ih
    have : escChar c = [c] := by simp [escChar, h1, h2, h3, h4, h5]
    rw [this]
    simp only [List.singleton_append]
    exact (ampOk_plain c _ h1).mpr ih

theorem ampOk_tail {c : Char} {r : List Char} (h : AmpOk (c :: r)) : AmpOk r := by
  by_cases hc : c = '&'
  · subst hc; exact ((ampOk_amp r).mp h).2
  · exact (ampOk_plain c r hc).mp h

/-- (a) cada `&` do resultado inicia uma entidade (forma por sufixo). -/
theorem esc_amp_starts_entity (s : List Char) :
    ∀ l1 l2, esc s = l1 ++ '&' :: l2 → startsEntity ('&' :: l2) = true := by
  have key : ∀ (l : List Char), AmpOk l → ∀ l1 l2, l = l1 ++ '&' :: l2 →
      startsEntity ('&' :: l2) = true := by
    intro l h l1
    induction l1 generalizing l with
    | nil => intro l2 e; subst e; exact h.1
    | cons c l1' ih =>
      intro l2 e; subst e
      exact ih _ (ampOk_tail h) l2 rfl
  exact key _ (ampOk_esc s)

end Panel.Escape
