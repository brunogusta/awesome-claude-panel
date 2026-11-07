---------------------------- MODULE PanelLifecycle ----------------------------
(***************************************************************************)
(* Abstração finita do ciclo de vida do painel: hooks/pane.tsx (desenho,   *)
(* token, cooldown, aviso, rolagem, redimensionamento), hooks/hover.ts     *)
(* (cache de quadros destacados), hooks/render/renderer.ts (servidor,      *)
(* parada ociosa, abortos) e renderer/server.mjs (rev, pools de PNG).      *)
(*                                                                         *)
(* Tempo: tiques discretos que só passam quando nada está em voo           *)
(* (as operações assíncronas levam muito menos que um tique). Todas as     *)
(* idades saturam, então o espaço de estados é finito.                     *)
(*                                                                         *)
(* Bandeiras Fix* ligam a correcao proposta de um defeito achado pelo TLC; *)
(* FixToken=FALSE reproduz o defeito antigo (comparar por chave).          *)
(***************************************************************************)
EXTENDS Integers, Sequences, FiniteSets

CONSTANTS MaxProc, NPg, NSz, NActs,
          MaxChange, MaxResize, MaxDraw, MaxWheel, MaxCrash, MaxAbort, MaxErr, MaxClose, MaxSess, MaxFiles,
          FramesMax, HKeep, Settle, RetryFrame, RetryNoFrame, AbortWin, AbortsMax, IdleTicks,
          MaxScroll, Wheel,
          CanMissChrome, ColdNoWait, HoverOn,
          FixToken, SeparateClipPool, FixHot, ClearOnView, FixClipOnLand, FixViewRev, FixIdle, FixHeldBlit, FixDropView, FixRevServer,
          Nil

Procs == 1..MaxProc
Pgs == 1..NPg
Szs == 1..NSz
Acts == 1..NActs
Max(a, b) == IF a > b THEN a ELSE b
Min(a, b) == IF a < b THEN a ELSE b
Inc(a, cap) == IF a < cap THEN a + 1 ELSE a
Range(s) == {s[i] : i \in DOMAIN s}
FDiv(a, b) == IF a >= 0 THEN a \div b ELSE -((-a + b - 1) \div b)

Tall(pg) == pg = 2
Clamp(v, m) == Min(Max(0, v), Max(0, m))
StepToward(c, t) == LET g == t - c IN IF -3 <= g /\ g <= 3 THEN t ELSE c + FDiv(4 * g + 5, 10)

VARIABLES env, pane, rdr, procs, hov, reqs, reqSeq, nextFile, deleted, screen, ghost

vars == <<env, pane, rdr, procs, hov, reqs, reqSeq, nextFile, deleted, screen, ghost>>

(* env: page, size, open, chromeOk, ptr e contadores dos eventos externos *)
(* pane: estado de hooks/pane.tsx                                         *)
(* rdr: estado de renderer.ts                                             *)
(* procs[p]: um processo servidor (server.mjs)                            *)
(* hov: estado de hover.ts                                                *)

ReqById(id) == CHOOSE r \in reqs : r.id = id
ServerLive == rdr.server # 0 /\ procs[rdr.server].st = "live"
ServerDead == rdr.server # 0 /\ procs[rdr.server].st = "dead"

---------------------------------------------------------------------------
Init ==
  /\ env = [page |-> 1, size |-> 1, open |-> TRUE, chromeOk |-> TRUE, ptr |-> Nil,
            nChange |-> 0, nResize |-> 0, nWheel |-> 0, nCrash |-> 0, nAbort |-> 0, nErr |-> 0,
            nClose |-> 0, nSess |-> 0]
  /\ pane = [landed |-> Nil, inflight |-> Nil, drawCount |-> 0, failAge |-> -1, retryLeft |-> -1,
             isWarned |-> FALSE, toastPend |-> FALSE, toasts |-> 0, needs |-> TRUE, redo |-> FALSE,
             lastSz |-> 0, szAge |-> Settle, settleLeft |-> -1,
             scroll |-> 0, target |-> 0, anim |-> FALSE, slice |-> FALSE, maxScroll |-> 0,
             clipped |-> Nil, clipFailed |-> Nil]
  /\ rdr = [server |-> 0, starting |-> FALSE, latest |-> 0, idle |-> Nil, stopping |-> 0,
            stops |-> {}, stopSeq |-> 0, aborts |-> <<>>, kept |-> {}, nextProc |-> 1,
            launchPend |-> FALSE]
  /\ procs = [p \in Procs |-> [st |-> "none", end |-> "none", rev |-> 0, pg |-> 0, sz |-> 0,
                               wr |-> <<>>, ck |-> <<>>, hv |-> <<>>, q |-> <<>>, ended |-> FALSE,
                               abortable |-> FALSE, keep |-> FALSE]]
  /\ hov = [view |-> Nil, frames |-> <<>>, wanted |-> Nil, shownAct |-> Nil, held |-> FALSE,
            busy |-> FALSE, prefBusy |-> FALSE, prefillOn |-> FALSE]
  /\ reqs = {} /\ reqSeq = 0 /\ nextFile = 1 /\ deleted = {}
  /\ screen = Nil
  /\ ghost = [okTok |-> 0, lostGood |-> FALSE, spurious |-> FALSE, deadShown |-> FALSE,
              wrongHover |-> FALSE, toastWithFrame |-> FALSE, staleRev |-> FALSE,
              drawResizing |-> FALSE, spawnCooling |-> FALSE, cancelled |-> {},
              relaunch |-> <<>>, hotAfterStop |-> FALSE]

---------------------------------------------------------------------------
(* Pedaços reutilizáveis *)

