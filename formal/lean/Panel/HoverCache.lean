/-!
Cache de quadros destacados (hooks/hover.ts). O `Map` do JS é uma lista de pares na ordem de
inserção; `frameFor` faz `if (size >= FRAMES_MAX) delete(primeira chave)` e depois `set`.
`set` em chave existente troca o valor sem mudar a posição.
A chave do TS é a string `${view.key}|${y}|${act}`.
-/
namespace Panel.HoverCache

def FRAMES_MAX : Nat := 48

abbrev Key := List Char
abbrev Cache := List (Key × String)

def lookup : Cache → Key → Option String
  | [], _ => none
  | e :: t, k => if e.1 = k then some e.2 else lookup t k

def keys (c : Cache) : List Key := c.map (·.1)

/-- `Map.set`: troca no lugar se a chave existe, senão acrescenta no fim. -/
def set : Cache → Key → String → Cache
  | [], k, v => [(k, v)]
  | e :: t, k, v => if e.1 = k then (k, v) :: t else e :: set t k v

theorem set_length_le (c : Cache) (k : Key) (v : String) : (set c k v).length ≤ c.length + 1 := by
  induction c with
  | nil => simp [set]
  | cons e t ih =>
    unfold set
    split
    · simp
    · simp only [List.length_cons]; omega

/-- O trecho de `frameFor`: despeja a chave mais antiga quando cheio, depois insere. -/
def put (c : Cache) (k : Key) (v : String) : Cache :=
  set (if FRAMES_MAX ≤ c.length then c.tail else c) k v

/-- Nunca excede o teto. -/
theorem put_length_le (c : Cache) (k : Key) (v : String) (h : c.length ≤ FRAMES_MAX) :
    (put c k v).length ≤ FRAMES_MAX := by
  unfold put
  have := set_length_le (if FRAMES_MAX ≤ c.length then c.tail else c) k v
  by_cases hf : FRAMES_MAX ≤ c.length
  · simp only [hf, ite_true, List.length_tail] at this ⊢
    unfold FRAMES_MAX at *
    omega
  · simp only [hf, ite_false] at this ⊢
    unfold FRAMES_MAX at *
    omega

/-- Operações do módulo: inserir ou esvaziar (`forgetFrames`/`resetHover`). -/
inductive Op where
  | put (k : Key) (v : String)
  | clear

def apply (c : Cache) : Op → Cache
  | .put k v => put c k v
  | .clear => []

def run (ops : List Op) : Cache := ops.foldl apply []

theorem apply_length_le (c : Cache) (o : Op) (h : c.length ≤ FRAMES_MAX) :
    (apply c o).length ≤ FRAMES_MAX := by
  cases o with
  | put k v => exact put_length_le c k v h
  | clear => simp [apply, FRAMES_MAX]

theorem foldl_length_le (ops : List Op) :
    ∀ c : Cache, c.length ≤ FRAMES_MAX → (ops.foldl apply c).length ≤ FRAMES_MAX := by
  induction ops with
  | nil => intro c h; exact h
  | cons o t ih => intro c h; exact ih _ (apply_length_le c o h)

/-- Em qualquer sequência de operações o cache tem no máximo 48 quadros. -/
theorem run_length_le (ops : List Op) : (run ops).length ≤ FRAMES_MAX :=
  foldl_length_le ops [] (by simp [FRAMES_MAX])

theorem set_entries (c : Cache) (k : Key) (v : String) :
    ∀ e ∈ set c k v, e ∈ c ∨ e = (k, v) := by
  induction c with
  | nil => intro e h; simp [set] at h; exact Or.inr h
  | cons x t ih =>
    intro e h
    unfold set at h
    by_cases hx : x.1 = k
    · simp only [hx, ite_true, List.mem_cons] at h
      rcases h with h | h
      · exact Or.inr h
      · exact Or.inl (List.mem_cons_of_mem _ h)
    · simp only [hx, ite_false, List.mem_cons] at h
      rcases h with h | h
      · exact Or.inl (by simp [h])
      · rcases ih e h with h | h
        · exact Or.inl (List.mem_cons_of_mem _ h)
        · exact Or.inr h

theorem set_entries_keys (c : Cache) (k : Key) (v : String) :
    ∀ x ∈ keys (set c k v), x ∈ keys c ∨ x = k := by
  intro x hx
  simp only [keys, List.mem_map] at hx ⊢
  obtain ⟨e, he, rfl⟩ := hx
  rcases set_entries c k v e he with h | h
  · exact Or.inl ⟨e, h, rfl⟩
  · exact Or.inr (by rw [h])

