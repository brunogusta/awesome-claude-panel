/-!
Orçamento de altura (hooks/page/page.ts: `diffOf`, `binaryOf`, `blockOf`, `planOf`, `estimateHeight`).
Pixels inteiros (`Int`); `Math.floor(left / TREE_ROW_PX)` é a divisão inteira de `Int` (divisor positivo).
O diff entra só como lista de linhas "é cabeçalho de trecho?" mais `more`; a árvore, só como tamanho.
-/
namespace Panel.Height

def MAX_DIFF_LINES : Int := 300
def MAX_LIST : Int := 40
def MAX_TREE : Int := 200
def PAGE_BUDGET : Int := 8000
def FIXED : Int := 400
def ROW : Int := 36
def LN : Int := 20
def HUNK : Int := 28
def DIFF_FRAME : Int := 90
def TREE_ROW : Int := 36

structure St where
  lines : Int
  px : Int
  hidden : Int
  full : Bool

def diffStep (budget : Int) (st : St) (isHunk : Bool) : St :=
  let cost := if isHunk then HUNK else LN
  let full := st.full || decide (st.lines ≥ MAX_DIFF_LINES) || decide (st.px + cost + HUNK > budget)
  if full then
    { st with full := true, hidden := st.hidden + (if isHunk then 0 else 1) }
  else
    { st with px := st.px + cost, lines := st.lines + (if isHunk then 0 else 1) }

def diffRun (budget more : Int) (rows : List Bool) : St :=
  rows.foldl (diffStep budget) ⟨0, DIFF_FRAME, more, false⟩

/-- `diffOf(...).px`: a linha "+N linhas não mostradas" soma `HUNK` quando há oculto. -/
def pxOfSt (st : St) : Int := st.px + (if st.hidden > 0 then HUNK else 0)

def diffPx (budget more : Int) (rows : List Bool) : Int := pxOfSt (diffRun budget more rows)

/-- Invariante do laço: sempre sobra espaço para a linha "mais" e as linhas não passam de 300. -/
theorem diff_invariant (budget : Int) :
    ∀ (rows : List Bool) (st : St), st.px + HUNK ≤ budget → st.lines ≤ MAX_DIFF_LINES →
      (rows.foldl (diffStep budget) st).px + HUNK ≤ budget ∧
      (rows.foldl (diffStep budget) st).lines ≤ MAX_DIFF_LINES := by
  intro rows
  induction rows with
  | nil => intro st h1 h2; exact ⟨h1, h2⟩
  | cons r t ih =>
    intro st h1 h2
    simp only [List.foldl_cons]
    apply ih
    · unfold diffStep
      by_cases hf : (st.full || decide (st.lines ≥ MAX_DIFF_LINES) || decide (st.px + (if r then HUNK else LN) + HUNK > budget)) = true
      · simp only [hf, ite_true]; exact h1
      · simp only [hf]
        have : ¬ (st.px + (if r then HUNK else LN) + HUNK > budget) := by
          intro c; apply hf; simp [c]
        cases r <;> simp [HUNK, LN] at * <;> omega
    · unfold diffStep
      by_cases hf : (st.full || decide (st.lines ≥ MAX_DIFF_LINES) || decide (st.px + (if r then HUNK else LN) + HUNK > budget)) = true
      · simp only [hf, ite_true]; exact h2
      · simp only [hf]
        have : ¬ (st.lines ≥ MAX_DIFF_LINES) := by
          intro c; apply hf; simp [c]
        cases r <;> simp [MAX_DIFF_LINES] at * <;> omega

/-- A reserva da linha "mais" nunca é perdida: o `diffPx` final cabe no orçamento do diff,
e no máximo 300 linhas (sem contar cabeçalhos de trecho) são desenhadas. -/
theorem diffPx_le_budget (budget more : Int) (rows : List Bool) (hb : DIFF_FRAME + HUNK ≤ budget) :
    diffPx budget more rows ≤ budget ∧ (diffRun budget more rows).lines ≤ MAX_DIFF_LINES := by
  have := diff_invariant budget rows ⟨0, DIFF_FRAME, more, false⟩ hb (by simp [MAX_DIFF_LINES])
  simp only [diffRun] at *
  unfold diffPx pxOfSt diffRun
  constructor
  · split <;> simp [HUNK] at * <;> omega
  · exact this.2

