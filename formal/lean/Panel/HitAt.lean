/-!
Modelo de `hitAt` e `hitIn` (hooks/actions.ts). Coordenadas em `Int`.
Os dois são o mesmo laço: varrer a lista e guardar o primeiro candidato de menor área.
`pick p` é esse laço para um predicado `p` qualquer; `hitAt` usa "contém o ponto" e
`hitIn` usa "sobrepõe a célula em pelo menos 30% do menor dos dois".
-/
namespace Panel.HitAt

structure Hit where
  act : String
  x : Int
  y : Int
  w : Int
  h : Int
  deriving DecidableEq, Repr

def Hit.area (r : Hit) : Int := r.w * r.h

def Hit.contains (r : Hit) (px py : Int) : Prop :=
  r.x ≤ px ∧ px < r.x + r.w ∧ r.y ≤ py ∧ py < r.y + r.h

instance (r : Hit) (px py : Int) : Decidable (r.contains px py) := by
  unfold Hit.contains; infer_instance

section Pick
variable (p : Hit → Prop) [DecidablePred p]

def step (best : Option Hit) (r : Hit) : Option Hit :=
  if p r then
    match best with
    | none => some r
    | some b => if r.area < b.area then some r else some b
  else best

def pick (hits : List Hit) : Option Hit := hits.foldl (step p) none

theorem step_cases {best : Option Hit} {h r : Hit} (e : step p best h = some r) :
    best = some r ∨ (r = h ∧ p h) := by
  unfold step at e
  by_cases hc : p h
  · simp only [hc, ite_true] at e
    cases best with
    | none => simp at e; exact Or.inr ⟨e.symm, hc⟩
    | some b =>
      simp only at e
      split at e
      · simp at e; exact Or.inr ⟨e.symm, hc⟩
      · simp at e; exact Or.inl (by simp [e])
  · simp only [hc, ite_false] at e
    exact Or.inl e

theorem step_keep {best : Option Hit} {h : Hit} (hc : ¬ p h) : step p best h = best := by
  unfold step; simp [hc]

theorem step_some {best : Option Hit} {h : Hit} (hc : p h) : ∃ s, step p best h = some s := by
  unfold step
  simp only [hc, ite_true]
  cases best with
  | none => simp
  | some b => simp only; split <;> simp

theorem step_area {best : Option Hit} {h r : Hit} (e : step p best h = some r) (hc : p h) :
    r.area ≤ h.area ∧ ∀ b, best = some b → r.area ≤ b.area := by
  unfold step at e
  simp only [hc, ite_true] at e
  cases best with
  | none => simp at e; subst e; exact ⟨Int.le_refl _, by simp⟩
  | some b =>
    simp only at e
    split at e
    · rename_i lt
      simp at e; subst e
      refine ⟨Int.le_refl _, ?_⟩
      intro b' hb; simp at hb; subst hb; exact Int.le_of_lt lt
    · rename_i nlt
      simp at e; subst e
      refine ⟨by omega, ?_⟩
      intro b' hb; simp at hb; subst hb; exact Int.le_refl _

theorem fold_sound :
    ∀ (hits : List Hit) (best : Option Hit) (r : Hit),
      hits.foldl (step p) best = some r → best = some r ∨ (r ∈ hits ∧ p r) := by
  intro hits
  induction hits with
  | nil => intro best r e; exact Or.inl e
  | cons h t ih =>
    intro best r e
    simp only [List.foldl_cons] at e
    rcases ih _ _ e with e1 | ⟨m, c⟩
    · rcases step_cases p e1 with e2 | ⟨rh, hc⟩
      · exact Or.inl e2
      · subst rh; exact Or.inr ⟨by simp, hc⟩
    · exact Or.inr ⟨List.mem_cons_of_mem _ m, c⟩

/-- Só devolve elemento da lista que satisfaz o predicado. -/
theorem pick_sound {hits : List Hit} {r : Hit} (e : pick p hits = some r) : r ∈ hits ∧ p r := by
  rcases fold_sound p hits none r e with h | h
  · simp at h
  · exact h

