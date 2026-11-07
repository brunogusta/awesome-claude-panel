# Contribuindo / Contributing

Obrigado por querer ajudar! / Thanks for helping!

## Fluxo / Flow

1. Faça um **fork** e crie uma branch (`fix/hover-lento`, `feat/macos`).
   Fork the repo and create a branch.
2. Faça a mudança com testes. Rode, na raiz:
   ```bash
   claude plugin test .
   claude plugin validate .
   node --test tests/server.check.mjs tests/scenarios.check.mjs
   ```
3. Descreva a mudança no `CHANGELOG.md`, na seção `[Unreleased]`.
4. Abra um **pull request**. Ninguém envia código direto para a `main`: toda mudança passa por pull request e só entra depois que o mantenedor aprova e faz o merge.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/pt-br/v1.0.0/): `fix:`, `feat:`, `docs:`, `test:`, `refactor:`. Mudança que quebra algo: `feat!:` ou rodapé `BREAKING CHANGE:`.

## Versões

O mantenedor define a versão e cria as tags seguindo o [SemVer](https://semver.org/lang/pt-BR/); veja o `README`, seção "Versionamento". Não altere `version` em `.claude-plugin/plugin.json` no seu PR.

## Privacidade

Não inclua nomes, e-mails, caminhos da sua máquina, logs com dados pessoais nem capturas de tela com informações suas. Ao anexar o log do painel, revise `~/.cache/panel/debug.log` antes: ele lista nomes de arquivos tocados e comandos resumidos.
