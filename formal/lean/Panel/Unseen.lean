/-!
Bolinha de "não visto" e ordem das linhas (hooks/page/page.ts: `isUnseen`, `touched.sort`).
`isUnseen(abs) = touched.some(t => t.abs === abs && t.isEdited && t.at > (seen[abs] ?? 0))`.
Abrir o diff (`act` `file`) faz `seen = { ...old, [tail]: Date.now() }`.
-/
namespace Panel.Unseen

structure Touch where
  abs : String
  isEdited : Bool
  stamp : Int

abbrev Seen := String → Int

def isUnseen (touched : List Touch) (seen : Seen) (abs : String) : Bool :=
  touched.any fun t => t.abs == abs && t.isEdited && decide (t.stamp > seen abs)

def recordSeen (seen : Seen) (abs : String) (now : Int) : Seen :=
  fun k => if k = abs then now else seen k

/-- Abrir o diff tira a bolinha, desde que nenhuma edição seja do futuro. -/
theorem open_clears (touched : List Touch) (seen : Seen) (abs : String) (now : Int)
    (h : ∀ t ∈ touched, t.stamp ≤ now) : isUnseen touched (recordSeen seen abs now) abs = false := by
  unfold isUnseen
  rw [List.any_eq_false]
  intro t ht
  have := h t ht
  simp only [recordSeen, ite_true]
  simp only [Bool.and_eq_true, decide_eq_true_eq, not_and]
  intro _ _
  omega

/-- Uma nova edição, depois de aberto, traz a bolinha de volta. -/
theorem new_edit_returns (touched : List Touch) (seen : Seen) (abs : String) (now : Int)
    (t : Touch) (ht : t ∈ touched) (e : t.abs = abs) (ed : t.isEdited = true) (late : now < t.stamp) :
    isUnseen touched (recordSeen seen abs now) abs = true := by
  unfold isUnseen
  rw [List.any_eq_true]
  refine ⟨t, ht, ?_⟩
  simp [recordSeen, e, ed, late]

/-- Abrir um arquivo não mexe na bolinha dos outros. -/
theorem other_unaffected (touched : List Touch) (seen : Seen) (abs abs' : String) (now : Int)
    (h : abs' ≠ abs) : isUnseen touched (recordSeen seen abs now) abs' = isUnseen touched seen abs' := by
  unfold isUnseen recordSeen
  simp [h]

/-- Arquivo só lido (nunca editado) nunca tem bolinha. -/
theorem read_only_never_unseen (touched : List Touch) (seen : Seen) (abs : String)
    (h : ∀ t ∈ touched, t.abs = abs → t.isEdited = false) : isUnseen touched seen abs = false := by
  unfold isUnseen
  rw [List.any_eq_false]
  intro t ht
  by_cases e : t.abs = abs
  · simp [e, h t ht e]
  · simp [e]

/-- Nunca visto (`seen[abs] ?? 0`): toda edição com carimbo positivo tem bolinha. -/
theorem never_seen_dot (touched : List Touch) (abs : String) (t : Touch) (ht : t ∈ touched)
    (e : t.abs = abs) (ed : t.isEdited = true) (pos : 0 < t.stamp) :
    isUnseen touched (fun _ => 0) abs = true := by
  unfold isUnseen
  rw [List.any_eq_true]
  exact ⟨t, ht, by simp [e, ed, pos]⟩

/-! ### Ordem: arquivo em edição/leitura primeiro, depois do mais recente ao mais antigo -/

structure Row where
  abs : String
  stamp : Int

def isLive (live : Option String) (r : Row) : Int := if live = some r.abs then 1 else 0

/-- O comparador de `sort`: `Number(b is live) - Number(a is live) || b.at - a.at`. -/
def cmp (live : Option String) (a b : Row) : Int :=
  if isLive live b - isLive live a ≠ 0 then isLive live b - isLive live a else b.stamp - a.stamp

theorem isLive_cases (live : Option String) (r : Row) : isLive live r = 0 ∨ isLive live r = 1 := by
  unfold isLive; split <;> simp

theorem cmp_antisymm (live : Option String) (a b : Row) : cmp live a b = - cmp live b a := by
  unfold cmp
  have := isLive_cases live a
  have := isLive_cases live b
  split <;> split <;> omega

theorem live_first (live : Option String) (a b : Row)
    (ha : isLive live a = 1) (hb : isLive live b = 0) : cmp live a b < 0 := by
  unfold cmp; split <;> omega

theorem recent_first (live : Option String) (a b : Row) (h : isLive live a = isLive live b) :
    cmp live a b < 0 ↔ b.stamp < a.stamp := by
  unfold cmp; split <;> omega

theorem cmp_trans (live : Option String) (a b c : Row)
    (h1 : cmp live a b < 0) (h2 : cmp live b c < 0) : cmp live a c < 0 := by
  unfold cmp at *
  have := isLive_cases live a
  have := isLive_cases live b
  have := isLive_cases live c
  split at h1 <;> split at h2 <;> split <;> omega

end Panel.Unseen
