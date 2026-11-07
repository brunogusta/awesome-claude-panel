/-!
Rolagem em pixels (hooks/smooth.ts e `renderPane`/`paintSlice` em hooks/pane.tsx).
Tudo em `Int` (as posições reais são inteiras com `cellHeight` inteiro, o padrão 28).
`Math.round(gap * 0.4)` vira `floor((4·gap + 5) / 10)`: `gap·0.4 + 0.5` nunca cai em inteiro
exato porque `4·gap` é par e `5·(2k+1)` é ímpar, então não há dúvida de arredondamento.
-/
namespace Panel.Scroll

def SNAP_PX : Int := 3

def clampPx (value max' : Int) : Int := min (max 0 value) (max 0 max')

def ease (gap : Int) : Int := (4 * gap + 5) / 10

def stepToward (cur tgt : Int) : Int :=
  if -SNAP_PX ≤ tgt - cur ∧ tgt - cur ≤ SNAP_PX then tgt else cur + ease (tgt - cur)

def absI (x : Int) : Int := max x (-x)

theorem clampPx_bounds (v m : Int) : 0 ≤ clampPx v m ∧ clampPx v m ≤ max 0 m := by
  unfold clampPx; omega

theorem clampPx_le (v m : Int) (hm : 0 ≤ m) : 0 ≤ clampPx v m ∧ clampPx v m ≤ m := by
  unfold clampPx; omega

theorem clampPx_id (v m : Int) (h0 : 0 ≤ v) (h1 : v ≤ m) : clampPx v m = v := by
  unfold clampPx; omega

theorem clampPx_idem (v m : Int) : clampPx (clampPx v m) m = clampPx v m := by
  unfold clampPx; omega

theorem stepToward_self (t : Int) : stepToward t t = t := by
  unfold stepToward SNAP_PX; simp

/-- Nunca ultrapassa o alvo: o novo ponto fica entre o atual e o alvo. -/
theorem stepToward_between (cur tgt : Int) :
    (cur ≤ tgt → cur ≤ stepToward cur tgt ∧ stepToward cur tgt ≤ tgt) ∧
    (tgt ≤ cur → tgt ≤ stepToward cur tgt ∧ stepToward cur tgt ≤ cur) := by
  unfold stepToward SNAP_PX ease
  split <;> omega

/-- Aproxima estritamente: fora do alvo, a distância ao alvo diminui. -/
theorem stepToward_strict (cur tgt : Int) (h : cur ≠ tgt) :
    absI (tgt - stepToward cur tgt) < absI (tgt - cur) := by
  unfold stepToward SNAP_PX ease absI
  split <;> omega

/-- Quando a distância passa de `SNAP_PX`, o passo é de pelo menos 1 px (anda sempre). -/
theorem stepToward_moves (cur tgt : Int) (h : cur ≠ tgt) : stepToward cur tgt ≠ cur := by
  unfold stepToward SNAP_PX ease
  split <;> omega

/-- Dentro de `[0, M]`, o passo não sai de `[0, M]`. -/
theorem stepToward_in_range (cur tgt M : Int)
    (hc : 0 ≤ cur ∧ cur ≤ M) (ht : 0 ≤ tgt ∧ tgt ≤ M) :
    0 ≤ stepToward cur tgt ∧ stepToward cur tgt ≤ M := by
  unfold stepToward SNAP_PX ease
  split <;> omega

def iter : Nat → Int → Int → Int
  | 0, cur, _ => cur
  | n + 1, cur, tgt => iter n (stepToward cur tgt) tgt

theorem iter_self (n : Nat) (t : Int) : iter n t t = t := by
  induction n with
  | zero => rfl
  | succ n ih => simp only [iter, stepToward_self, ih]

/-- Termina exatamente no alvo em número finito de passos: no máximo `|alvo - atual|`. -/
theorem iter_reaches (n : Nat) :
    ∀ cur tgt : Int, absI (tgt - cur) ≤ n → iter n cur tgt = tgt := by
  induction n with
  | zero =>
    intro cur tgt h
    unfold absI at h
    have : cur = tgt := by omega
    subst this; rfl
  | succ n ih =>
    intro cur tgt h
    by_cases e : cur = tgt
    · subst e; exact iter_self _ _
    · have s := stepToward_strict cur tgt e
      simp only [iter]
      apply ih
      unfold absI at *
      omega

/-- Cada quadro anda `≥ 1` px e a rolagem de uma volta da roda (56 px) termina em ≤ 56 passos. -/
theorem wheel_turn_finishes (cur : Int) :
    iter 56 cur (cur + 56) = cur + 56 :=
  iter_reaches 56 _ _ (by unfold absI; omega)

/-- Exemplos que o teste do TS também percorre. -/
theorem wheel_turn_example : iter 12 0 56 = 56 := by decide +kernel
theorem long_scroll_example : iter 20 0 900 = 900 := by decide +kernel

/-! ### Página, fatia e escala -/

def needsScroll (frameH limit : Int) : Bool := decide (frameH > limit)
def maxScrollPx (frameH limit : Int) : Int := if needsScroll frameH limit then frameH - limit else 0

