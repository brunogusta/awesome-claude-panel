# Arquitetura

O painel é uma **página HTML/CSS fotografada** por um Chromium headless e mostrada no terminal como **imagem**
(protocolo gráfico do kitty, que o Ghostty implementa). O plugin sabe onde cada botão ficou na página, então
transforma cliques e hover em ações.

```
sessão do Claude Code
  eventos (tool.call, turn.*) ──► hooks/core/*  (o que foi tocado, git, diff, árvore)
                                      │ átomos de estado
                                      ▼
                           hooks/page/page.ts  ──►  HTML + CSS  (+ posição de cada botão)
                                      │
            hooks/pane.tsx  ◄─ POST ──┴─► renderer/server.mjs  ──►  Chromium headless
              │  (socket unix)              /render /clip /hover           │ PNG em /dev/shm
              ▼                                                            │
        <Image source={file}>  ◄───────────────────────────────────────────┘
        <Client overlay>  ── ponteiro (clique, hover, região) ──► plugin
```

## Peças

| Pasta | Papel |
| --- | --- |
| `hooks/register.tsx` | Registra o comando `/panel`, os hooks (`ui.render`, `ui.message`, `ui.scroll`, `ui.fault`, `tool.call`, turnos, sessão). |
| `hooks/core/` | Estado e dados: `activity` (o que o Claude tocou), `git`, `diff`, `tree`, `editors`, `cache`, `trace` (log). |
| `hooks/page/` | `page.ts` monta o HTML; `style.ts` é o CSS; `icons.ts` os ícones SVG próprios; `format.ts` utilidades de texto. |
| `hooks/pane.tsx` | Ciclo de vida do desenho: tamanho, espera de calma, desenho, fatias de rolagem, quadro mostrado. |
| `hooks/hover.ts` | Quadros de destaque prontos e troca da imagem sem refazer a árvore. |
| `hooks/smooth.ts` | Matemática da rolagem suave. |
| `hooks/render/` | `renderer.ts` fala com o servidor; `overlay.tsx` é a camada que recebe o ponteiro. |
| `renderer/server.mjs` | Servidor Node que controla o Chromium pelo DevTools Protocol. |
| `formal/` | Provas em Lean 4 e modelo TLA+. |
| `scripts/` | `doctor.mjs` (requisitos), `panel-log.mjs` (resumo do log), `check-version.mjs`, `screenshots.ts`. |

## Decisões que importam

- **Um desenho por tamanho, não por pixel.** Ao redimensionar, o painel espera 150 ms de calma (no máximo 700 ms) e desenha uma vez no tamanho final. Enquanto isso mostra o quadro antigo no próprio tamanho.
- **Grade de pixels com teto.** Cada célula vale 13×28 px (configurável). A imagem tem no máximo 255 colunas e 255 linhas (limite do Claude Code) e a densidade cai para manter ~1,5 milhão de pixels (nos extremos de 255×255 colunas e linhas, os pisos de 4×8 px por célula deixam chegar a ~2,1 milhões, provado em `formal/lean`); o terminal estica a imagem.
- **Cada desenho tem um número próprio.** Um pedido superado por outro mais novo é descartado e refeito, nunca tratado como falha. O Claude Code derruba a chamada de rede de um desenho quando chega outro.
- **Largada a frio sem esperar.** A primeira chamada que lança o servidor não fica pendurada esperando o PNG; senão o Claude Code a aborta junto com o servidor.
- **Hover sem Chromium no caminho quente.** O servidor marca o elemento direto na página já carregada (`/hover`), o plugin guarda o quadro (até 48) e troca a imagem com `$.ui.blit`. Os quadros dos itens visíveis são gerados em segundo plano 250 ms depois do desenho.
- **Rolagem em pixels.** A roda soma um alvo; um laço anda até ele por passos decrescentes, pedindo uma fatia nova (`/clip`) e trocando a imagem a cada passo. O hover fica suspenso durante a animação.
- **Imagem com chave por tamanho** (`page-92x37`): ao mudar o tamanho o terminal recoloca a imagem em vez de reaproveitar a posição antiga.
- **Revisão da página (`rev`).** Cada `/render` devolve um número; `/hover` com revisão velha responde `409`. Assim um destaque de uma página que já mudou nunca é mostrado.
- **Arquivos temporários limitados.** O servidor guarda só os 2 últimos PNGs de desenho e os 64 últimos de destaque, em `/dev/shm` (modo `0600`); ao subir, apaga os de donos mortos e antigos.
- **Idle.** Depois de 2 minutos sem uso o Chromium desliga e o último quadro continua na tela.

## Regras do motor do Claude Code que o código respeita

- `$` nunca é guardado em variável: só passa para funções declaradas com `function` ou é chamado como `$.coisa.metodo(...)`.
- `$.env.get` recebe o nome literal da variável.
- Cada átomo de estado é declarado no mesmo arquivo que o lê (`hooks/pane.tsx`, `hooks/actions.ts`, `hooks/core/state.ts`) com a mesma referência e forma; `tests/atoms.test.ts` confere.
- `Image` aceita no máximo 255 colunas/linhas; `Client` não desenha imagem; o hover nativo só muda estilo.

## Segurança e privacidade

- Tudo roda na sua máquina. O servidor escuta num **socket unix** em `$TMPDIR/claude-<uid>/`; nenhum porto de rede é aberto pelo plugin.
- O Chromium roda com `--no-sandbox` (comum em contêineres e WSL) e só abre HTML gerado pelo próprio plugin, com todo texto de arquivo escapado (`esc`, provado em Lean).
- O log (`~/.cache/panel/debug.log`) guarda nomes de arquivos tocados e comandos resumidos; fica só no seu disco.

## Testes e verificação

- `claude plugin test .`: testes do plugin, incluindo passeios aleatórios (redimensionar, hover, clique, parada por ociosidade) e a conformidade com as definições formais.
- `tests/server.check.mjs` e `tests/scenarios.check.mjs`: o servidor com o Chromium de verdade (rajadas, tamanhos extremos, página gigante, memória, Chromium morto no meio).
- `formal/lean`: funções puras (acerto de clique, escape, atos, rolagem, altura, grade, cache de hover, "não visto", fila do log).
- `formal/tla`: o ciclo de vida (processos, tokens, abortos, espera de calma).
