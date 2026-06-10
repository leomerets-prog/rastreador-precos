# Design: Dashboard rastreador de preços e cupons

**Data:** 2026-06-10
**Status:** aprovado em conversa; aguardando revisão final do spec escrito

## Visão geral

Dashboard pessoal que acompanha o melhor preço e cupons/promoções de produtos de uma
lista de desejos (exemplo inicial: Tablet Lenovo IdeaTab 4GB 128GB WiFi com caneta e
case, azul — ASIN Amazon `B0FN4BK3V7`). Roda 100% de graça na nuvem:

- **GitHub Actions** coleta os preços em horários agendados, mesmo com o PC do usuário desligado.
- Os dados ficam versionados em arquivos JSON no próprio repositório.
- **GitHub Pages** serve o dashboard como página web estática, acessível de qualquer dispositivo.
- **Resend** envia email quando um produto atinge o preço-alvo ou um novo mínimo histórico.

Prioridade é função, não estética: HTML/CSS/JS puro, sem framework.

## Objetivos

1. Mostrar, por produto: melhor preço atual (com loja e link de compra), comparação com o
   preço-alvo, histórico de preços e cupons/promoções recentes relacionados.
2. Atualizar sozinho a cada ~3 horas sem nenhuma ação do usuário.
3. Avisar por email quando valer a pena comprar.
4. Adicionar produto novo deve ser simples: editar um único arquivo (`products.json`).

## Não-objetivos (por enquanto)

- Adicionar produtos pela interface do dashboard (exigiria backend/autenticação).
- Outras lojas além das fontes da v1 (Magalu, KaBuM, Zoom/Buscapé ficam para depois).
- App mobile, login, multiusuário.

## Fontes da v1

| Fonte | O que coleta | Como |
|---|---|---|
| Amazon BR | Preço do produto exato (via URL/ASIN em `products.json`) | Fetch da página do produto com headers de navegador + retries |
| Mercado Livre | Menores preços de anúncios relevantes | Busca por palavras-chave na listagem pública, ordenada por preço |
| Pelando | Promoções e cupons relacionados | Página de busca pública (parse do HTML/JSON embutido) |
| Promobit | Promoções e cupons relacionados | Página de busca pública (parse do HTML/JSON embutido) |

**Filtro de relevância** (evita confundir capinha/película com o produto): o título do
anúncio precisa conter todos os `termosObrigatorios` e o preço precisa estar dentro de
`[precoMin, precoMax]` definidos por produto.

## Arquitetura e layout do repositório

Repositório **público** no GitHub (requisito do Pages grátis). O usuário está ciente de
que a lista de produtos e preços-alvo fica visível publicamente. O email do usuário e a
API key do Resend ficam em **secrets** do repositório, nunca em arquivos.

```
/
├── .github/workflows/track.yml      # cron a cada 3h + execução manual
├── products.json                    # lista de desejos (editada pelo usuário)
├── scraper/
│   ├── package.json                 # Node 22, dependência: cheerio
│   ├── index.js                     # orquestrador da coleta
│   ├── sources/
│   │   ├── amazon.js
│   │   ├── mercadolivre.js
│   │   ├── pelando.js
│   │   └── promobit.js
│   ├── alert.js                     # regras de alerta + envio via Resend
│   └── test/
│       ├── fixtures/                # HTML real salvo de cada site
│       └── parsers.test.js          # node:test sobre os fixtures
└── docs/                            # raiz do GitHub Pages
    ├── index.html                   # dashboard
    ├── app.js
    ├── style.css
    ├── data/
    │   ├── latest.json              # snapshot da última coleta
    │   ├── history.json             # série histórica de menor preço
    │   └── state.json               # controle de alertas já enviados
    └── superpowers/specs/           # este documento
```

Cada fonte é um módulo isolado com a mesma interface:
`buscar(produto) -> { ofertas: [...], erro?: string }`. Dá pra entender, testar e
consertar uma fonte sem tocar nas outras.

## Esquemas de dados

### `products.json` (entrada, editada pelo usuário)

```json
{
  "products": [
    {
      "id": "tablet-lenovo-ideatab",
      "nome": "Tablet Lenovo IdeaTab 4GB 128GB WiFi + caneta + case (azul)",
      "palavrasChave": "tablet lenovo ideatab 128gb caneta",
      "termosObrigatorios": ["lenovo", "128"],
      "precoAlvo": 800,
      "precoMin": 400,
      "precoMax": 2000,
      "amazonUrl": "https://www.amazon.com.br/dp/B0FN4BK3V7"
    }
  ]
}
```

- `amazonUrl` é opcional; sem ele a fonte Amazon é pulada para o produto.
- `precoAlvo` inicial será definido na implementação a partir do preço corrente real;
  o usuário ajusta depois.

### `docs/data/latest.json` (saída, snapshot)

```json
{
  "geradoEm": "2026-06-10T18:00:00Z",
  "produtos": {
    "tablet-lenovo-ideatab": {
      "melhorOferta": { "fonte": "mercadolivre", "loja": "Loja X", "preco": 849.0, "titulo": "...", "url": "..." },
      "ofertas": [ { "fonte": "...", "preco": 0, "titulo": "...", "url": "...", "cupom": null } ],
      "promocoes": [ { "fonte": "pelando", "titulo": "...", "preco": 0, "url": "...", "quente": true } ],
      "fontes": {
        "amazon": { "ok": true, "erro": null },
        "mercadolivre": { "ok": true, "erro": null },
        "pelando": { "ok": true, "erro": null },
        "promobit": { "ok": false, "erro": "timeout" }
      }
    }
  }
}
```

### `docs/data/history.json` (saída, série temporal)

