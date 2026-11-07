/-!
Mapeamento do clique (`actionAt` em pane.tsx):
`px = x·cw`, `py = offset + y·ch / scale`, `scale = rows·ch / shotPx`, com `offset` em pixels.
O clique `(X/D, Y/D)` é racional com denominador comum `D > 0`; a aritmética é feita com
racionais exatos (`Q`), seguindo a fórmula do TS sem simplificá-la antes.
-/
namespace Panel.Click

structure Q where
  n : Int
  d : Int

def Q.ofInt (n : Int) : Q := ⟨n, 1⟩
def Q.add (a b : Q) : Q := ⟨a.n * b.d + b.n * a.d, a.d * b.d⟩
def Q.mul (a b : Q) : Q := ⟨a.n * b.n, a.d * b.d⟩
def Q.div (a b : Q) : Q := ⟨a.n * b.d, a.d * b.n⟩
/-- Comparação por produto cruzado; vale para denominadores positivos. -/
def Q.lt (a b : Q) : Prop := a.n * b.d < b.n * a.d
def Q.le (a b : Q) : Prop := a.n * b.d ≤ b.n * a.d

structure Cfg where
  cols : Int
  rows : Int
  cw : Int
  ch : Int
  offset : Int
  shotPx : Int

def Cfg.scale (c : Cfg) : Q := Q.div (Q.ofInt (c.rows * c.ch)) (Q.ofInt c.shotPx)

def mapX (c : Cfg) (x : Q) : Q := Q.mul x (Q.ofInt c.cw)
def mapY (c : Cfg) (y : Q) : Q :=
  Q.add (Q.ofInt c.offset) (Q.div (Q.mul y (Q.ofInt c.ch)) c.scale)

def Cfg.pageWidth (c : Cfg) : Int := c.cols * c.cw

theorem mapX_in_page (c : Cfg) (X D : Int)
    (hD : 0 < D) (hcw : 0 < c.cw) (hx0 : 0 ≤ X) (hx1 : X < c.cols * D) :
    (Q.le (Q.ofInt 0) (mapX c ⟨X, D⟩)) ∧ (mapX c ⟨X, D⟩).d > 0 ∧
    Q.lt (mapX c ⟨X, D⟩) (Q.ofInt c.pageWidth) := by
  simp only [mapX, Q.le, Q.lt, Q.mul, Q.ofInt, Cfg.pageWidth]
  refine ⟨?_, by omega, ?_⟩
  · simp; exact Int.mul_nonneg hx0 (by omega)
  · have := Int.mul_lt_mul_of_pos_right hx1 hcw
    rw [Int.mul_one, Int.mul_one, Int.mul_comm c.cols c.cw, Int.mul_assoc c.cw c.cols D, Int.mul_comm c.cw]
    simpa [Int.mul_comm, Int.mul_left_comm] using this

theorem mapY_in_slice (c : Cfg) (Y D : Int)
    (hD : 0 < D) (hch : 0 < c.ch) (hrows : 0 < c.rows) (hs : 0 < c.shotPx)
    (hy0 : 0 ≤ Y) (hy1 : Y < c.rows * D) :
    (mapY c ⟨Y, D⟩).d > 0 ∧
    Q.le (Q.ofInt c.offset) (mapY c ⟨Y, D⟩) ∧
    Q.lt (mapY c ⟨Y, D⟩) (Q.ofInt (c.offset + c.shotPx)) := by
  have hden : 0 < D * (c.rows * c.ch) := Int.mul_pos hD (Int.mul_pos hrows hch)
  have hpos : 0 < c.ch * c.shotPx := Int.mul_pos hch hs
  simp only [mapY, Cfg.scale, Q.add, Q.mul, Q.div, Q.ofInt, Q.le, Q.lt]
  refine ⟨?_, ?_, ?_⟩
  · simpa [Int.mul_one, Int.one_mul] using hden
  · have : 0 ≤ Y * c.ch * c.shotPx := Int.mul_nonneg (Int.mul_nonneg hy0 (by omega)) (by omega)
    simp only [Int.mul_one, Int.one_mul]
    omega
  · have h1 : Y * (c.ch * c.shotPx) < (c.rows * D) * (c.ch * c.shotPx) :=
      Int.mul_lt_mul_of_pos_right hy1 hpos
    have e1 : Y * c.ch * c.shotPx = Y * (c.ch * c.shotPx) := Int.mul_assoc _ _ _
    have e2 : c.shotPx * (D * (c.rows * c.ch)) = (c.rows * D) * (c.ch * c.shotPx) := by
      simp [Int.mul_comm, Int.mul_left_comm]
    simp only [Int.mul_one, Int.one_mul]
    rw [Int.add_mul, e2]
    omega


/-- Ligação com a rolagem: o ponto de página de um clique dentro da imagem cai na página
(`mapY < offset + shotPx ≤ frameH`), com o `shotPx` que `slice_within_page` garante. -/
theorem mapY_in_frame (c : Cfg) (Y D frameH : Int)
    (hD : 0 < D) (hch : 0 < c.ch) (hrows : 0 < c.rows) (hs : 0 < c.shotPx)
    (hy0 : 0 ≤ Y) (hy1 : Y < c.rows * D) (hoff : 0 ≤ c.offset) (hin : c.offset + c.shotPx ≤ frameH) :
    Q.le (Q.ofInt 0) (mapY c ⟨Y, D⟩) ∧ Q.lt (mapY c ⟨Y, D⟩) (Q.ofInt frameH) := by
  obtain ⟨hd, h1, h2⟩ := mapY_in_slice c Y D hD hch hrows hs hy0 hy1
  simp only [Q.le, Q.lt, Q.ofInt] at *
  have hpos : 0 < (mapY c ⟨Y, D⟩).d := hd
  constructor
  · have : 0 ≤ c.offset * (mapY c ⟨Y, D⟩).d := Int.mul_nonneg hoff (Int.le_of_lt hpos)
    omega
  · have : (c.offset + c.shotPx) * (mapY c ⟨Y, D⟩).d ≤ frameH * (mapY c ⟨Y, D⟩).d :=
      Int.mul_le_mul_of_nonneg_right hin (Int.le_of_lt hpos)
    omega

end Panel.Click
