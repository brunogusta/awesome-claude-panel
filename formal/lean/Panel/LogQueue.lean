/-!
Fila de log em lote (hooks/core/trace.ts). Entradas abstratas (`Nat`); `pushed` conta tudo
que entrou, `delivered` o que foi gravado e `reported` o que o aviso `log-dropped` já contou.
Uma gravação em andamento guarda as linhas e o `dropped` lido antes de zerar (`flush`).
-/
namespace Panel.LogQueue

def QUEUE_MAX : Nat := 400

structure Flight where
  lines : List Nat
  lostBefore : Nat
  wasHeadSent : Bool

structure S where
  queue : List Nat
  dropped : Nat
  headSent : Bool
  flight : Option Flight
  pushed : Nat
  delivered : Nat
  reported : Nat

def init : S := ⟨[], 0, false, none, 0, 0, 0⟩

def push (s : S) (x : Nat) : S :=
  if QUEUE_MAX ≤ s.queue.length then
    { s with queue := s.queue.tail ++ [x], dropped := s.dropped + 1, pushed := s.pushed + 1 }
  else { s with queue := s.queue ++ [x], pushed := s.pushed + 1 }

/-- `flush`: pega a fila e o `dropped`, zera os dois e marca o cabeçalho como enviado. -/
def begin_ (s : S) : S :=
  match s.flight with
  | some _ => s
  | none => { s with queue := [], dropped := 0, headSent := true, flight := some ⟨s.queue, s.dropped, s.headSent⟩ }

def finishOk (s : S) : S :=
  match s.flight with
  | none => s
  | some f => { s with flight := none, delivered := s.delivered + f.lines.length, reported := s.reported + f.lostBefore }

/-- Falha: `queue = [...lines, ...queue].slice(-QUEUE_MAX)`, cabeçalho e `dropped` restaurados. -/
def finishFail (s : S) : S :=
  match s.flight with
  | none => s
  | some f =>
    let merged := f.lines ++ s.queue
    { s with flight := none, queue := merged.drop (merged.length - QUEUE_MAX), headSent := f.wasHeadSent,
             dropped := s.dropped + f.lostBefore }

def inflightCount (s : S) : Nat := match s.flight with | none => 0 | some f => f.lines.length + f.lostBefore

/-- Contabilidade: tudo que entrou foi gravado, está na fila, em voo, ou foi contado como descartado. -/
def Conserved (s : S) : Prop :=
  s.pushed = s.delivered + s.reported + s.queue.length + s.dropped + inflightCount s

def Bounded (s : S) : Prop :=
  s.queue.length ≤ QUEUE_MAX ∧ (∀ f, s.flight = some f → f.lines.length ≤ QUEUE_MAX)

theorem init_ok : Conserved init ∧ Bounded init := by
  simp [Conserved, Bounded, init, inflightCount]

theorem QUEUE_MAX_eq : QUEUE_MAX = 400 := rfl

theorem push_bounded (s : S) (x : Nat) (h : Bounded s) : Bounded (push s x) := by
  obtain ⟨h1, h2⟩ := h
  have e := QUEUE_MAX_eq
  unfold push
  by_cases hq : QUEUE_MAX ≤ s.queue.length
  · simp only [hq, ite_true, Bounded]
    refine ⟨?_, h2⟩
    simp only [List.length_append, List.length_tail, List.length_singleton]
    omega
  · simp only [hq, ite_false, Bounded]
    refine ⟨?_, h2⟩
    simp only [List.length_append, List.length_singleton]
    omega

/-- Cada entrada que entra e a fila cheia descarta a mais antiga e conta em `dropped`. -/
theorem push_conserved (s : S) (x : Nat) (h : Conserved s) : Conserved (push s x) := by
  have e : inflightCount (push s x) = inflightCount s := by unfold push; split <;> rfl
  unfold Conserved at *
  rw [e]
  unfold push
  by_cases hq : QUEUE_MAX ≤ s.queue.length
  · simp only [hq, ite_true, List.length_append, List.length_tail, List.length_singleton]
    have : 0 < s.queue.length := by have := QUEUE_MAX_eq; omega
    omega
  · simp only [hq, ite_false, List.length_append, List.length_singleton]
    omega