IsCooling(P) ==
  P.failAge >= 0 /\ P.failAge < (IF P.landed # Nil THEN RetryFrame ELSE RetryNoFrame)

Delay(P) == IF P.landed # Nil THEN RetryFrame ELSE RetryNoFrame

\* fail(): cooldown, nova tentativa agendada e aviso (só sem quadro, uma vez)
FailP(P) ==
  [P EXCEPT !.failAge = 0,
            !.retryLeft = IF P.retryLeft = -1 THEN Delay(P) ELSE P.retryLeft,
            !.toastPend = IF ~P.isWarned /\ P.landed = Nil THEN TRUE ELSE P.toastPend,
            !.isWarned = IF ~P.isWarned /\ P.landed = Nil THEN TRUE ELSE P.isWarned,
            !.needs = TRUE]

\* drop(): esquece quadro, desenho em voo, recortes
DropP(P) ==
  [P EXCEPT !.landed = Nil, !.inflight = Nil, !.clipped = Nil, !.clipFailed = Nil, !.slice = FALSE]

DropGhost(G) ==
  [G EXCEPT !.cancelled = @ \cup (IF pane.inflight # Nil THEN {pane.inflight.tok} ELSE {})]

\* forgetFrames()
ForgetFrames(H) ==
  [H EXCEPT !.frames = <<>>, !.shownAct = Nil, !.prefillOn = FALSE]

DropHov(H) == IF FixDropView THEN [ForgetFrames(H) EXCEPT !.view = Nil] ELSE ForgetFrames(H)

PoolPush(s, f, keep) == IF Len(s) + 1 > keep THEN Append(Tail(s), f) ELSE Append(s, f)
PoolDrop(s, keep) == IF Len(s) + 1 > keep THEN {Head(s)} ELSE {}

KeyOfFrame(f) == <<f.pg, f.sz, f.y, f.act>>
FrameIdx(fs, k) == CHOOSE i \in DOMAIN fs : KeyOfFrame(fs[i]) = k
HasFrame(fs, k) == \E i \in DOMAIN fs : KeyOfFrame(fs[i]) = k
PutFrame(fs, f) ==
  LET base == IF Len(fs) >= FramesMax THEN Tail(fs) ELSE fs
  IN IF HasFrame(base, KeyOfFrame(f))
       THEN [i \in DOMAIN base |-> IF KeyOfFrame(base[i]) = KeyOfFrame(f) THEN f ELSE base[i]]
       ELSE Append(base, f)

SameView(v, pg, sz, y) == v # Nil /\ v.pg = pg /\ v.sz = sz /\ v.y = y

---------------------------------------------------------------------------
(* renderer.ts: stop() *)

StopEff(keepLast, why) ==
  /\ rdr' = [rdr EXCEPT
       !.idle = Nil, !.latest = @ + 1, !.server = 0, !.stopSeq = @ + 1,
       !.stops = IF rdr.starting
                   THEN @ \cup {[id |-> rdr.stopSeq + 1, phase |-> "A", tgt |-> 0, keep |-> keepLast, why |-> why]}
                   ELSE IF rdr.server # 0
                          THEN @ \cup {[id |-> rdr.stopSeq + 1, phase |-> "quit", tgt |-> rdr.server, keep |-> keepLast, why |-> why]}
                          ELSE @,
       !.stopping = IF rdr.starting \/ rdr.server # 0 THEN rdr.stopSeq + 1 ELSE @]

---------------------------------------------------------------------------
(* Ambiente *)

ChangePage ==
  /\ env.nChange < MaxChange
  /\ env' = [env EXCEPT !.page = IF @ < NPg THEN @ + 1 ELSE 1, !.nChange = @ + 1]
  /\ pane' = [pane EXCEPT !.needs = TRUE]
  /\ UNCHANGED <<rdr, procs, hov, reqs, reqSeq, nextFile, deleted, screen, ghost>>

Resize ==
  /\ env.nResize < MaxResize
  /\ \E s \in Szs : s # env.size /\ env' = [env EXCEPT !.size = s, !.nResize = @ + 1]
  /\ pane' = [pane EXCEPT !.needs = TRUE]
  /\ UNCHANGED <<rdr, procs, hov, reqs, reqSeq, nextFile, deleted, screen, ghost>>

ChromeMissing ==
  /\ CanMissChrome /\ env.chromeOk
  /\ env' = [env EXCEPT !.chromeOk = FALSE]
  /\ UNCHANGED <<pane, rdr, procs, hov, reqs, reqSeq, nextFile, deleted, screen, ghost>>

\* ui.scroll -> scrollBy
ScrollEvent ==
  /\ env.nWheel < MaxWheel
  /\ \E d \in {-1, 1} :
       LET next == Clamp(pane.target + d * Wheel, pane.maxScroll)
       IN /\ next # pane.target
          /\ pane' = [pane EXCEPT !.target = next, !.anim = TRUE]
          /\ hov' = IF pane.anim THEN hov ELSE [hov EXCEPT !.held = TRUE, !.shownAct = Nil]
  /\ env' = [env EXCEPT !.nWheel = @ + 1]
  /\ UNCHANGED <<rdr, procs, reqs, reqSeq, nextFile, deleted, screen, ghost>>

PointerMove(a) ==
  /\ HoverOn /\ hov.view # Nil
  /\ env' = [env EXCEPT !.ptr = a]
  /\ hov' = [hov EXCEPT !.wanted = a]
  /\ UNCHANGED <<pane, rdr, procs, reqs, reqSeq, nextFile, deleted, screen, ghost>>

PointerLeave ==
  /\ env.ptr # Nil
  /\ env' = [env EXCEPT !.ptr = Nil]
  /\ hov' = [hov EXCEPT !.wanted = Nil]
  /\ UNCHANGED <<pane, rdr, procs, reqs, reqSeq, nextFile, deleted, screen, ghost>>

Settled == reqs = {} /\ rdr.stops = {} /\ ~rdr.starting /\ ~pane.needs /\ ~pane.toastPend

Tick ==
  /\ Settled
  /\ pane' = [pane EXCEPT
       !.failAge = IF @ = -1 THEN -1 ELSE Inc(@, RetryNoFrame),
       !.retryLeft = IF @ > 0 THEN @ - 1 ELSE @,
       !.szAge = Inc(@, Settle),
       !.settleLeft = IF @ > 0 THEN @ - 1 ELSE @]
  /\ rdr' = [rdr EXCEPT
       !.idle = IF @ = Nil THEN Nil ELSE [@ EXCEPT !.age = Inc(@, IdleTicks)],
       !.aborts = [i \in DOMAIN @ |-> Inc(@[i], AbortWin)]]
  /\ ghost' = [ghost EXCEPT !.relaunch = [i \in DOMAIN @ |-> Inc(@[i], AbortWin)]]
  /\ UNCHANGED <<env, procs, hov, reqs, reqSeq, nextFile, deleted, screen>>

\* closePane: resetPane() e stop($)
PaneClose ==
  /\ env.open /\ env.nClose < MaxClose
  /\ env' = [env EXCEPT !.open = FALSE, !.ptr = Nil, !.nClose = @ + 1]
  /\ pane' = [pane EXCEPT !.landed = Nil, !.inflight = Nil, !.failAge = -1, !.redo = FALSE, !.needs = FALSE,
                          !.scroll = 0, !.target = 0, !.maxScroll = 0, !.slice = FALSE,
                          !.clipped = Nil, !.clipFailed = Nil]
  /\ hov' = [view |-> Nil, frames |-> <<>>, wanted |-> Nil, shownAct |-> Nil, held |-> FALSE,
             busy |-> FALSE, prefBusy |-> FALSE, prefillOn |-> FALSE]
  /\ ghost' = DropGhost(ghost)
  /\ StopEff(FALSE, "close")
  /\ UNCHANGED <<reqs, reqSeq, nextFile, deleted, screen>>

PaneOpen ==
  /\ ~env.open
  /\ env' = [env EXCEPT !.open = TRUE]
  /\ pane' = [pane EXCEPT !.needs = TRUE]
  /\ UNCHANGED <<rdr, procs, hov, reqs, reqSeq, nextFile, deleted, screen, ghost>>

\* resetSessionPane: recomeça o aviso por sessão
NewSession ==
  /\ env.nSess < MaxSess
  /\ env' = [env EXCEPT !.nSess = @ + 1, !.ptr = Nil]
  /\ pane' = [pane EXCEPT !.landed = Nil, !.inflight = Nil, !.failAge = -1, !.redo = FALSE,
                          !.scroll = 0, !.target = 0, !.maxScroll = 0, !.slice = FALSE,
                          !.clipped = Nil, !.clipFailed = Nil, !.isWarned = FALSE, !.toasts = 0]
  /\ hov' = [view |-> Nil, frames |-> <<>>, wanted |-> Nil, shownAct |-> Nil, held |-> FALSE,
             busy |-> FALSE, prefBusy |-> FALSE, prefillOn |-> FALSE]
  /\ ghost' = DropGhost(ghost)
  /\ UNCHANGED <<rdr, procs, reqs, reqSeq, nextFile, deleted, screen>>

