/-!
Grade de pixels da imagem (`gridOf` e os cortes de 255 em hooks/pane.tsx).
`Math.round(c * sqrt(MAX_PIXELS / area))` é feito sem raiz real: para `n ≥ 1`,
`n ≤ c·√(M/A) + 1/2  ⇔  (2n-1)² ≤ 4c²M/A  ⇔  2n-1 ≤ ⌊√⌊4c²M/A⌋⌋`, logo
`round = (Nat.sqrt ⌊4c²M/A⌋ + 1) / 2`. O `min c` é matematicamente redundante com `area > M`
(o arredondado nunca passa de `c`); fica no modelo porque o núcleo do Lean não traz lemas de
`Nat.sqrt`, e o teste de conformidade confere a igualdade com o `gridOf` real em todas as
combinações. Vale para células inteiras (o padrão 13×28).
-/
namespace Panel.Grid

def MAX_PIXELS : Nat := 1500000
def IMAGE_CELLS_MAX : Nat := 255

def roundScaled (c area : Nat) : Nat :=
  min c ((Nat.sqrt ((4 * c * c * MAX_PIXELS) / area) + 1) / 2)

def areaOf (cw ch cols rows : Nat) : Nat := cols * cw * max 1 rows * ch

/-- `(w, h)` da grade; `area ≤ MAX_PIXELS` é `k = 1`. -/
def gridOf (cw ch cols rows : Nat) : Nat × Nat :=
  if areaOf cw ch cols rows ≤ MAX_PIXELS then (max 4 cw, max 8 ch)
  else (max 4 (roundScaled cw (areaOf cw ch cols rows)), max 8 (roundScaled ch (areaOf cw ch cols rows)))

def pixels (cw ch cols rows : Nat) : Nat :=
  cols * (gridOf cw ch cols rows).1 * (rows * (gridOf cw ch cols rows).2)

theorem w_ge_four (cw ch cols rows : Nat) : 4 ≤ (gridOf cw ch cols rows).1 := by
  unfold gridOf; split <;> simp [Nat.le_max_left]

theorem h_ge_eight (cw ch cols rows : Nat) : 8 ≤ (gridOf cw ch cols rows).2 := by
  unfold gridOf; split <;> simp [Nat.le_max_left]

theorem roundScaled_le (c area : Nat) : roundScaled c area ≤ c := by
  unfold roundScaled; omega

/-- `k ≤ 1`: a grade nunca é maior que a célula cheia (salvo o piso de 4 × 8). -/
theorem grid_le_cell (cw ch cols rows : Nat) :
    (gridOf cw ch cols rows).1 ≤ max 4 cw ∧ (gridOf cw ch cols rows).2 ≤ max 8 ch := by
  unfold gridOf
  split
  · simp
  · have a := roundScaled_le cw (areaOf cw ch cols rows)
    have b := roundScaled_le ch (areaOf cw ch cols rows)
    constructor <;> simp <;> omega

/-! ### Cortes de 255 da imagem -/

def columnsOf (bodyColumns : Nat) : Nat := min IMAGE_CELLS_MAX bodyColumns
def bodyRowsOf (rows : Nat) : Nat := min IMAGE_CELLS_MAX (max 1 rows)
def imageRows (shot h : Nat) : Nat := min IMAGE_CELLS_MAX (max 1 ((shot + h - 1) / h))

theorem columns_le (n : Nat) : columnsOf n ≤ 255 := by unfold columnsOf IMAGE_CELLS_MAX; omega
theorem bodyRows_bounds (n : Nat) : 1 ≤ bodyRowsOf n ∧ bodyRowsOf n ≤ 255 := by
  unfold bodyRowsOf IMAGE_CELLS_MAX; omega
theorem imageRows_le (shot h : Nat) : imageRows shot h ≤ 255 := by unfold imageRows IMAGE_CELLS_MAX; omega

/-- A fatia nunca precisa de mais linhas que o corpo (o `min 255` final é só cinto). -/
theorem ceil_le_bodyRows (shot h body : Nat) (hh : 0 < h) (hs : shot ≤ body * h) :
    (shot + h - 1) / h ≤ body := by
  have : (shot + h - 1) / h < body + 1 := by
    rw [Nat.div_lt_iff_lt_mul hh, Nat.add_mul, Nat.one_mul]
    omega
  omega

/-! ### Pixels da imagem com a célula padrão (13 × 28) -/

def allPairs (f : Nat → Nat → Bool) : Bool :=
  (List.range' 1 255).all fun c => (List.range' 1 255).all fun r => f c r

/-- Para toda combinação de colunas e linhas (1 a 255), a imagem não passa de 2 080 800 px
(= 255·255·4·8, o piso da grade). -/
theorem pixels_le_floor_bound :
    allPairs (fun c r => decide (pixels 13 28 c r ≤ 2080800)) = true := by
  decide +kernel

/-- O teto de 1,6 MP não vale nos extremos: com 255 × 255 os pisos 4 × 8 dominam. -/
theorem pixels_255_exceeds_1_6M : pixels 13 28 255 255 = 2080800 ∧ 1600000 < pixels 13 28 255 255 := by
  decide +kernel

/-- Sem os pisos ativos o teto de 1,6 MP vale com folga, por exemplo para 150 × 60 e 100 × 50. -/
theorem pixels_typical : pixels 13 28 150 60 ≤ 1600000 ∧ pixels 13 28 100 50 ≤ 1600000 := by
  decide +kernel

end Panel.Grid