theorem lookup_set_self (c : Cache) (k : Key) (v : String) : lookup (set c k v) k = some v := by
  induction c with
  | nil => simp [set, lookup]
  | cons e t ih =>
    unfold set
    by_cases he : e.1 = k
    · simp [he, lookup]
    · simp only [he, ite_false, lookup]
      exact ih

/-- Chaves únicas (um `Map`). -/
theorem set_keys_nodup (c : Cache) (k : Key) (v : String) (h : (keys c).Nodup) :
    (keys (set c k v)).Nodup := by
  induction c with
  | nil => simp [set, keys]
  | cons e t ih =>
    unfold set
    by_cases he : e.1 = k
    · simp only [he, ite_true]
      simp only [keys, List.map_cons, List.nodup_cons] at *
      refine ⟨?_, h.2⟩
      subst he
      exact h.1
    · simp only [he, ite_false]
      simp only [keys, List.map_cons, List.nodup_cons] at *
      refine ⟨?_, ih h.2⟩
      intro hm
      have : e.1 ∈ keys t ∨ e.1 = k := by
        have := set_entries_keys t k v e.1
        simp only [keys] at this
        exact this hm
      rcases this with m | m
      · exact h.1 m
      · exact he m

theorem put_entries (c : Cache) (k : Key) (v : String) :
    ∀ e ∈ put c k v, e ∈ c ∨ e = (k, v) := by
  intro e he
  unfold put at he
  rcases set_entries _ k v e he with h | h
  · left
    split at h
    · exact List.mem_of_mem_tail h
    · exact h
  · exact Or.inr h

theorem foldl_entries (ops : List Op) :
    ∀ (c : Cache) (e : Key × String), e ∈ ops.foldl apply c →
      e ∈ c ∨ ∃ k v, Op.put k v ∈ ops ∧ e = (k, v) := by
  induction ops with
  | nil => intro c e h; exact Or.inl h
  | cons o t ih =>
    intro c e h
    simp only [List.foldl_cons] at h
    rcases ih _ e h with h1 | ⟨k, v, hm, he⟩
    · cases o with
      | clear => simp [apply] at h1
      | put k v =>
        rcases put_entries c k v e h1 with h2 | h2
        · exact Or.inl h2
        · exact Or.inr ⟨k, v, by simp, h2⟩
    · exact Or.inr ⟨k, v, List.mem_cons_of_mem _ hm, he⟩

theorem run_entries (ops : List Op) (e : Key × String) (h : e ∈ run ops) :
    ∃ k v, Op.put k v ∈ ops ∧ e = (k, v) := by
  rcases foldl_entries ops [] e h with h | h
  · simp at h
  · exact h

theorem put_keys_nodup (c : Cache) (k : Key) (v : String) (h : (keys c).Nodup) :
    (keys (put c k v)).Nodup := by
  unfold put
  apply set_keys_nodup
  by_cases hf : FRAMES_MAX ≤ c.length
  · simp only [hf, ite_true]
    cases c with
    | nil => simpa using h
    | cons e t => simp only [keys, List.map_cons, List.nodup_cons, List.tail_cons] at h ⊢; exact h.2
  · simp only [hf, ite_false]; exact h

theorem lookup_mem (c : Cache) (k : Key) (v : String) (h : lookup c k = some v) : (k, v) ∈ c := by
  induction c with
  | nil => simp [lookup] at h
  | cons e t ih =>
    unfold lookup at h
    by_cases he : e.1 = k
    · simp only [he, ite_true, Option.some.injEq] at h
      rw [← h, ← he]; simp
    · simp only [he, ite_false] at h
      exact List.mem_cons_of_mem _ (ih h)

/-- `lookup` só devolve valor inserido com exatamente aquela chave. -/
theorem lookup_inserted (ops : List Op) (k : Key) (v : String) (h : lookup (run ops) k = some v) :
    Op.put k v ∈ ops := by
  obtain ⟨k', v', hmem, he⟩ := run_entries ops _ (lookup_mem _ _ _ h)
  simp only [Prod.mk.injEq] at he
  obtain ⟨h1, h2⟩ := he
  subst h1; subst h2
  exact hmem

theorem lookup_put_self (c : Cache) (k : Key) (v : String) : lookup (put c k v) k = some v :=
  lookup_set_self _ k v