Por produto, uma lista de `{ "em": "ISO-8601", "preco": 849.0, "fonte": "mercadolivre" }`
com o menor preço válido de cada rodada. Limitada às 2000 entradas mais recentes por
produto (~8 meses a 8 coletas/dia).

### `docs/data/state.json` (controle de alertas)

Por produto: `{ "menorHistorico": 849.0, "ultimoAlertaPreco": 849.0, "ultimoAlertaEm": "ISO-8601" }`.

## Fluxo de uma rodada de coleta

1. Cron do Actions (a cada 3h) ou disparo manual inicia o job.
2. `scraper/index.js` lê `products.json` e roda as 4 fontes por produto, em sequência,
   com timeout individual. Falha de uma fonte não interrompe as demais (`try/catch` por fonte).
3. Aplica filtro de relevância e faixa de preço; calcula a melhor oferta por produto.
4. Escreve `latest.json`, acrescenta em `history.json`.
5. `alert.js` avalia as regras de alerta e envia email via API do Resend se necessário;
   atualiza `state.json`.
6. O workflow commita e faz push dos JSONs alterados. O Pages atualiza automaticamente.

## Regras de alerta (email via Resend)

Email é enviado quando, para algum produto:

- **Alvo atingido:** menor preço atual ≤ `precoAlvo` **e** (nunca alertou antes **ou**
  preço atual < último preço alertado − R$ 1). Evita repetir email a cada rodada com o
  mesmo preço.
- **Novo mínimo histórico:** menor preço atual fica ≥ 2% abaixo do `menorHistorico`
  registrado. Também deduplicado via `state.json`.

Conteúdo do email: nome do produto, preço, loja, link de compra e link do dashboard.
Envio por `POST https://api.resend.com/emails` com `RESEND_API_KEY` (secret) e
destinatário `ALERT_EMAIL` (secret). No plano grátis sem domínio próprio, o remetente é
`onboarding@resend.dev` e o destinatário deve ser o email da própria conta Resend —
adequado ao caso de uso pessoal. Falha no envio de email não derruba a coleta (logada no
workflow apenas).

## Dashboard (GitHub Pages)

- `docs/index.html` + `app.js` + `style.css`, sem dependências. Textos em pt-BR.
- Busca `data/latest.json` e `data/history.json` por caminho relativo (mesma origem,
  sem CORS) e re-busca a cada 5 minutos se a aba ficar aberta.
- Por produto, um card com:
  - Melhor preço atual em destaque + loja + botão "Comprar".
  - Indicador do alvo: "R$ 51 acima do alvo" / "✓ Abaixo do alvo!".
  - Mínimo histórico e gráfico de linha simples do histórico (SVG inline, sem lib).
  - Lista das demais ofertas e das promoções/cupons do Pelando/Promobit com links.
- Rodapé do card: hora da última coleta + badge por fonte (ok / falhou — "preço da
  Amazon de 12h atrás" quando estiver usando dado antigo).
- Cabeçalho: link "Editar lista de produtos" (editor web do GitHub para `products.json`)
  e link "Atualizar agora" (página do workflow no Actions, botão *Run workflow*).

## Workflow do GitHub Actions

- `schedule: cron '17 */3 * * *'` (minuto deslocado para fugir da congestão dos horários
  cheios; o cron do Actions pode atrasar alguns minutos — aceitável) + `workflow_dispatch`.
- Passos: checkout → setup Node 22 → `npm ci` → rodar scraper → commit/push dos JSONs
  (só se houver mudança). `permissions: contents: write`.
- O workflow só dispara por schedule/dispatch (não por push), então o push dos dados não
  gera loop.

## Tratamento de erros

- **Fonte isolada:** exceção em uma fonte vira `fontes.<nome>.erro` no `latest.json`;
  as outras seguem. O dashboard exibe a falha — o usuário percebe quando um parser
  quebrar por mudança de layout.
- **Amazon de IP de datacenter:** risco conhecido de bloqueio (503/captcha).
  Mitigações: 3 tentativas com backoff (5s/15s), rotação de 2–3 user-agents de
  navegador real, `Accept-Language: pt-BR`. Se falhar, o dashboard mantém o último
  preço conhecido da Amazon (vindo do histórico) com aviso de idade do dado.
- **Resultados irrelevantes:** filtro por `termosObrigatorios` + `precoMin`/`precoMax`.
- **Email:** falha no Resend não aborta a rodada; `state.json` só é atualizado após
  envio bem-sucedido (para reenviar na próxima rodada).

## Testes

- `node --test` em `scraper/test/parsers.test.js`: cada parser processa um fixture de
  HTML real salvo do site e deve extrair título/preço/URL esperados.
- Verificação ponta a ponta manual antes de ativar o cron: uma rodada completa via
  `workflow_dispatch`, conferindo JSONs gerados, dashboard no Pages e um email de teste.

## Pré-requisitos do usuário (~10 min, guiado)

1. Conta no GitHub + `gh auth login` nesta máquina (necessário para criar o repo e os secrets).
2. Conta no Resend + criar API key; será gravada como secret `RESEND_API_KEY` junto com
   `ALERT_EMAIL`.

## Riscos e observações

- **Mudança de layout dos sites** quebra parsers — mitigado por módulos isolados,
  fixtures de teste e visibilidade da falha no dashboard.
- **Bloqueio da Amazon** — mitigado conforme acima; ML/Pelando/Promobit cobrem o buraco.
  Se o bloqueio se mostrar constante na prática, considerar como evolução obter o preço
  da Amazon via um comparador (Zoom/Buscapé).
- **Repo público** — lista de desejos visível; email e API key protegidos em secrets.
- **Pasta local dentro do OneDrive** — pode gerar ruído de sincronização com `.git`,
  mas a fonte de verdade é o GitHub; risco aceito.