theorem fold_min :
    ∀ (hits : List Hit) (best : Option Hit) (r : Hit),
      hits.foldl (step p) best = some r →
      (∀ b, best = some b → r.area ≤ b.area) ∧ (∀ h ∈ hits, p h → r.area ≤ h.area) := by
  intro hits
  induction hits with
  | nil =>
    intro best r e
    simp only [List.foldl_nil] at e
    refine ⟨?_, by simp⟩
    intro b hb; rw [e] at hb; simp at hb; subst hb; exact Int.le_refl _
  | cons h t ih =>
    intro best r e
    simp only [List.foldl_cons] at e
    obtain ⟨i1, i2⟩ := ih _ _ e
    constructor
    · intro b hb
      by_cases hc : p h
      · obtain ⟨s, hs⟩ := step_some p (best := best) hc
        have := (step_area p hs hc).2 b hb
        rw [hs] at i1
        have := i1 s rfl
        omega
      · rw [step_keep p hc] at i1; exact i1 b hb
    · intro k hk kc
      rcases List.mem_cons.mp hk with rfl | hk
      · obtain ⟨s, hs⟩ := step_some p (best := best) kc
        have := (step_area p hs kc).1
        rw [hs] at i1
        have := i1 s rfl
        omega
      · exact i2 k hk kc

/-- Menor área: nenhum candidato da lista tem área menor que a do vencedor. -/
theorem pick_minimal {hits : List Hit} {r : Hit} (e : pick p hits = some r) :
    ∀ h ∈ hits, p h → r.area ≤ h.area :=
  (fold_min p hits none r e).2

theorem fold_nonempty :
    ∀ (hits : List Hit) (best : Option Hit),
      (best ≠ none ∨ ∃ h ∈ hits, p h) → hits.foldl (step p) best ≠ none := by
  intro hits
  induction hits with
  | nil => intro best h; simpa using h
  | cons h t ih =>
    intro best hyp
    simp only [List.foldl_cons]
    apply ih
    by_cases hc : p h
    · obtain ⟨s, hs⟩ := step_some p (best := best) hc
      left; rw [hs]; simp
    · rcases hyp with hb | ⟨k, hk, kc⟩
      · left; rw [step_keep p hc]; exact hb
      · rcases List.mem_cons.mp hk with rfl | hk
        · exact absurd kc hc
        · right; exact ⟨k, hk, kc⟩

/-- Completo: havendo candidato, o resultado não é `none`. -/
theorem pick_complete {hits : List Hit} (h : ∃ r ∈ hits, p r) : pick p hits ≠ none :=
  fold_nonempty p hits none (Or.inr h)

theorem fold_tie_stays (r : Hit) :
    ∀ (post : List Hit),
      (∀ h ∈ post, p h → r.area ≤ h.area) → post.foldl (step p) (some r) = some r := by
  intro post
  induction post with
  | nil => intro _; rfl
  | cons h t ih =>
    intro hyp
    simp only [List.foldl_cons]
    have : step p (some r) h = some r := by
      unfold step
      by_cases hc : p h
      · have := hyp h (by simp) hc
        simp only [hc, ite_true]
        have : ¬ h.area < r.area := by omega
        simp [this]
      · simp [hc]
    rw [this]
    exact ih (fun k hk => hyp k (List.mem_cons_of_mem _ hk))

/-- Empate: o primeiro de área mínima ganha. -/
theorem pick_first_of_ties {pre post : List Hit} {r : Hit}
    (rc : p r)
    (hpre : ∀ h ∈ pre, p h → r.area < h.area)
    (hpost : ∀ h ∈ post, p h → r.area ≤ h.area) :
    pick p (pre ++ r :: post) = some r := by
  unfold pick
  rw [List.foldl_append, List.foldl_cons]
  have acc : ∀ b, pre.foldl (step p) none = some b → r.area < b.area := by
    intro b e
    obtain ⟨m, c⟩ := (fold_sound p pre none b e).resolve_left (by simp)
    exact hpre b m c
  have key : ∀ acc : Option Hit, (∀ b, acc = some b → r.area < b.area) →
      step p acc r = some r := by
    intro acc h
    unfold step
    simp only [rc, ite_true]
    cases acc with
    | none => rfl
    | some b => have := h b rfl; simp [this]
  rw [key _ acc]
  exact fold_tie_stays p r post hpost