---------------------------------------------------------------------------
(* renderer.ts: stop() *)

IdleFire ==
  /\ rdr.idle # Nil /\ rdr.idle.age >= IdleTicks
  /\ StopEff(TRUE, "idle")
  /\ UNCHANGED <<env, pane, procs, hov, reqs, reqSeq, nextFile, deleted, screen, ghost>>

\* quit chega ao processo; ao responder, o cliente guarda os PNGs mantidos e chama onLost(false)
StopQuit(s) ==
  /\ s \in rdr.stops /\ s.phase = "quit"
  /\ LET p == s.tgt IN
     /\ procs[p].st \in {"live", "quitting", "dead", "none"}
     /\ procs' = [procs EXCEPT ![p] = [@ EXCEPT !.st = IF @ = "live" THEN "quitting" ELSE @,
                                                 !.keep = s.keep]]
     /\ rdr' = [rdr EXCEPT
          !.stops = @ \ {s},
          !.stopping = IF @ = s.id THEN 0 ELSE @,
          !.kept = IF s.keep /\ procs[p].st = "live" THEN Range(procs[p].wr) \cup Range(procs[p].ck) ELSE
                   IF procs[p].st = "live" THEN {} ELSE @]
  /\ hov' = IF s.why = "idle" THEN ForgetFrames(hov) ELSE hov
  /\ UNCHANGED <<env, pane, reqs, reqSeq, nextFile, deleted, screen, ghost>>

---------------------------------------------------------------------------
(* pane.tsx: redesenho *)

RetryFire ==
  /\ pane.retryLeft = 0
  /\ pane' = [pane EXCEPT !.retryLeft = -1, !.needs = TRUE]
  /\ UNCHANGED <<env, rdr, procs, hov, reqs, reqSeq, nextFile, deleted, screen, ghost>>

SettleFire ==
  /\ pane.settleLeft = 0
  /\ pane' = [pane EXCEPT !.settleLeft = -1, !.needs = TRUE]
  /\ UNCHANGED <<env, rdr, procs, hov, reqs, reqSeq, nextFile, deleted, screen, ghost>>

ToastEmit ==
  /\ pane.toastPend
  /\ pane' = [pane EXCEPT !.toastPend = FALSE, !.toasts = @ + 1]
  /\ ghost' = [ghost EXCEPT !.toastWithFrame = @ \/ pane.landed # Nil]
  /\ UNCHANGED <<env, rdr, procs, hov, reqs, reqSeq, nextFile, deleted, screen>>

Key == <<env.page, env.size>>
AlreadyHave ==
  \/ pane.landed # Nil /\ <<pane.landed.pg, pane.landed.sz>> = Key
  \/ pane.inflight # Nil /\ <<pane.inflight.pg, pane.inflight.sz>> = Key
SzNew == pane.lastSz # env.size
SzAge1 == IF SzNew THEN 0 ELSE pane.szAge
Resizing == pane.landed # Nil /\ pane.landed.sz # env.size /\ SzAge1 < Settle
DoEnsure == ~IsCooling(pane) /\ ~Resizing
Starts == DoEnsure /\ ~AlreadyHave /\ pane.drawCount < MaxDraw
IsWarm == rdr.server # 0

NewRender ==
  [id |-> reqSeq + 1, kind |-> "render", phase |-> "run", tgt |-> 0, mine |-> rdr.latest + 1,
   tok |-> pane.drawCount + 1, pg |-> env.page, sz |-> env.size, res |-> "none", file |-> 0, rev |-> 0,
   pend |-> IF ColdNoWait THEN (IsWarm /\ pane.landed = Nil) ELSE pane.landed = Nil]

\* Efeitos comuns do início de renderPane até depois do ensure
AfterEnsure ==
  [pane EXCEPT !.needs = FALSE, !.redo = FALSE, !.lastSz = env.size, !.szAge = SzAge1,
     !.settleLeft = IF Resizing /\ pane.settleLeft = -1 THEN Settle ELSE pane.settleLeft,
     !.drawCount = IF Starts THEN @ + 1 ELSE @,
     !.inflight = IF Starts THEN [pg |-> env.page, sz |-> env.size, tok |-> pane.drawCount + 1] ELSE @,
     !.failAge = IF Starts THEN -1 ELSE @]

RdrAfterEnsure == IF Starts THEN [rdr EXCEPT !.latest = @ + 1] ELSE rdr
ReqsAfterEnsure == IF Starts THEN reqs \cup {NewRender} ELSE reqs
SeqAfterEnsure == IF Starts THEN reqSeq + 1 ELSE reqSeq
GhostAfterEnsure ==
  [ghost EXCEPT !.drawResizing = @ \/ (Starts /\ Resizing),
                !.spawnCooling = @]

\* Cooldown sem quadro: não desenha nada
RenderCooling ==
  /\ env.open /\ pane.needs /\ IsCooling(pane) /\ pane.landed = Nil
  /\ pane' = [pane EXCEPT !.needs = FALSE, !.redo = FALSE]
  /\ UNCHANGED <<env, rdr, procs, hov, reqs, reqSeq, nextFile, deleted, screen, ghost>>

\* Sem quadro: "Desenhando..."
RenderNoFrame ==
  /\ env.open /\ pane.needs /\ ~(IsCooling(pane) /\ pane.landed = Nil) /\ pane.landed = Nil
  /\ pane' = AfterEnsure
  /\ rdr' = RdrAfterEnsure /\ reqs' = ReqsAfterEnsure /\ reqSeq' = SeqAfterEnsure
  /\ ghost' = GhostAfterEnsure
  /\ UNCHANGED <<env, procs, hov, nextFile, deleted, screen>>

