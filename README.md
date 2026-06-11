# 💸 Rastreador de Preços e Cupons

Dashboard pessoal que acompanha o melhor preço e as promoções/cupons de produtos de uma
lista de desejos. Roda sozinho e de graça:

- **GitHub Actions** coleta os preços a cada 3 horas (Amazon BR, Mercado Livre, Pelando e Promobit).
- **Vercel** serve o dashboard (pasta [`docs/`](docs/), Root Directory `docs`), republicando a cada push de dados.
- **Resend** envia email quando um produto fica abaixo do preço-alvo ou atinge um novo
  menor preço histórico.

Também monitora **cupons gerais de loja** (campanhas tipo "MEIOCAMPO" da Amazon) via
Cuponomia, num painel separado no topo do dashboard. As lojas monitoradas ficam em
`lojasCupons` no [`products.json`](products.json). Um **vigia de cupons** roda a cada
~15 min (workflow `cupons.yml`) e envia email quando surge um cupom novo nas lojas
marcadas com `"alerta": true` (por padrão Mercado Livre e Amazon, que esgotam rápido).

## Como adicionar/editar produtos

**Pelo dashboard:** botão **➕ Adicionar produto** — preenche nome, preço-alvo, palavras
e a senha de administração. Salva direto no `products.json` (via função no Vercel) e
dispara uma coleta na hora. Requer os secrets `GITHUB_TOKEN` e `ADD_PASSWORD` no Vercel.

**Manualmente:** edite o [`products.json`](products.json) (link "✏️ Editar produtos").
Campos de cada produto:

| Campo | O que é |
|---|---|
| `id` | identificador único, sem espaços (ex.: `tablet-lenovo-ideatab`) |
| `nome` | nome exibido no dashboard |
| `palavrasChave` | termos usados na busca do Mercado Livre |
| `termosObrigatorios` | palavras que o título do anúncio PRECISA conter (filtra capinha/película) |
| `precoAlvo` | preço que dispara o alerta por email |
| `precoMin` / `precoMax` | faixa plausível de preço (descarta acessórios e anúncios errados) |
| `amazonUrl` | link direto do produto na Amazon (opcional) |

## Como força uma atualização agora

Aba **Actions** → workflow **Rastrear preços** → botão **Run workflow**.

## Estrutura

- `scraper/` — coletor em Node.js (sem dependências). Uma fonte falhar não derruba a
  rodada: o dado anterior é mantido e marcado como "coleta antiga" no dashboard.
- `docs/` — dashboard estático + dados (`docs/data/*.json`).
- `.github/workflows/track.yml` — agendamento e commit automático dos dados.

## Testes

```bash
cd scraper && npm test
```

Os parsers são testados contra HTML real salvo em `scraper/test/fixtures/`. Se um site
mudar de layout, a fonte aparece como "falhou" no dashboard — atualize o fixture e o
parser correspondente em `scraper/sources/`.

## Segredos (Settings → Secrets and variables → Actions)

- `RESEND_API_KEY` — chave da API do [Resend](https://resend.com).
- `ALERT_EMAIL` — email que recebe os alertas (no plano grátis do Resend sem domínio
  próprio, deve ser o email da própria conta Resend).