theorem begin_bounded (s : S) (h : Bounded s) : Bounded (begin_ s) := by
  obtain ⟨h1, h2⟩ := h
  unfold begin_
  cases hf : s.flight with
  | some f => simp only [hf]; exact ⟨h1, h2⟩
  | none =>
    simp only [hf, Bounded, List.length_nil]
    refine ⟨by omega, ?_⟩
    intro f hf'
    simp only [Option.some.injEq] at hf'
    subst hf'
    exact h1

theorem begin_conserved (s : S) (h : Conserved s) : Conserved (begin_ s) := by
  unfold begin_
  cases hf : s.flight with
  | some f => simp only [hf]; exact h
  | none =>
    unfold Conserved inflightCount at *
    simp only [hf] at *
    simp only [List.length_nil]
    omega

theorem finishOk_bounded (s : S) (h : Bounded s) : Bounded (finishOk s) := by
  obtain ⟨h1, h2⟩ := h
  unfold finishOk
  cases hf : s.flight with
  | none => simp only [hf]; exact ⟨h1, h2⟩
  | some f =>
    simp only [hf, Bounded]
    exact ⟨h1, by intro g hg; simp at hg⟩

theorem finishOk_conserved (s : S) (h : Conserved s) : Conserved (finishOk s) := by
  unfold finishOk
  cases hf : s.flight with
  | none => simp only [hf]; exact h
  | some f =>
    unfold Conserved inflightCount at *
    simp only [hf] at *
    omega

/-- A fila nunca passa de 400, nem depois de uma falha de gravação. -/
theorem finishFail_bounded (s : S) (h : Bounded s) : Bounded (finishFail s) := by
  obtain ⟨h1, h2⟩ := h
  unfold finishFail
  cases hf : s.flight with
  | none => simp only [hf]; exact ⟨h1, h2⟩
  | some f =>
    simp only [hf, Bounded]
    refine ⟨?_, by intro g hg; simp at hg⟩
    simp only [List.length_drop, List.length_append]
    have := QUEUE_MAX_eq
    omega

/-- Sem estouro, a falha devolve todas as linhas e o `dropped`: nada se perde. -/
theorem finishFail_conserved (s : S) (h : Conserved s)
    (fits : ∀ f, s.flight = some f → f.lines.length + s.queue.length ≤ QUEUE_MAX) :
    Conserved (finishFail s) := by
  unfold finishFail
  cases hf : s.flight with
  | none => simp only [hf]; exact h
  | some f =>
    have := fits f hf
    unfold Conserved inflightCount at *
    simp only [hf] at *
    simp only [List.length_drop, List.length_append, inflightCount]
    omega

/-- Falha com estouro: as linhas além de 400 somem sem entrar em `dropped`;
a diferença da contabilidade é exatamente `lines + queue - 400`. -/
theorem finishFail_loss (s : S) (h : Conserved s) (f : Flight) (hf : s.flight = some f) :
    (finishFail s).pushed =
      (finishFail s).delivered + (finishFail s).reported + (finishFail s).queue.length + (finishFail s).dropped
        + (f.lines.length + s.queue.length - QUEUE_MAX) := by
  unfold finishFail Conserved inflightCount at *
  simp [hf, QUEUE_MAX] at *
  omega

/-- Contraexemplo concreto: 400 na fila, uma gravação em voo, 300 novas e a gravação falha. -/
theorem overflow_counterexample :
    let s0 := (List.range 400).foldl push init
    let s1 := begin_ s0
    let s2 := (List.range 300).foldl push s1
    let s3 := finishFail s2
    s3.pushed = 700 ∧ s3.queue.length = 400 ∧ s3.dropped = 0 ∧ s3.delivered = 0 ∧ s3.reported = 0 := by
  decide +kernel

end Panel.LogQueue
