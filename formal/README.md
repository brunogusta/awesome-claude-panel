# Verificação formal do awesome-claude-panel

Duas partes: provas em Lean 4 da lógica pura (`formal/lean`) e um modelo TLA+ do ciclo de vida
(`formal/tla`). O teste `tests/formal-conformance.test.ts` liga as duas ao código TypeScript real.

## Como rodar tudo

```
cd formal/lean && ~/.elan/bin/lake build              # 0 erros, 0 sorry (o módulo Grid leva ~1,5 min: conta 65025 casos no kernel)
cd formal/lean && ~/.elan/bin/lake env lean Audit.lean # axiomas dos teoremas principais

cd formal/tla
JAVA=~/.local/opt/jdk-21.0.13+9-jre/bin/java
$JAVA -XX:+UseParallelGC -cp ~/.local/opt/tla2tools.jar tlc2.TLC -workers auto -config PanelLifecycle.cfg PanelLifecycle.tla
# configs: ver a tabela abaixo; apague PanelLifecycle_TTrace_* e states/ depois

claude plugin test .       # inclui tests/formal-conformance.test.ts
claude plugin validate .
node --test tests/server.check.mjs
```

## Lean (`formal/lean/Panel/*.lean`, Lean 4.35, sem Mathlib)

Axiomas: só `propext`, `Classical.choice`, `Quot.sound` (vários teoremas não usam nenhum).
Nada de `native_decide`; os `decide +kernel` não adicionam axioma.

| Módulo | O que garante |
| --- | --- |
| `HitAt` | `hitAt` e `hitIn` são o mesmo laço (`pick`) com predicados diferentes. Só devolvem elemento que satisfaz o predicado, escolhem a menor área, acham algo quando existe candidato, o primeiro ganha no empate, o botão aninhado vence a linha. `hitIn`: só devolve elemento que intersecta a célula com sobreposição de pelo menos 30% do menor dos dois; vizinho que só encosta ou sobrepõe menos nunca volta; célula não cortada por borda (e, em particular, a célula 1x1 da grade inteira) dá exatamente `hitAt` no ponto. |
| `Escape` | `esc` é injetiva (via `unesc`), não deixa `< > " '` crus e todo `&` abre uma das cinco entidades. |
| `Act` | `parse (build verbo abs) = (verbo, abs)` para qualquer `abs`; `open:cli:abs` com `cli` sem `:`; um `cli` com `:` quebra o parse (teorema geral e contraexemplo `open:a:b:/x`). |
| `Editors` | Os candidatos de `editors.ts` não têm `:` e `finalFilter` descarta qualquer `cli` com `:`; logo a precondição do parse vale para todo editor devolvido (Linux e macOS). |
| `Scroll` | `stepToward` nunca ultrapassa o alvo, aproxima estritamente, anda pelo menos 1 px e chega exatamente ao alvo em no máximo `|alvo-atual|` passos; `clampPx` fica em `[0, max]`; a fatia `[y, y+shotPx)` fica dentro da página com `shotPx >= 1`; a escala `rows*ch/shotPx` está bem definida e positiva com a guarda `shotPx < 1`, e sem ela `shotPx = 0` divide por zero; `paintSlice` com `max 1 height` nunca divide por zero. |
| `Height` | `estimateHeight <= 8000` para qualquer modelo (inclusive diff binário), lista <= 40, árvore <= 200, no máximo 300 linhas de diff. |
| `HoverCache` | O cache FIFO nunca passa de 48 (por qualquer sequência de inserções e limpezas), as chaves ficam únicas, `lookup` só devolve o que foi inserido com a mesma chave, e a chave `chave|y|ato` distingue página, offset e ato quando as chaves de página não são prefixo uma da outra. |
| `Click` | O pixel de página de um clique dentro da imagem cai em `[0, largura)` e em `[offset, offset+shotPx)`, que está dentro da página (racionais exatos, offset em px). |
| `Grid` | `w >= 4`, `h >= 8`, a grade nunca passa da célula cheia (`k <= 1`); colunas e linhas da imagem <= 255; a fatia nunca precisa de mais linhas que o corpo. Para a célula padrão 13x28 e todas as 65025 combinações de colunas e linhas, a imagem tem no máximo 2 080 800 px (255*255*4*8). O teto de 1,6 MP NÃO vale nos extremos (ver relatório). |
| `Unseen` | Abrir o diff tira a bolinha, uma edição posterior a traz de volta, abrir um arquivo não mexe nos outros, arquivo só lido nunca tem bolinha; o comparador de ordem (arquivo vivo primeiro, depois do mais recente) é antissimétrico, transitivo e põe o vivo na frente. |
| `LogQueue` | A fila de log nunca passa de 400; cada entrada é gravada, está na fila, em voo ou contada em `dropped`; a falha de gravação devolve linhas, cabeçalho e `dropped` sem perda quando cabe em 400; com estouro a perda é exatamente `linhas + fila - 400` (defeito corrigido em `trace.ts`). |