theorem fold_congr (p q : Hit → Prop) [DecidablePred p] [DecidablePred q] (hits : List Hit)
    (hpq : ∀ h ∈ hits, (p h ↔ q h)) :
    ∀ best, hits.foldl (step p) best = hits.foldl (step q) best := by
  induction hits with
  | nil => intro best; rfl
  | cons h t ih =>
    intro best
    simp only [List.foldl_cons]
    have e : step p best h = step q best h := by
      unfold step
      by_cases hc : p h
      · have hq : q h := (hpq h (by simp)).mp hc
        simp [hc, hq]
      · have hq : ¬ q h := fun x => hc ((hpq h (by simp)).mpr x)
        simp [hc, hq]
    rw [e]
    exact ih (fun k hk => hpq k (List.mem_cons_of_mem _ hk)) _

/-- Dois predicados que concordam na lista dão o mesmo vencedor. -/
theorem pick_congr (q : Hit → Prop) [DecidablePred q] {hits : List Hit}
    (hpq : ∀ h ∈ hits, (p h ↔ q h)) : pick p hits = pick q hits :=
  fold_congr p q hits hpq none

end Pick

/-! ### `hitAt` -/

def bestOf (hits : List Hit) (px py : Int) : Option Hit := pick (fun r => r.contains px py) hits

def hitAt (hits : List Hit) (px py : Int) : Option String := (bestOf hits px py).map Hit.act

theorem bestOf_sound {hits : List Hit} {px py : Int} {r : Hit}
    (e : bestOf hits px py = some r) : r ∈ hits ∧ r.contains px py :=
  pick_sound _ e

theorem bestOf_minimal {hits : List Hit} {px py : Int} {r : Hit}
    (e : bestOf hits px py = some r) :
    ∀ h ∈ hits, h.contains px py → r.area ≤ h.area :=
  pick_minimal _ e

theorem bestOf_complete {hits : List Hit} {px py : Int}
    (h : ∃ r ∈ hits, r.contains px py) : bestOf hits px py ≠ none :=
  pick_complete _ h

theorem hitAt_complete {hits : List Hit} {px py : Int}
    (h : ∃ r ∈ hits, r.contains px py) : hitAt hits px py ≠ none := by
  unfold hitAt
  intro e
  apply bestOf_complete h
  cases hb : bestOf hits px py with
  | none => rfl
  | some r => rw [hb] at e; simp at e

theorem hitAt_sound {hits : List Hit} {px py : Int} {a : String}
    (e : hitAt hits px py = some a) :
    ∃ r ∈ hits, r.act = a ∧ r.contains px py := by
  unfold hitAt at e
  cases hb : bestOf hits px py with
  | none => rw [hb] at e; simp at e
  | some r =>
    rw [hb] at e; simp at e
    obtain ⟨m, c⟩ := bestOf_sound hb
    exact ⟨r, m, e, c⟩

theorem hitAt_none_iff {hits : List Hit} {px py : Int} :
    hitAt hits px py = none ↔ ∀ r ∈ hits, ¬ r.contains px py := by
  constructor
  · intro e r hr hc
    exact hitAt_complete ⟨r, hr, hc⟩ e
  · intro h
    unfold hitAt
    cases hb : bestOf hits px py with
    | none => rfl
    | some r => exact absurd (bestOf_sound hb).2 (h r (bestOf_sound hb).1)

def Nested (b r : Hit) : Prop :=
  r.x ≤ b.x ∧ b.x + b.w ≤ r.x + r.w ∧ r.y ≤ b.y ∧ b.y + b.h ≤ r.y + r.h

theorem nested_area_lt {b r : Hit} (n : Nested b r)
    (bw : 0 < b.w) (bh : 0 < b.h) (strict : b.w < r.w ∨ b.h < r.h) :
    b.area < r.area := by
  unfold Hit.area
  obtain ⟨n1, n2, n3, n4⟩ := n
  have w : b.w ≤ r.w := by omega
  have h : b.h ≤ r.h := by omega
  rcases strict with s | s
  · calc b.w * b.h < r.w * b.h := Int.mul_lt_mul_of_pos_right s bh
      _ ≤ r.w * r.h := Int.mul_le_mul_of_nonneg_left h (by omega)
  · calc b.w * b.h ≤ r.w * b.h := Int.mul_le_mul_of_nonneg_right w (by omega)
      _ < r.w * r.h := Int.mul_lt_mul_of_pos_left s (by omega)