\* Mostra a imagem: atualiza visão do hover, quadro destacado e a tela
Show(P, L, file, cpg, y, isSliced, hv0, deletedNow) ==
  LET nextView == [pg |-> L.pg, sz |-> L.sz, y |-> y, rev |-> L.rev, base |-> file, srv |-> L.srv]
      same == SameView(hv0.view, L.pg, L.sz, y)
      view1 == IF same THEN (IF FixViewRev THEN [hv0.view EXCEPT !.rev = L.rev, !.base = file, !.srv = L.srv] ELSE hv0.view) ELSE nextView
      frames1 == IF ~same /\ ClearOnView THEN <<>> ELSE hv0.frames
      wanted1 == IF env.ptr # Nil THEN env.ptr ELSE hv0.wanted
      k == <<L.pg, L.sz, y, wanted1>>
      hit == wanted1 # Nil /\ HasFrame(frames1, k)
      f == IF hit THEN frames1[FrameIdx(frames1, k)] ELSE Nil
  IN [hov |-> [hv0 EXCEPT !.view = view1, !.frames = frames1, !.wanted = wanted1,
                          !.shownAct = IF hit THEN wanted1 ELSE Nil,
                          !.prefillOn = IF same THEN hv0.prefillOn ELSE TRUE],
      screen |-> IF hit THEN [kind |-> "hover", file |-> f.file, pg |-> L.pg, sz |-> L.sz, y |-> y, cpg |-> f.cpg]
                        ELSE [kind |-> IF isSliced THEN "slice" ELSE "base", file |-> file, pg |-> L.pg, sz |-> L.sz, y |-> y, cpg |-> cpg],
      dead |-> (IF hit THEN f.file ELSE file) \in deletedNow /\ (screen = Nil \/ screen.file # (IF hit THEN f.file ELSE file)),
      wrong |-> hit /\ f.cpg # L.pg,
      staleRev |-> ~FixViewRev /\ same /\ hv0.view.rev # L.rev]

ShowGhost(S) ==
  [ghost EXCEPT !.deadShown = @ \/ S.dead, !.wrongHover = @ \/ S.wrong, !.staleRev = @ \/ S.staleRev]

\* Quadro não rolável (ou sem rolagem): mostra frame.file
RenderFlat ==
  /\ env.open /\ pane.needs /\ ~(IsCooling(pane) /\ pane.landed = Nil) /\ pane.landed # Nil
  /\ LET L == pane.landed IN
     /\ ~Tall(L.pg)
     /\ LET S == Show(AfterEnsure, L, L.file, L.pg, 0, FALSE, hov, deleted) IN
        /\ pane' = [AfterEnsure EXCEPT !.scroll = IF pane.anim THEN @ ELSE 0,
                                      !.target = IF pane.anim THEN @ ELSE 0,
                                      !.maxScroll = 0, !.slice = FALSE]
        /\ hov' = S.hov /\ screen' = S.screen /\ ghost' = ShowGhost(S)
  /\ rdr' = RdrAfterEnsure /\ reqs' = ReqsAfterEnsure /\ reqSeq' = SeqAfterEnsure
  /\ UNCHANGED <<env, procs, nextFile, deleted>>

TallState ==
  LET L == pane.landed IN
  [sc |-> IF pane.anim THEN pane.scroll ELSE Clamp(pane.scroll, MaxScroll),
   tg |-> IF pane.anim THEN pane.target ELSE Clamp(pane.scroll, MaxScroll)]

ClipKeyMatch(P, L, y) == P.clipped # Nil /\ P.clipped.pg = L.pg /\ P.clipped.sz = L.sz /\ P.clipped.y = y
NoClipNeeded(P, L, y) == ClipKeyMatch(P, L, y) \/ (P.clipFailed # Nil /\ P.clipFailed = <<L.pg, L.sz>>)

\* rolável e sem pedido de recorte: usa o recorte guardado, se for o da chave
RenderTallNoClip ==
  /\ env.open /\ pane.needs /\ ~(IsCooling(pane) /\ pane.landed = Nil) /\ pane.landed # Nil
  /\ LET L == pane.landed
         T == TallState
         y == T.sc
     IN /\ Tall(L.pg) /\ NoClipNeeded(pane, L, y)
        /\ LET isSl == ClipKeyMatch(pane, L, y)
               file == IF isSl THEN pane.clipped.file ELSE L.file
               cpg == IF isSl THEN pane.clipped.cpg ELSE L.pg
               S == Show(AfterEnsure, L, file, cpg, IF isSl THEN y ELSE 0, isSl, hov, deleted)
           IN /\ pane' = [AfterEnsure EXCEPT !.scroll = T.sc, !.target = T.tg, !.maxScroll = MaxScroll, !.slice = isSl]
              /\ hov' = S.hov /\ screen' = S.screen /\ ghost' = ShowGhost(S)
  /\ rdr' = RdrAfterEnsure /\ reqs' = ReqsAfterEnsure /\ reqSeq' = SeqAfterEnsure
  /\ UNCHANGED <<env, procs, nextFile, deleted>>

\* Criação de PNG no servidor corrente (clip): devolve processo, pools e arquivo novo
ClipPoolOf(p) == IF SeparateClipPool THEN procs[p].ck ELSE procs[p].wr
ClipProcUpdate(p, f) ==
  [procs[p] EXCEPT !.ck = IF SeparateClipPool THEN PoolPush(@, f, 2) ELSE @,
                   !.wr = IF SeparateClipPool THEN @ ELSE PoolPush(@, f, 2)]
ClipDeleted(p) == PoolDrop(ClipPoolOf(p), 2)

RenderTallClipOk ==
  /\ env.open /\ pane.needs /\ ~(IsCooling(pane) /\ pane.landed = Nil) /\ pane.landed # Nil
  /\ nextFile <= MaxFiles
  /\ ServerLive
  /\ LET L == pane.landed
         T == TallState
         y == T.sc
         p == rdr.server
         f == nextFile
     IN /\ Tall(L.pg) /\ ~NoClipNeeded(pane, L, y)
        /\ LET del == deleted \cup ClipDeleted(p)
               S == Show(AfterEnsure, L, f, L.pg, y, TRUE, hov, del)
           IN /\ pane' = [AfterEnsure EXCEPT !.scroll = T.sc, !.target = T.tg, !.maxScroll = MaxScroll, !.slice = TRUE,
                                             !.clipped = [pg |-> L.pg, sz |-> L.sz, y |-> y, file |-> f, cpg |-> L.pg]]
              /\ hov' = S.hov /\ screen' = S.screen /\ ghost' = ShowGhost(S)
              /\ procs' = [procs EXCEPT ![p] = ClipProcUpdate(p, f)]
              /\ deleted' = del
              /\ nextFile' = nextFile + 1
              /\ rdr' = [RdrAfterEnsure EXCEPT !.idle = [for |-> p, age |-> 0]]
  /\ reqs' = ReqsAfterEnsure /\ reqSeq' = SeqAfterEnsure
  /\ UNCHANGED <<env>>

\* Recorte falhou e não há servidor: drop() e redesenho imediato
RenderTallClipFailDrop ==
  /\ env.open /\ pane.needs /\ ~(IsCooling(pane) /\ pane.landed = Nil) /\ pane.landed # Nil
  /\ LET L == pane.landed
         y == TallState.sc
     IN /\ Tall(L.pg) /\ ~NoClipNeeded(pane, L, y)
        /\ rdr.server = 0 /\ ~pane.redo
        /\ pane' = [DropP(AfterEnsure) EXCEPT !.redo = TRUE, !.needs = TRUE]
        /\ ghost' = [GhostAfterEnsure EXCEPT !.cancelled = @ \cup (IF pane.inflight # Nil THEN {pane.inflight.tok} ELSE {}) \cup (IF Starts THEN {pane.drawCount + 1} ELSE {})]
  /\ rdr' = RdrAfterEnsure /\ reqs' = ReqsAfterEnsure /\ reqSeq' = SeqAfterEnsure
  /\ hov' = DropHov(hov)
  /\ UNCHANGED <<env, procs, nextFile, deleted, screen>>

\* Recorte falhou com servidor (ou na segunda tentativa): mostra frame.file e marca a falha
RenderTallClipFailKeep ==
  /\ env.open /\ pane.needs /\ ~(IsCooling(pane) /\ pane.landed = Nil) /\ pane.landed # Nil
  /\ LET L == pane.landed
         T == TallState
         y == T.sc
     IN /\ Tall(L.pg) /\ ~NoClipNeeded(pane, L, y)
        /\ \/ /\ ServerLive /\ env.nErr < MaxErr
              /\ env' = [env EXCEPT !.nErr = @ + 1]
           \/ /\ ServerDead
              /\ UNCHANGED env
           \/ /\ rdr.server = 0 /\ pane.redo
              /\ UNCHANGED env
        /\ LET S == Show(AfterEnsure, L, L.file, L.pg, 0, FALSE, hov, deleted) IN
           /\ pane' = [AfterEnsure EXCEPT !.scroll = T.sc, !.target = T.tg, !.maxScroll = MaxScroll, !.slice = FALSE,
                                          !.clipFailed = <<L.pg, L.sz>>]
           /\ hov' = S.hov /\ screen' = S.screen /\ ghost' = ShowGhost(S)
  /\ rdr' = RdrAfterEnsure /\ reqs' = ReqsAfterEnsure /\ reqSeq' = SeqAfterEnsure
  /\ UNCHANGED <<procs, nextFile, deleted>>

