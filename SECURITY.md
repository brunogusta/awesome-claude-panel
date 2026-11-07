# Segurança / Security

Se achar uma vulnerabilidade, **não abra uma issue pública**. Use o relatório privado do GitHub:
**Security → Report a vulnerability** neste repositório.

If you find a vulnerability, please do not open a public issue. Use GitHub's private reporting:
**Security → Report a vulnerability** on this repository.

O que o painel faz na sua máquina: roda um servidor local num socket unix (sem abrir porta de rede), controla um Chromium headless que só abre HTML gerado pelo próprio plugin e grava imagens temporárias em `/dev/shm`. Detalhes em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