/-- Um botão aninhado numa linha ganha da linha. -/
theorem nested_button_wins {hits : List Hit} {px py : Int} {b r : Hit}
    (hb : b ∈ hits) (hr : r ∈ hits) (pt : b.contains px py)
    (n : Nested b r) (bw : 0 < b.w) (bh : 0 < b.h) (strict : b.w < r.w ∨ b.h < r.h) :
    ∃ w, bestOf hits px py = some w ∧ w.area ≤ b.area ∧ w ≠ r := by
  have lt := nested_area_lt n bw bh strict
  have ne : bestOf hits px py ≠ none := bestOf_complete ⟨b, hb, pt⟩
  cases e : bestOf hits px py with
  | none => exact absurd e ne
  | some w =>
    refine ⟨w, rfl, bestOf_minimal e b hb pt, ?_⟩
    intro eq
    subst eq
    have := bestOf_minimal e b hb pt
    omega

theorem bestOf_first_of_ties {pre post : List Hit} {r : Hit} {px py : Int}
    (rc : r.contains px py)
    (hpre : ∀ h ∈ pre, h.contains px py → r.area < h.area)
    (hpost : ∀ h ∈ post, h.contains px py → r.area ≤ h.area) :
    bestOf (pre ++ r :: post) px py = some r :=
  pick_first_of_ties _ rc hpre hpost

/-! ### `hitIn` -/

/-- Célula `[l, r) × [t, b)`. -/
structure Cell where
  l : Int
  t : Int
  r : Int
  b : Int

def Cell.area (c : Cell) : Int := (c.r - c.l) * (c.b - c.t)

def across (c : Cell) (h : Hit) : Int := min c.r (h.x + h.w) - max c.l h.x
def down (c : Cell) (h : Hit) : Int := min c.b (h.y + h.h) - max c.t h.y

/-- `across > 0 && down > 0`: a interseção tem área. -/
def Overlaps (c : Cell) (h : Hit) : Prop := 0 < across c h ∧ 0 < down c h

/-- `overlap / min(areaCélula, areaElemento) ≥ 0.3`, sem divisão: `10·ov ≥ 3·min`. -/
def Qualifies (c : Cell) (h : Hit) : Prop :=
  Overlaps c h ∧ 3 * min c.area h.area ≤ 10 * (across c h * down c h)

instance (c : Cell) (h : Hit) : Decidable (Qualifies c h) := by
  unfold Qualifies Overlaps; infer_instance

def bestIn (hits : List Hit) (c : Cell) : Option Hit := pick (Qualifies c) hits

def hitIn (hits : List Hit) (c : Cell) : Option String := (bestIn hits c).map Hit.act

/-- Só devolve elemento que intersecta a célula com ao menos 30% de sobreposição. -/
theorem bestIn_sound {hits : List Hit} {c : Cell} {r : Hit} (e : bestIn hits c = some r) :
    r ∈ hits ∧ Overlaps c r ∧ 3 * min c.area r.area ≤ 10 * (across c r * down c r) := by
  have := pick_sound _ e
  exact ⟨this.1, this.2.1, this.2.2⟩

/-- Vizinho que só encosta (interseção sem área) nunca é devolvido. -/
theorem touching_never_returned {hits : List Hit} {c : Cell} {h : Hit}
    (t : across c h ≤ 0 ∨ down c h ≤ 0) : bestIn hits c ≠ some h := by
  intro e
  have := (bestIn_sound e).2.1
  unfold Overlaps at this
  omega

/-- Sobreposição abaixo de 30% do menor dos dois nunca é devolvida. -/
theorem weak_overlap_never_returned {hits : List Hit} {c : Cell} {h : Hit}
    (t : 10 * (across c h * down c h) < 3 * min c.area h.area) : bestIn hits c ≠ some h := by
  intro e
  have := (bestIn_sound e).2.2
  omega

theorem bestIn_minimal {hits : List Hit} {c : Cell} {r : Hit} (e : bestIn hits c = some r) :
    ∀ h ∈ hits, Qualifies c h → r.area ≤ h.area :=
  pick_minimal _ e

theorem bestIn_complete {hits : List Hit} {c : Cell} (h : ∃ r ∈ hits, Qualifies c r) :
    bestIn hits c ≠ none :=
  pick_complete _ h