\* Animação de rolagem (animateScroll / paintSlice): um quadro por passo
AnimStep ==
  /\ pane.anim /\ pane.landed # Nil /\ pane.scroll # pane.target
  /\ LET sc == StepToward(pane.scroll, pane.target)
         L == pane.landed
     IN \/ \* clip bem-sucedido e blit
           /\ pane.slice /\ ServerLive /\ nextFile <= MaxFiles
           /\ LET p == rdr.server
                  f == nextFile
                  del == deleted \cup ClipDeleted(p)
              IN /\ pane' = [pane EXCEPT !.scroll = sc,
                                         !.clipped = [pg |-> L.pg, sz |-> L.sz, y |-> sc, file |-> f, cpg |-> L.pg]]
                 /\ procs' = [procs EXCEPT ![p] = ClipProcUpdate(p, f)]
                 /\ deleted' = del
                 /\ nextFile' = nextFile + 1
                 /\ rdr' = [rdr EXCEPT !.idle = [for |-> p, age |-> 0]]
                 /\ screen' = [kind |-> "slice", file |-> f, pg |-> L.pg, sz |-> L.sz, y |-> sc, cpg |-> L.pg]
                 /\ ghost' = [ghost EXCEPT !.deadShown = @ \/ (f \in del)]
        \/ \* paintSlice devolve false: o laço para (a rolagem já andou)
           /\ ~pane.slice \/ ~ServerLive
           /\ pane' = [pane EXCEPT !.scroll = sc, !.target = sc]
           /\ UNCHANGED <<rdr, procs, nextFile, deleted, screen, ghost>>
  /\ UNCHANGED <<env, hov, reqs, reqSeq>>

AnimEnd ==
  /\ pane.anim /\ (pane.landed = Nil \/ pane.scroll = pane.target)
  /\ pane' = [pane EXCEPT !.anim = FALSE, !.needs = TRUE]
  /\ hov' = [hov EXCEPT !.held = FALSE]
  /\ UNCHANGED <<env, rdr, procs, reqs, reqSeq, nextFile, deleted, screen, ghost>>

---------------------------------------------------------------------------
(* renderer.ts: pedidos em voo *)

PendEnd(r) ==
  /\ r \in reqs /\ r.kind = "render" /\ r.pend
  /\ reqs' = (reqs \ {r}) \cup {[r EXCEPT !.pend = FALSE]}
  /\ UNCHANGED <<env, pane, rdr, procs, hov, reqSeq, nextFile, deleted, screen, ghost>>