/-- FIFO: cheio e chave nova, a mais antiga sai e a nova entra no fim. -/
theorem put_full_new (c : Cache) (k : Key) (v : String) (hf : FRAMES_MAX ≤ c.length)
    (hk : k ∉ keys c.tail) : put c k v = c.tail ++ [(k, v)] := by
  have hfk : ∀ (d : Cache), k ∉ keys d → set d k v = d ++ [(k, v)] := by
    intro d
    induction d with
    | nil => intro _; rfl
    | cons e t ih =>
      intro hn
      simp only [keys, List.map_cons, List.mem_cons, not_or] at hn
      have hne : ¬ e.1 = k := fun h => hn.1 h.symm
      unfold set
      simp only [hne, ite_false, List.cons_append]
      rw [ih hn.2]
  unfold put
  simp only [hf, ite_true]
  exact hfk _ hk

/-! ### A chave da string -/

/-- Representação textual de `y` em JS: não tem `|` e é injetiva (hipóteses). -/
structure NumText where
  show' : Int → List Char
  inj : ∀ a b, show' a = show' b → a = b
  noBar : ∀ y, '|' ∉ show' y

def frameKey (T : NumText) (pk : List Char) (y : Int) (act : List Char) : Key :=
  pk ++ '|' :: (T.show' y ++ '|' :: act)

theorem split_bar (u u' a a' : List Char) (hu : '|' ∉ u) (hu' : '|' ∉ u')
    (e : u ++ '|' :: a = u' ++ '|' :: a') : u = u' ∧ a = a' := by
  induction u generalizing u' with
  | nil =>
    cases u' with
    | nil => simp at e; exact ⟨rfl, e⟩
    | cons c t => simp at e; exact absurd e.1.symm (fun h => hu' (by simp [h]))
  | cons c t ih =>
    cases u' with
    | nil => simp at e; exact absurd e.1 (fun h => hu (by simp [h]))
    | cons c' t' =>
      simp only [List.cons_append, List.cons.injEq] at e
      obtain ⟨h1, h2⟩ := e
      subst h1
      have := ih t' (fun m => hu (List.mem_cons_of_mem _ m)) (fun m => hu' (List.mem_cons_of_mem _ m)) h2
      exact ⟨by rw [this.1], this.2⟩

/-- As chaves das páginas desenhadas não são prefixo uma da outra
(cada uma termina em `</html>`, que só aparece no fim porque o texto do usuário passa por `esc`). -/
def PrefixFree (S : List Char → Prop) : Prop :=
  ∀ a b, S a → S b → a <+: b → a = b

/-- A chave distingue `(chave da página, y, ato)`. -/
theorem frameKey_injective (T : NumText) (S : List Char → Prop) (hS : PrefixFree S)
    {k k' : List Char} (hk : S k) (hk' : S k') {y y' : Int} {a a' : List Char}
    (e : frameKey T k y a = frameKey T k' y' a') : k = k' ∧ y = y' ∧ a = a' := by
  unfold frameKey at e
  have p1 : k <+: k ++ ('|' :: (T.show' y ++ '|' :: a)) := List.prefix_append _ _
  have p2 : k' <+: k ++ ('|' :: (T.show' y ++ '|' :: a)) := by
    rw [e]; exact List.prefix_append _ _
  have kk : k = k' := by
    rcases List.prefix_or_prefix_of_prefix p1 p2 with h | h
    · exact hS _ _ hk hk' h
    · exact (hS _ _ hk' hk h).symm
  subst kk
  have e1 := List.append_cancel_left e
  simp only [List.cons.injEq, true_and] at e1
  have := split_bar _ _ _ _ (T.noBar y) (T.noBar y') e1
  exact ⟨rfl, T.inj _ _ this.1, this.2⟩

/-- Um quadro de outra página, de outro `y` ou de outro ato nunca é devolvido:
se a busca por `(k, y, a)` acha `v`, então `v` foi inserido exatamente para `(k, y, a)`. -/
theorem lookup_same_view (T : NumText) (S : List Char → Prop) (hS : PrefixFree S)
    (ins : List (List Char × Int × List Char × String))
    (hIns : ∀ i ∈ ins, S i.1)
    {k : List Char} (hk : S k) {y : Int} {a : List Char} {v : String}
    (h : lookup (run (ins.map fun i => Op.put (frameKey T i.1 i.2.1 i.2.2.1) i.2.2.2))
            (frameKey T k y a) = some v) :
    (k, y, a, v) ∈ ins := by
  have m := lookup_inserted _ _ _ h
  rw [List.mem_map] at m
  obtain ⟨i, hi, e⟩ := m
  simp only [Op.put.injEq] at e
  obtain ⟨e1, e2⟩ := e
  obtain ⟨r1, r2, r3⟩ := frameKey_injective T S hS (hIns i hi) hk e1
  obtain ⟨pk, y0, a0, v0⟩ := i
  simp only at r1 r2 r3 e2
  subst r1; subst r2; subst r3; subst e2
  exact hi

end Panel.HoverCache