theorem bestIn_first_of_ties {pre post : List Hit} {r : Hit} {c : Cell}
    (rc : Qualifies c r)
    (hpre : ∀ h ∈ pre, Qualifies c h → r.area < h.area)
    (hpost : ∀ h ∈ post, Qualifies c h → r.area ≤ h.area) :
    bestIn (pre ++ r :: post) c = some r :=
  pick_first_of_ties _ rc hpre hpost

/-- Elemento com largura e altura positivas que contém a célula inteira a qualifica. -/
theorem covering_qualifies {c : Cell} {h : Hit}
    (cw : 0 < c.r - c.l) (ch : 0 < c.b - c.t) (_hw : 0 < h.w) (_hh : 0 < h.h)
    (x1 : h.x ≤ c.l) (x2 : c.r ≤ h.x + h.w) (y1 : h.y ≤ c.t) (y2 : c.b ≤ h.y + h.h) :
    Qualifies c h := by
  have a1 : across c h = c.r - c.l := by unfold across; omega
  have a2 : down c h = c.b - c.t := by unfold down; omega
  refine ⟨⟨by omega, by omega⟩, ?_⟩
  rw [a1, a2]
  have : min c.area h.area ≤ c.area := Int.min_le_left _ _
  unfold Cell.area at *
  have p : 0 < (c.r - c.l) * (c.b - c.t) := Int.mul_pos cw ch
  omega

/-- Célula não cortada pelas bordas: cada elemento ou fica fora dela ou a cobre inteira. -/
def Uncut (c : Cell) (h : Hit) : Prop :=
  (across c h ≤ 0 ∨ down c h ≤ 0) ∨
  (0 < h.w ∧ 0 < h.h ∧ h.x ≤ c.l ∧ c.r ≤ h.x + h.w ∧ h.y ≤ c.t ∧ c.b ≤ h.y + h.h)

theorem uncut_equiv {c : Cell} {h : Hit} {px py : Int}
    (cw : 0 < c.r - c.l) (ch : 0 < c.b - c.t)
    (pin : c.l ≤ px ∧ px < c.r ∧ c.t ≤ py ∧ py < c.b)
    (u : Uncut c h) : Qualifies c h ↔ h.contains px py := by
  unfold Hit.contains
  constructor
  · intro q
    have q1 := q.1
    unfold Overlaps at q1
    rcases u with u | ⟨_, _, _, _, _, _⟩
    · omega
    · omega
  · intro hc
    rcases u with u | ⟨hw, hh, x1, x2, y1, y2⟩
    · unfold across down at u
      omega
    · exact covering_qualifies cw ch hw hh x1 x2 y1 y2

/-- Célula minúscula dentro de um elemento coincide com `hitAt` no ponto:
quando nenhuma borda corta a célula, `hitIn` é exatamente `hitAt`. -/
theorem hitIn_eq_hitAt_of_uncut {hits : List Hit} {c : Cell} {px py : Int}
    (cw : 0 < c.r - c.l) (ch : 0 < c.b - c.t)
    (pin : c.l ≤ px ∧ px < c.r ∧ c.t ≤ py ∧ py < c.b)
    (u : ∀ h ∈ hits, Uncut c h) : hitIn hits c = hitAt hits px py := by
  unfold hitIn hitAt bestIn bestOf
  rw [pick_congr (Qualifies c) (fun r => r.contains px py)]
  intro h hh
  exact uncut_equiv cw ch pin (u h hh)

/-- Na grade de pixels inteiros, a célula de 1×1 nunca é cortada. -/
theorem unit_cell_uncut (px py : Int) (h : Hit) :
    Uncut ⟨px, py, px + 1, py + 1⟩ h := by
  unfold Uncut across down
  simp only
  by_cases hw : 0 < h.w
  · by_cases hh : 0 < h.h
    · by_cases c1 : h.x ≤ px ∧ px + 1 ≤ h.x + h.w ∧ h.y ≤ py ∧ py + 1 ≤ h.y + h.h
      · right; omega
      · left; omega
    · left; omega
  · left; omega

theorem hitIn_unit_cell (hits : List Hit) (px py : Int) :
    hitIn hits ⟨px, py, px + 1, py + 1⟩ = hitAt hits px py :=
  hitIn_eq_hitAt_of_uncut (by show 0 < px + 1 - px; omega) (by show 0 < py + 1 - py; omega) (by simp; omega) (fun h _ => unit_cell_uncut px py h)

end Panel.HitAt