\* O host derruba a chamada que ainda estava pendurada: o fetch vira "replaced"
AbortReq(r) ==
  /\ r \in reqs /\ r.kind = "render" /\ r.pend /\ r.phase \in {"send", "queued"}
  /\ env.nAbort < MaxAbort
  /\ env' = [env EXCEPT !.nAbort = @ + 1]
  /\ reqs' = (reqs \ {r}) \cup {[r EXCEPT !.phase = "replied", !.res = "replaced", !.pend = FALSE]}
  /\ procs' = IF r.phase = "queued"
                THEN [procs EXCEPT ![r.tgt] = [@ EXCEPT !.q = SelectSeq(@, LAMBDA i: i # r.id)]]
                ELSE procs
  /\ UNCHANGED <<pane, rdr, hov, reqSeq, nextFile, deleted, screen, ghost>>

\* running(): espera stopping, usa o servidor ou lança um
RunStep(r) ==
  /\ r \in reqs /\ r.kind = "render" /\ r.phase = "run" /\ rdr.stopping = 0
  /\ \A o \in reqs : o.phase = "run" => r.id <= o.id
  /\ \/ /\ rdr.server # 0
        /\ reqs' = (reqs \ {r}) \cup {[r EXCEPT !.phase = "send", !.tgt = rdr.server]}
        /\ UNCHANGED <<rdr, ghost>>
     \/ /\ rdr.server = 0 /\ rdr.starting
        /\ reqs' = (reqs \ {r}) \cup {[r EXCEPT !.phase = "launch"]}
        /\ UNCHANGED <<rdr, ghost>>
     \/ /\ rdr.server = 0 /\ ~rdr.starting
        /\ reqs' = (reqs \ {r}) \cup {[r EXCEPT !.phase = "launch"]}
        /\ rdr' = [rdr EXCEPT !.starting = TRUE, !.launchPend = r.pend]
        /\ ghost' = [ghost EXCEPT !.spawnCooling = @ \/ (IsCooling(pane) /\ pane.failAge >= 0)]
  /\ UNCHANGED <<env, pane, procs, hov, reqSeq, nextFile, deleted, screen>>

LaunchFinish ==
  /\ rdr.starting
  /\ LET waiters == {w \in rdr.stops : w.phase = "A"}
         anyW == waiters # {}
         first == CHOOSE w \in waiters : \A x \in waiters : w.id <= x.id
         ids == {w.id : w \in waiters}
     IN
     /\ \/ /\ env.chromeOk /\ rdr.nextProc <= MaxProc
           /\ LET p == rdr.nextProc IN
              /\ procs' = [procs EXCEPT ![p] = [@ EXCEPT !.st = "booting", !.abortable = rdr.launchPend]]
              /\ reqs' = {IF r.phase = "launch" THEN [r EXCEPT !.phase = "send", !.tgt = p] ELSE r : r \in reqs}
              /\ rdr' = [rdr EXCEPT !.starting = FALSE, !.nextProc = @ + 1,
                                    !.server = IF anyW THEN 0 ELSE p,
                                    !.idle = IF anyW THEN Nil ELSE @,
                                    !.stops = (@ \ waiters) \cup (IF anyW THEN {[first EXCEPT !.phase = "quit", !.tgt = p]} ELSE {}),
                                    !.stopping = IF anyW /\ @ \in ids /\ @ # first.id THEN 0 ELSE @]
        \/ /\ ~(env.chromeOk /\ rdr.nextProc <= MaxProc)
           /\ reqs' = {IF r.phase = "launch" THEN [r EXCEPT !.phase = "replied", !.res = "lost"] ELSE r : r \in reqs}
           /\ rdr' = [rdr EXCEPT !.starting = FALSE, !.stops = @ \ waiters,
                                 !.stopping = IF @ \in ids THEN 0 ELSE @]
           /\ UNCHANGED procs
  /\ UNCHANGED <<env, pane, hov, reqSeq, nextFile, deleted, screen, ghost>>

\* send(): conecta ao processo; renderização e hover entram na fila dele
ReqSend(r) ==
  /\ r \in reqs /\ r.phase = "send"
  /\ \A o \in reqs : o.phase = "send" => r.id <= o.id
  /\ LET p == r.tgt IN
     \/ /\ procs[p].st = "live"
        /\ procs' = [procs EXCEPT ![p] = [@ EXCEPT !.q = Append(@, r.id)]]
        /\ reqs' = (reqs \ {r}) \cup {[r EXCEPT !.phase = "queued"]}
     \/ /\ procs[p].st = "booting" /\ rdr.server # p
        /\ reqs' = (reqs \ {r}) \cup {[r EXCEPT !.phase = "replied", !.res = "lost"]}
        /\ UNCHANGED procs
     \/ /\ procs[p].st \in {"quitting", "dead", "none"}
        /\ reqs' = (reqs \ {r}) \cup {[r EXCEPT !.phase = "replied", !.res = "lost"]}
        /\ UNCHANGED procs
  /\ UNCHANGED <<env, pane, rdr, hov, reqSeq, nextFile, deleted, screen, ghost>>

ProcListen(p) ==
  /\ procs[p].st = "booting"
  /\ procs' = [procs EXCEPT ![p] = [@ EXCEPT !.st = "live"]]
  /\ UNCHANGED <<env, pane, rdr, hov, reqs, reqSeq, nextFile, deleted, screen, ghost>>

LoseQueued(p) ==
  /\ reqs' = {IF r.id \in Range(procs[p].q) THEN [r EXCEPT !.phase = "replied", !.res = "lost"] ELSE r : r \in reqs}

Crash(p) ==
  /\ procs[p].st \in {"booting", "live"} /\ env.nCrash < MaxCrash
  /\ env' = [env EXCEPT !.nCrash = @ + 1]
  /\ procs' = [procs EXCEPT ![p] = [@ EXCEPT !.st = "dead", !.end = "crash", !.q = <<>>]]
  /\ LoseQueued(p)
  /\ UNCHANGED <<pane, rdr, hov, reqSeq, nextFile, deleted, screen, ghost>>

\* O processo foi lançado por uma chamada que ainda esperava: o host a derruba
AbortProc(p) ==
  /\ procs[p].st \in {"booting", "live"} /\ procs[p].abortable /\ env.nAbort < MaxAbort
  /\ env' = [env EXCEPT !.nAbort = @ + 1]
  /\ procs' = [procs EXCEPT ![p] = [@ EXCEPT !.st = "dead", !.end = "abort", !.q = <<>>]]
  /\ LoseQueued(p)
  /\ UNCHANGED <<pane, rdr, hov, reqSeq, nextFile, deleted, screen, ghost>>

\* /quit respondido, 10 ms depois o processo sai e apaga os PNGs
ProcShutdown(p) ==
  /\ procs[p].st = "quitting"
  /\ ~(\E s \in rdr.stops : s.tgt = p)
  /\ procs' = [procs EXCEPT ![p] = [@ EXCEPT !.st = "dead", !.end = "quit", !.q = <<>>]]
  /\ deleted' = deleted \cup Range(procs[p].hv)
                        \cup (IF procs[p].keep THEN {} ELSE Range(procs[p].wr) \cup Range(procs[p].ck))
  /\ LoseQueued(p)
  /\ UNCHANGED <<env, pane, rdr, hov, reqSeq, nextFile, screen, ghost>>

Serve(p) ==
  /\ procs[p].st \in {"live", "quitting"} /\ procs[p].q # <<>>
  /\ LET r == ReqById(Head(procs[p].q))
         q1 == Tail(procs[p].q)
         f == nextFile
     IN
     \/ /\ r.kind = "render" /\ nextFile <= MaxFiles
        /\ procs' = [procs EXCEPT ![p] = [@ EXCEPT !.q = q1, !.rev = @ + 1, !.pg = r.pg, !.sz = r.sz,
                                                    !.wr = PoolPush(@, f, 2)]]
        /\ deleted' = deleted \cup PoolDrop(procs[p].wr, 2)
        /\ nextFile' = nextFile + 1
        /\ reqs' = (reqs \ {r}) \cup {[r EXCEPT !.phase = "replied", !.res = "ok", !.file = f, !.rev = procs[p].rev + 1]}
        /\ UNCHANGED env
     \/ /\ r.kind = "render" /\ env.nErr < MaxErr
        /\ env' = [env EXCEPT !.nErr = @ + 1]
        /\ procs' = [procs EXCEPT ![p] = [@ EXCEPT !.q = q1]]
        /\ reqs' = (reqs \ {r}) \cup {[r EXCEPT !.phase = "replied", !.res = "err"]}
        /\ UNCHANGED <<nextFile, deleted>>
     \/ /\ r.kind = "hover" /\ (procs[p].rev # r.vrev \/ (FixRevServer /\ r.vsrv # p))
        /\ procs' = [procs EXCEPT ![p] = [@ EXCEPT !.q = q1]]
        /\ reqs' = (reqs \ {r}) \cup {[r EXCEPT !.phase = "replied", !.res = "conflict"]}
        /\ UNCHANGED <<env, nextFile, deleted>>
     \/ /\ r.kind = "hover" /\ procs[p].rev = r.vrev /\ (~FixRevServer \/ r.vsrv = p) /\ procs[p].rev > 0 /\ nextFile <= MaxFiles
        /\ procs' = [procs EXCEPT ![p] = [@ EXCEPT !.q = q1, !.hv = PoolPush(@, f, HKeep)]]
        /\ deleted' = deleted \cup PoolDrop(procs[p].hv, HKeep)
        /\ nextFile' = nextFile + 1
        /\ reqs' = (reqs \ {r}) \cup {[r EXCEPT !.phase = "replied", !.res = "ok", !.file = f, !.cpg = procs[p].pg]}
        /\ UNCHANGED env
  /\ UNCHANGED <<pane, rdr, hov, reqSeq, screen, ghost>>

\* O fluxo do processo terminou: quem o rastreava perde o servidor (whenLost)
ProcEnd(p) ==
  /\ procs[p].st = "dead" /\ ~procs[p].ended
  /\ procs' = [procs EXCEPT ![p] = [@ EXCEPT !.ended = TRUE]]
  /\ IF rdr.server # p
       THEN UNCHANGED <<rdr, pane, hov, ghost>>
       ELSE LET isRep == procs[p].end = "abort"
                recent == SelectSeq(rdr.aborts, LAMBDA a: a < AbortWin)
                newAborts == IF isRep THEN Append(recent, 0) ELSE <<>>
                isAborted == isRep /\ Len(newAborts) <= AbortsMax
            IN /\ rdr' = [rdr EXCEPT !.server = 0, !.aborts = newAborts, !.idle = IF FixIdle THEN Nil ELSE @]
               /\ hov' = DropHov(hov)
               /\ ghost' = [DropGhost(ghost) EXCEPT
                              !.relaunch = IF isAborted THEN Append(SelectSeq(@, LAMBDA a: a < AbortWin), 0) ELSE @]
               /\ pane' = IF isAborted THEN [DropP(pane) EXCEPT !.needs = TRUE] ELSE FailP(DropP(pane))
  /\ UNCHANGED <<env, reqs, reqSeq, nextFile, deleted, screen>>