/-- Tamanho do recorte mostrado (`shotPx`) para o deslocamento `off` já arredondado. -/
def shotPx (frameH limit off : Int) : Int :=
  if needsScroll frameH limit then min limit (frameH - off) else min frameH limit

def offsetPx (frameH limit scrollPx : Int) : Int := if needsScroll frameH limit then scrollPx else 0

theorem maxScrollPx_eq (frameH limit : Int) (h : frameH > limit) :
    maxScrollPx frameH limit = frameH - limit := by
  unfold maxScrollPx needsScroll; simp [h]

theorem maxScrollPx_nonneg (frameH limit : Int) : 0 ≤ maxScrollPx frameH limit := by
  unfold maxScrollPx needsScroll
  split <;> simp_all <;> omega

/-- A fatia `[y, y + shotPx)` fica dentro da página e tem pelo menos 1 px,
para `scrollPx` preso por `clampPx` ao máximo. -/
theorem slice_within_page (frameH limit scrollPx : Int)
    (hf : 1 ≤ frameH) (hl : 1 ≤ limit) :
    let y := offsetPx frameH limit (clampPx scrollPx (maxScrollPx frameH limit))
    let s := shotPx frameH limit y
    0 ≤ y ∧ 1 ≤ s ∧ y + s ≤ frameH := by
  intro y s
  have hm := maxScrollPx_nonneg frameH limit
  have hc := clampPx_le scrollPx (maxScrollPx frameH limit) hm
  simp only [y, s, offsetPx, shotPx, maxScrollPx, needsScroll] at *
  split <;> simp_all <;> omega

def rowsOf (shot ch : Int) : Int := max 1 ((shot + ch - 1) / ch)

/-- `rows * ch ≥ shotPx`, então a escala `rows·ch / shotPx` é ≥ 1. -/
theorem rows_cover (shot ch : Int) (hs : 1 ≤ shot) (hc : 1 ≤ ch) :
    shot ≤ rowsOf shot ch * ch ∧ rowsOf shot ch * ch < shot + ch := by
  unfold rowsOf
  have h1 : 1 ≤ (shot + ch - 1) / ch := by
    apply (Int.le_ediv_iff_mul_le (by omega)).mpr; omega
  have e : max 1 ((shot + ch - 1) / ch) = (shot + ch - 1) / ch := by omega
  rw [e]
  have a := Int.lt_ediv_add_one_mul_self (shot + ch - 1) (show 0 < ch by omega)
  have b := Int.ediv_mul_le (shot + ch - 1) (show ch ≠ 0 by omega)
  rw [Int.add_mul, Int.one_mul] at a
  constructor <;> omega

/-- A escala como fração `num / den`. Com `den = 0` o JS devolve `Infinity`/`NaN`. -/
structure Scale where
  num : Int
  den : Int

def scaleOf (rows ch shot : Int) : Scale := ⟨rows * ch, shot⟩

def Scale.WellDefined (s : Scale) : Prop := 0 < s.den ∧ 0 < s.num

/-- Com a guarda `shotPx < 1 → desiste`, a escala fica bem definida e positiva. -/
theorem scale_wellDefined (ch shot : Int) (hs : 1 ≤ shot) (hc : 1 ≤ ch) :
    (scaleOf (rowsOf shot ch) ch shot).WellDefined := by
  have := rows_cover shot ch hs hc
  unfold scaleOf Scale.WellDefined
  constructor <;> simp <;> omega

/-- Sem a guarda, `shotPx = 0` zera o denominador: divisão por zero. -/
theorem scale_without_guard_divides_by_zero (rows ch : Int) :
    ¬ (scaleOf rows ch 0).WellDefined := by
  unfold scaleOf Scale.WellDefined; simp

/-- A guarda `shotPx < 1` é a negação exata da condição que torna a escala boa. -/
theorem guard_iff (ch shot : Int) (hc : 1 ≤ ch) :
    ¬ (shot < 1) ↔ (scaleOf (rowsOf shot ch) ch shot).WellDefined := by
  constructor
  · intro h; exact scale_wellDefined ch shot (by omega) hc
  · intro h h1
    unfold scaleOf Scale.WellDefined at h
    simp only at h
    omega

/-- Com `frameH ≥ 1` (garantido ao aterrissar) e `limit ≥ 1`, o ramo da guarda é inalcançável
no modelo inteiro: `shotPx ≥ 1` já vem de `slice_within_page`. -/
theorem guard_unreachable (frameH limit scrollPx : Int) (hf : 1 ≤ frameH) (hl : 1 ≤ limit) :
    ¬ (shotPx frameH limit (offsetPx frameH limit (clampPx scrollPx (maxScrollPx frameH limit))) < 1) := by
  have := slice_within_page frameH limit scrollPx hf hl
  simp only at this
  omega

/-- `paintSlice` usa `max 1 height`: o denominador nunca é zero, qualquer que seja `height`. -/
theorem paintSlice_scale_den_pos (rows ch height : Int) : 0 < (scaleOf rows ch (max 1 height)).den := by
  unfold scaleOf; simp; omega

end Panel.Scroll
