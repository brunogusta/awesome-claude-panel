# Changelog

Todas as mudanças relevantes deste projeto ficam neste arquivo.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto segue o
[Versionamento Semântico 2.0.0](https://semver.org/lang/pt-BR/).

## [Unreleased]

## [0.1.0] - 2026-11-07

Primeira versão pública. Enquanto a versão for `0.y.z`, qualquer coisa pode mudar entre versões
menores; a API só é considerada estável a partir da `1.0.0`.

### Adicionado
- Comando `/panel`: painel lateral desenhado em HTML/CSS e mostrado como imagem no Ghostty.
- "Agora": o que o Claude está fazendo (lendo, editando, rodando um comando, pronto).
- "Claude mexeu": lista dos arquivos tocados na sessão, com `+N −N`, o arquivo em edição em destaque
  (etiqueta "editando") e uma bolinha laranja nos arquivos alterados que você ainda não viu; ela some ao abrir o diff.
- Diff no estilo do GitHub, com os botões Abrir no editor, Copiar caminho, Mencionar e Mostrar na pasta.
- Árvore do projeto, fechada por padrão, com tamanhos e arquivos ocultos opcionais.
- Hover nos botões e linhas, rolagem suave pela roda do mouse e redimensionamento com espera de calma.
- Opções `cellWidth`, `cellHeight` e `pageScale` (`userConfig`).
- Limites de segurança: imagem de no máximo 255 colunas/linhas e ~1,5 milhão de pixels (até ~2,1 milhões nos tamanhos extremos), página de até 8000 px,
  diff de até 300 linhas.
- Log de diagnóstico em `~/.cache/panel/debug.log` e o script `scripts/panel-log.mjs` para resumi-lo.
- Verificação formal em Lean 4 (`formal/lean`) e testes de conformidade que comparam o código real com as definições.
- Testes de cenário, incluindo passeios aleatórios e desenhos com o Chrome de verdade.

### Limitações conhecidas
- Requer Ghostty ou kitty (imagens pelo protocolo gráfico do kitty). No Windows, só via WSL2.
- Testado em Linux e WSL2 (Ubuntu 24.04). macOS ainda não é suportado.
- O hover tem atraso perceptível (dezenas a centenas de milissegundos): o caminho terminal → Claude Code → imagem tem um piso que o plugin não controla.

[Unreleased]: https://github.com/brunogusta/awesome-claude-panel/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/brunogusta/awesome-claude-panel/releases/tag/v0.1.0