---------------------------------------------------------------------------
(* Resposta do desenho chega ao pane (start().then) *)

RenderFinish(r) ==
  /\ r \in reqs /\ r.kind = "render" /\ r.phase = "replied"
  /\ LET isSup == r.mine # rdr.latest
         got == r.res = "ok"
         frame == got /\ ~isSup
         rep == r.res = "replaced"
         P == pane
         hit == P.inflight # Nil /\ (IF FixToken THEN P.inflight.tok = r.tok
                                     ELSE P.inflight.pg = r.pg /\ P.inflight.sz = r.sz)
         stale == hit /\ P.inflight.tok # r.tok
         lost == frame /\ ~hit /\ r.tok = P.drawCount /\ r.tok \notin ghost.cancelled
     IN
     /\ reqs' = reqs \ {r}
     /\ rdr' = [rdr EXCEPT !.idle = IF got /\ rdr.server = r.tgt THEN [for |-> r.tgt, age |-> 0] ELSE @,
                           !.kept = IF frame THEN {} ELSE @]
     /\ deleted' = IF frame THEN deleted \cup rdr.kept ELSE deleted
     /\ pane' = IF ~hit THEN P
                ELSE IF rep THEN [P EXCEPT !.inflight = Nil, !.needs = TRUE]
                ELSE IF frame
                       THEN [P EXCEPT !.inflight = Nil, !.needs = TRUE,
                                      !.landed = [pg |-> r.pg, sz |-> r.sz, tok |-> r.tok, rev |-> r.rev, file |-> r.file, srv |-> r.tgt],
                                      !.clipped = IF FixClipOnLand THEN Nil ELSE @]
                       ELSE FailP([P EXCEPT !.inflight = Nil])
     /\ ghost' = [ghost EXCEPT !.okTok = IF frame THEN Max(@, r.tok) ELSE @,
                               !.lostGood = @ \/ lost,
                               !.spurious = @ \/ (stale /\ ~frame)]
  /\ UNCHANGED <<env, procs, hov, reqSeq, nextFile, screen>>

---------------------------------------------------------------------------
(* hover.ts *)

CachedFor(v, act) == HasFrame(hov.frames, <<v.pg, v.sz, v.y, act>>)

NewHover(v, act, owner) ==
  [id |-> reqSeq + 1, kind |-> "hover", phase |-> IF rdr.server = 0 THEN "replied" ELSE "send",
   tgt |-> rdr.server, vpg |-> v.pg, vsz |-> v.sz, vy |-> v.y, vrev |-> v.rev, vsrv |-> v.srv, act |-> act,
   owner |-> owner, res |-> IF rdr.server = 0 THEN "lost" ELSE "none", file |-> 0, cpg |-> 0]

\* settle(): troca a imagem (base ou quadro em cache) ou pede o quadro ao servidor
SettleBlit ==
  /\ hov.view # Nil /\ ~hov.held /\ hov.shownAct # hov.wanted /\ ~hov.busy /\ ~pane.needs
  /\ LET v == hov.view
         w == hov.wanted
         k == <<v.pg, v.sz, v.y, w>>
     IN \/ /\ w = Nil
           /\ screen' = [kind |-> "base", file |-> v.base, pg |-> v.pg, sz |-> v.sz, y |-> v.y, cpg |-> v.pg]
           /\ ghost' = [ghost EXCEPT !.deadShown = @ \/ (v.base \in deleted /\ (screen = Nil \/ screen.file # v.base))]
           /\ hov' = [hov EXCEPT !.shownAct = Nil]
        \/ /\ w # Nil /\ HasFrame(hov.frames, k)
           /\ LET f == hov.frames[FrameIdx(hov.frames, k)] IN
              /\ screen' = [kind |-> "hover", file |-> f.file, pg |-> v.pg, sz |-> v.sz, y |-> v.y, cpg |-> f.cpg]
              /\ ghost' = [ghost EXCEPT !.deadShown = @ \/ (f.file \in deleted /\ (screen = Nil \/ screen.file # f.file)),
                                        !.wrongHover = @ \/ f.cpg # v.pg]
           /\ hov' = [hov EXCEPT !.shownAct = w]
  /\ UNCHANGED <<env, pane, rdr, procs, reqs, reqSeq, nextFile, deleted>>

SettleAsk ==
  /\ hov.view # Nil /\ ~hov.held /\ hov.shownAct # hov.wanted /\ ~hov.busy /\ ~pane.needs
  /\ hov.wanted # Nil /\ ~CachedFor(hov.view, hov.wanted)
  /\ reqs' = reqs \cup {NewHover(hov.view, hov.wanted, "settle")}
  /\ reqSeq' = reqSeq + 1
  /\ hov' = [hov EXCEPT !.busy = TRUE]
  /\ UNCHANGED <<env, pane, rdr, procs, nextFile, deleted, screen, ghost>>

Prefill ==
  /\ hov.view # Nil /\ hov.prefillOn /\ ~hov.prefBusy
  /\ \E a \in Acts :
       /\ ~CachedFor(hov.view, a)
       /\ reqs' = reqs \cup {NewHover(hov.view, a, "prefill")}
       /\ reqSeq' = reqSeq + 1
  /\ hov' = [hov EXCEPT !.prefBusy = TRUE]
  /\ UNCHANGED <<env, pane, rdr, procs, nextFile, deleted, screen, ghost>>

PrefillDone ==
  /\ hov.prefillOn /\ ~hov.prefBusy
  /\ hov.view = Nil \/ (\A a \in Acts : CachedFor(hov.view, a))
  /\ hov' = [hov EXCEPT !.prefillOn = FALSE]
  /\ UNCHANGED <<env, pane, rdr, procs, reqs, reqSeq, nextFile, deleted, screen, ghost>>