/-- `openDiff`: binário (`binaryOf`, `DIFF_FRAME_PX`) ou linhas (`diffOf`). -/
inductive Diff where
  | binary
  | rows (kinds : List Bool) (more : Int)

structure Model where
  count : Int
  diff : Option Diff
  tree : Option Int

def listN (count : Int) : Int := min count MAX_LIST
def listK (count : Int) : Int := listN count + (if count > listN count then 1 else 0)
def listPx (count : Int) : Int := (if listK count = 0 then 1 else listK count) * ROW

def diffBudget (m : Model) : Int :=
  match m.diff with
  | some _ => PAGE_BUDGET - FIXED - listPx m.count - 2 * ROW
  | none => 0

/-- `blockOf(model, budget)?.px ?? 0`. -/
def diffPxOf (m : Model) : Int :=
  match m.diff with
  | some .binary => DIFF_FRAME
  | some (.rows kinds more) => diffPx (diffBudget m) more kinds
  | none => 0

def left (m : Model) : Int :=
  PAGE_BUDGET - FIXED - listPx m.count - (if m.diff.isSome then ROW else 0) - diffPxOf m - ROW

def treeN (m : Model) : Int :=
  match m.tree with
  | some len => max 0 (min MAX_TREE (min len (left m / TREE_ROW)))
  | none => 0

def estimate (m : Model) : Int :=
  FIXED + listPx m.count
    + (match m.diff with | some _ => diffPxOf m + ROW | none => 0)
    + (match m.tree with
       | some len => (treeN m + (if len > treeN m then 1 else 0)) * TREE_ROW
       | none => 0)

theorem listPx_bounds (c : Int) (h : 0 ≤ c) : ROW ≤ listPx c ∧ listPx c ≤ 41 * ROW := by
  unfold listPx listK listN MAX_LIST ROW
  split <;> split <;> omega

/-- 5. Para qualquer modelo (sem hipótese sobre o diff ou a árvore), a estimativa cabe em 8000. -/
theorem estimate_le_budget (m : Model) (hc : 0 ≤ m.count)
    (ht : ∀ len, m.tree = some len → 0 ≤ len) : estimate m ≤ PAGE_BUDGET := by
  have lp := listPx_bounds m.count hc
  have key : (m.diff.isSome = true → diffPxOf m ≤ diffBudget m) := by
    intro h
    cases hd : m.diff with
    | none => rw [hd] at h; simp at h
    | some p =>
      cases p with
      | binary =>
        simp only [diffPxOf, hd, diffBudget]
        unfold DIFF_FRAME PAGE_BUDGET FIXED ROW at *
        omega
      | rows rows more =>
        simp only [diffPxOf, hd]
        apply (diffPx_le_budget _ _ _ _).1
        simp only [diffBudget, hd]
        unfold DIFF_FRAME HUNK PAGE_BUDGET FIXED ROW at *
        omega
  have nodiff : m.diff = none → diffPxOf m = 0 := by intro h; simp [diffPxOf, h]
  unfold estimate treeN left
  cases hd : m.diff with
  | none =>
    have := nodiff hd
    cases htr : m.tree with
    | none => simp [PAGE_BUDGET, FIXED, ROW] at *; omega
    | some len =>
      have := ht len htr
      simp [hd, htr, PAGE_BUDGET, FIXED, ROW, TREE_ROW, MAX_TREE] at *
      split <;> omega
  | some p =>
    have k := key (by simp [hd])
    simp only [diffBudget, hd] at k
    cases htr : m.tree with
    | none => simp [hd, htr, PAGE_BUDGET, FIXED, ROW] at *; omega
    | some len =>
      have := ht len htr
      simp [hd, htr, PAGE_BUDGET, FIXED, ROW, TREE_ROW, MAX_TREE] at *
      split <;> omega

/-- Limites do plano: lista ≤ 40, árvore ≤ 200 (sem hipótese alguma além de tamanhos ≥ 0). -/
theorem plan_caps (m : Model) : listN m.count ≤ MAX_LIST ∧ treeN m ≤ MAX_TREE := by
  unfold listN treeN MAX_LIST MAX_TREE
  split <;> omega

end Panel.Height