## TLA+ (`formal/tla/PanelLifecycle.tla`)

Modelo do pane (token por desenho, cooldown curto com quadro e longo sem, aviso uma vez por sessão e só sem
quadro, resposta superada/abortada vira "replaced", espera de calma no redimensionamento, rolagem animada com
hold do hover), do renderer (servidor único, `stop` com `keepLast`, janela de abortos, largada a frio sem
esperar o primeiro quadro: só chamada ainda pendurada pode ser abortada) e do servidor (`rev`, 409, pools de
PNG por processo). Tempo em tiques que só avançam com nada em voo; idades saturam; `MaxDraw` limita os desenhos.
As bandeiras `Fix*` ligam cada correção proposta; tudo `TRUE` é o modelo "seguro", e `FixToken=FALSE` reproduz
o defeito antigo.

Invariantes: `TypeOK`, `NoOrphanServer`, `SingleServer`, `TimerDiscipline`, `LatestWins`, `NoSpuriousFailure`,
`NoStaleFileShown`, `ToastOnce`, `NoToastWithFrame`, `NoRelaunchLoop`, `HoverNeverStale`, `HoverRevFresh`,
`NoDrawWhileResizing`, `NoHotAfterStop`, `FramesBounded`. Vivacidade escrita (`EventuallyShows`,
`ScrollConverges`, `HoldReleases`) mas ainda não rodada.

| Config | Constantes | Resultado do TLC |
| --- | --- | --- |
| `PanelLifecycle.cfg` (seguro, núcleo) | 2 páginas, 1 troca, 1 queda, 1 erro, 1 aborto, sem rolagem/redimensionamento | sem violação; 2 712 633 gerados, 1 176 349 distintos, 15 s |
| `PanelLifecycle_scroll.cfg` (seguro, rolagem e recorte) | 1 troca de página, 1 roda, 1 queda | sem violação; 3 236 783 gerados, 1 225 346 distintos, 13 s |
| `PanelLifecycle_oldtoken.cfg` (`FixToken=FALSE`, bug antigo) | 2 trocas | `NoSpuriousFailure` violado em 1 s: a resposta superada de um desenho de mesma chave é tomada pelo desenho corrente |
| `PanelLifecycle_pool.cfg` | pool de hover 4, cache 2 | violação esperada de `NoStaleFileShown` (a folga real é 64 contra 48; ver relatório); rodada antes da bandeira `FixRevServer` |
| `PanelLifecycle_hover.cfg`, `_resize.cfg`, `_abort.cfg` (seguros) | hover com 1 ato; rajada de 2 redimensionamentos; 3 abortos com `ColdNoWait=FALSE` | NÃO concluíram: passaram de 12 milhões de estados distintos em 150 a 250 s sem achar violação; ficam como ponto de partida |

Para rodar uma config: `$JAVA -XX:+UseParallelGC -cp ~/.local/opt/tla2tools.jar tlc2.TLC -workers auto -config <cfg> PanelLifecycle.tla`.

## O que fica fora

- HTML gerado, Chromium, terminal, rede: só o que passa pelo contrato (arquivos, respostas, erros).
- Texto vira `List Char`, pixels vira `Int`; `Math.round` e a divisão são feitas em inteiros (exato para posições e células inteiras; com `cellHeight` fracionário a prova vale por analogia, não por teorema).
- `Date.now` vira idade saturada em tiques; as operações assíncronas não ocupam tempo.
- O recorte (`/clip`) é uma etapa atômica no modelo TLA+; a ordem de chegada dos pedidos ao servidor é FIFO.
- A estimativa de altura (`estimateHeight`) não é a altura real do DOM; o servidor ainda corta em 8000.
- O pane não exporta `scrollPx`/`gridOf`: o teste confere a fórmula por cópia, e a grade pelos pedidos reais de `/render`.