HoverFinish(r) ==
  /\ r \in reqs /\ r.kind = "hover" /\ r.phase = "replied" /\ ~pane.needs
  /\ LET v == hov.view
         okRaw == r.res = "ok"
         ok == okRaw /\ (~FixHot \/ rdr.server = r.tgt)
         same == SameView(v, r.vpg, r.vsz, r.vy)
         ins == ok /\ same
         fr == [pg |-> r.vpg, sz |-> r.vsz, y |-> r.vy, act |-> r.act, file |-> r.file, cpg |-> r.cpg]
         isSettle == r.owner = "settle"
         doBlit == isSettle /\ same /\ hov.wanted = r.act /\ (~FixHeldBlit \/ ~hov.held)
         shownFile == IF ok THEN r.file ELSE IF v # Nil THEN v.base ELSE 0
     IN
     /\ reqs' = reqs \ {r}
     /\ rdr' = [rdr EXCEPT !.idle = IF okRaw /\ rdr.server = r.tgt THEN [for |-> r.tgt, age |-> 0] ELSE @]
     /\ hov' = [hov EXCEPT !.frames = IF ins THEN PutFrame(@, fr) ELSE @,
                           !.busy = IF isSettle THEN FALSE ELSE @,
                           !.prefBusy = IF isSettle THEN @ ELSE FALSE,
                           !.prefillOn = IF ~isSettle /\ ~ok THEN FALSE ELSE @,
                           !.shownAct = IF doBlit THEN r.act ELSE @]
     /\ screen' = IF doBlit THEN [kind |-> IF ok THEN "hover" ELSE "base", file |-> shownFile, pg |-> v.pg, sz |-> v.sz,
                                  y |-> v.y, cpg |-> IF ok THEN r.cpg ELSE v.pg]
                  ELSE screen
     /\ ghost' = [ghost EXCEPT !.deadShown = @ \/ (doBlit /\ shownFile \in deleted /\ (screen = Nil \/ screen.file # shownFile)),
                               !.wrongHover = @ \/ (doBlit /\ ok /\ r.cpg # v.pg),
                               !.hotAfterStop = @ \/ (okRaw /\ rdr.server # r.tgt /\ ins)]
  /\ UNCHANGED <<env, pane, procs, reqSeq, nextFile, deleted>>

---------------------------------------------------------------------------
Next ==
  \/ ChangePage
  \/ Resize
  \/ ChromeMissing
  \/ ScrollEvent
  \/ PointerLeave
  \/ Tick
  \/ \E a \in Acts : PointerMove(a)
  \/ PaneClose
  \/ PaneOpen
  \/ NewSession
  \/ IdleFire
  \/ RetryFire
  \/ SettleFire
  \/ ToastEmit
  \/ RenderCooling
  \/ RenderNoFrame
  \/ RenderFlat
  \/ RenderTallNoClip
  \/ RenderTallClipOk
  \/ RenderTallClipFailDrop
  \/ RenderTallClipFailKeep
  \/ AnimStep
  \/ AnimEnd
  \/ LaunchFinish
  \/ \E s \in rdr.stops : StopQuit(s)
  \/ \E r \in reqs : PendEnd(r)
  \/ \E r \in reqs : AbortReq(r)
  \/ \E r \in reqs : RunStep(r)
  \/ \E r \in reqs : ReqSend(r)
  \/ \E r \in reqs : RenderFinish(r)
  \/ \E r \in reqs : HoverFinish(r)
  \/ \E p \in Procs : ProcListen(p)
  \/ \E p \in Procs : Crash(p)
  \/ \E p \in Procs : AbortProc(p)
  \/ \E p \in Procs : ProcShutdown(p)
  \/ \E p \in Procs : Serve(p)
  \/ \E p \in Procs : ProcEnd(p)
  \/ SettleBlit
  \/ SettleAsk
  \/ Prefill
  \/ PrefillDone

Fairness ==
  /\ WF_vars(Tick)
  /\ WF_vars(RetryFire) /\ WF_vars(SettleFire) /\ WF_vars(ToastEmit) /\ WF_vars(IdleFire)
  /\ WF_vars(RenderCooling \/ RenderNoFrame \/ RenderFlat \/ RenderTallNoClip \/ RenderTallClipOk
             \/ RenderTallClipFailDrop \/ RenderTallClipFailKeep)
  /\ WF_vars(AnimStep) /\ WF_vars(AnimEnd) /\ WF_vars(LaunchFinish)
  /\ WF_vars(\E s \in rdr.stops : StopQuit(s))
  /\ WF_vars(\E r \in reqs : PendEnd(r))
  /\ WF_vars(\E r \in reqs : RunStep(r))
  /\ WF_vars(\E r \in reqs : ReqSend(r))
  /\ WF_vars(\E r \in reqs : RenderFinish(r))
  /\ WF_vars(\E r \in reqs : HoverFinish(r))
  /\ WF_vars(\E p \in Procs : ProcListen(p))
  /\ WF_vars(\E p \in Procs : ProcShutdown(p))
  /\ WF_vars(\E p \in Procs : Serve(p))
  /\ WF_vars(\E p \in Procs : ProcEnd(p))
  /\ WF_vars(SettleBlit \/ SettleAsk)

SafeSpec == Init /\ [][Next]_vars
LiveSpec == SafeSpec /\ Fairness

---------------------------------------------------------------------------
TypeOK ==
  /\ env.page \in Pgs /\ env.size \in Szs /\ env.open \in BOOLEAN
  /\ pane.scroll \in 0..MaxScroll /\ pane.target \in 0..MaxScroll
  /\ pane.failAge \in -1..RetryNoFrame
  /\ pane.retryLeft \in -1..RetryNoFrame /\ pane.settleLeft \in -1..Settle
  /\ pane.landed = Nil \/ pane.landed \in [pg : Pgs, sz : Szs, tok : Nat, rev : Nat, file : Nat, srv : Nat]
  /\ pane.inflight = Nil \/ pane.inflight \in [pg : Pgs, sz : Szs, tok : Nat]
  /\ pane.toasts \in Nat
  /\ rdr.server \in 0..MaxProc
  /\ rdr.idle = Nil \/ rdr.idle \in [for : Procs, age : 0..IdleTicks]
  /\ procs \in [Procs -> [st : {"none", "booting", "live", "quitting", "dead"},
                          end : {"none", "crash", "abort", "quit"}, rev : Nat, pg : Nat, sz : Nat,
                          wr : Seq(Nat), ck : Seq(Nat), hv : Seq(Nat), q : Seq(Nat),
                          ended : BOOLEAN, abortable : BOOLEAN, keep : BOOLEAN]]
  /\ Len(hov.frames) <= FramesMax

Live(p) == procs[p].st \in {"booting", "live", "quitting"}
Usable(p) == procs[p].st \in {"booting", "live"}
Stopped(p) == \E s \in rdr.stops : s.tgt = p
Unattended == {p \in Procs : Usable(p) /\ p # rdr.server /\ ~Stopped(p)}

NoOrphanServer == Unattended = {}
SingleServer == Cardinality(Unattended \cup (IF rdr.server # 0 /\ Usable(rdr.server) THEN {rdr.server} ELSE {})) <= 1
TimerDiscipline == rdr.idle # Nil => rdr.idle.for = rdr.server
LatestWins == ~ghost.lostGood /\ (pane.landed # Nil => pane.landed.tok = ghost.okTok)
NoSpuriousFailure == ~ghost.spurious
NoStaleFileShown == ~ghost.deadShown
ToastOnce == pane.toasts <= 1
NoToastWithFrame == ~ghost.toastWithFrame
NoRelaunchLoop ==
  Cardinality({i \in DOMAIN ghost.relaunch : ghost.relaunch[i] < AbortWin}) <= AbortsMax
NoSpawnWhileCooling == ~ghost.spawnCooling
HoverNeverStale == ~ghost.wrongHover
HoverRevFresh == ~ghost.staleRev
NoDrawWhileResizing == ~ghost.drawResizing
NoHotAfterStop == ~ghost.hotAfterStop
FramesBounded == Len(hov.frames) <= FramesMax

Shows == pane.landed # Nil /\ pane.landed.pg = env.page /\ pane.landed.sz = env.size

EventuallyShows == (<>[]env.open) => <>[]Shows
ScrollConverges == <>[](pane.scroll = pane.target /\ ~pane.anim)
HoldReleases == [](hov.held => <>(~hov.held))

=============================================================================
