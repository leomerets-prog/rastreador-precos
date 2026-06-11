// Dashboard: lê data/latest.json + data/history.json e renderiza os cards.
const fmtBRL = (n) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const NOMES_FONTES = {
  amazon: "Amazon",
  mercadolivre: "Mercado Livre",
  zoom: "Zoom",
  buscape: "Buscapé",
  pelando: "Pelando",
  promobit: "Promobit",
};

function tempoRelativo(iso) {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

// Links do repositório no GitHub. Em <user>.github.io/<repo>/ são deduzidos da URL;
// em qualquer outro host (ex.: Vercel) caem para o repositório fixo abaixo.
const REPO_FIXO = "leomerets-prog/rastreador-precos";
function linksRepo() {
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/);
  const repoPath = m ? `${m[1]}/${location.pathname.split("/").filter(Boolean)[0]}` : REPO_FIXO;
  if (!repoPath || repoPath.endsWith("/undefined")) return null;
  const base = `https://github.com/${repoPath}`;
  return { editar: `${base}/edit/main/products.json`, rodar: `${base}/actions/workflows/track.yml` };
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function sparkline(historico, precoAlvo) {
  if (!historico || historico.length < 2) return "";
  const W = 600, H = 60, PAD = 4;
  const precos = historico.map((p) => p.preco);
  let min = Math.min(...precos, precoAlvo ?? Infinity);
  let max = Math.max(...precos, precoAlvo ?? -Infinity);
  if (max - min < 1) { min -= 1; max += 1; }
  const x = (i) => PAD + (i * (W - 2 * PAD)) / (historico.length - 1);
  const y = (p) => H - PAD - ((p - min) * (H - 2 * PAD)) / (max - min);
  const pontos = historico.map((p, i) => `${x(i).toFixed(1)},${y(p.preco).toFixed(1)}`).join(" ");
  const linhaAlvo =
    precoAlvo != null
      ? `<line class="alvo-linha" x1="0" x2="${W}" y1="${y(precoAlvo).toFixed(1)}" y2="${y(precoAlvo).toFixed(1)}"/>`
      : "";
  return `<svg class="sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${linhaAlvo}<polyline points="${pontos}"/>
    <text x="${PAD}" y="11">${fmtBRL(max)}</text><text x="${PAD}" y="${H - 6}">${fmtBRL(min)}</text>
  </svg>`;
}

function itemOferta(o, melhorUrl) {
  const cupom = o.cupom ? ` <span class="cupom">cupom: ${esc(o.cupom)}</span>` : "";
  const velho = o.desatualizado ? ` <span class="tag-velho">⚠ coleta antiga</span>` : "";
  const loja = o.loja ?? NOMES_FONTES[o.fonte] ?? o.fonte;
  return `<li>
    <span class="preco-mini">${fmtBRL(o.preco)}</span>
    <a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.titulo)}</a>
    <span class="badge">${esc(loja)}</span>${cupom}${velho}
  </li>`;
}

function cardProduto(id, p, historico) {
  const cfg = p.config ?? {};
  const melhor = p.melhorOferta;
  const minHist = historico?.length ? Math.min(...historico.map((h) => h.preco)) : null;

  let blocoMelhor;
  if (melhor) {
    const abaixo = cfg.precoAlvo != null && melhor.preco <= cfg.precoAlvo;
    const alvoTxt =
      cfg.precoAlvo == null
        ? ""
        : abaixo
          ? `<span class="ok">✓ abaixo do alvo de ${fmtBRL(cfg.precoAlvo)}!</span>`
          : `<span class="falta">${fmtBRL(melhor.preco - cfg.precoAlvo)} acima do alvo de ${fmtBRL(cfg.precoAlvo)}</span>`;
    blocoMelhor = `
      <div class="melhor">
        <span class="preco ${abaixo ? "abaixo-alvo" : ""}">${fmtBRL(melhor.preco)}</span>
        <span class="loja">${esc(melhor.loja ?? NOMES_FONTES[melhor.fonte])}${melhor.cupom ? ` · <span class="cupom">cupom: ${esc(melhor.cupom)}</span>` : ""}${melhor.desatualizado ? ` <span class="tag-velho">⚠ preço de coleta antiga (${tempoRelativo(melhor.coletadoEm)})</span>` : ""}</span>
        <a class="btn-comprar" href="${esc(melhor.url)}" target="_blank" rel="noopener">Comprar</a>
      </div>
      <p class="alvo">${alvoTxt}<span class="minimo">mínimo registrado: ${fmtBRL(minHist)}</span></p>`;
  } else {
    blocoMelhor = `<p class="sem-oferta">Nenhuma oferta válida na última coleta.</p>`;
  }

  const outras = (p.ofertas ?? []).filter((o) => o.url !== melhor?.url);
  const promos = p.promocoes ?? [];
  const badges = Object.entries(p.fontes ?? {})
    .map(([nome, f]) => {
      if (f.pulada) return "";
      const cls = f.ok ? "ok" : "falha";
      const extra = f.ok ? "" : ` — falhou${f.ultimoOkEm ? `, dado ${tempoRelativo(f.ultimoOkEm)}` : ""}`;
      return `<span class="badge ${cls}" title="${esc(f.erro ?? "ok")}">${NOMES_FONTES[nome] ?? nome}${extra}</span>`;
    })
    .join("");

  return `<section class="card">
    <h2>${esc(cfg.nome ?? id)}</h2>
    ${blocoMelhor}
    ${sparkline(historico, cfg.precoAlvo)}
    ${outras.length ? `<details open><summary>Outras ofertas (${outras.length})</summary><ul class="lista">${outras.map((o) => itemOferta(o)).join("")}</ul></details>` : ""}
    ${promos.length
      ? `<details open><summary>Promoções e cupons relacionados (${promos.length})</summary><ul class="lista">${promos.map((o) => itemOferta(o)).join("")}</ul></details>`
      : `<p class="aviso" style="font-size:.85rem">Nenhuma promoção/cupom relacionado no Pelando/Promobit agora — eles aparecem aqui quando surgirem.</p>`}
    <div class="fontes">${badges}</div>
  </section>`;
}

async function carregar() {
  try {
    const cb = `?t=${Date.now()}`;
    const [latest, history] = await Promise.all([
      fetch(`data/latest.json${cb}`).then((r) => r.json()),
      fetch(`data/history.json${cb}`).then((r) => r.json()).catch(() => ({})),
    ]);
    document.getElementById("ultima-coleta").textContent =
      `última coleta: ${tempoRelativo(latest.geradoEm)} (${new Date(latest.geradoEm).toLocaleString("pt-BR")})`;
    const cards = Object.entries(latest.produtos ?? {})
      .map(([id, p]) => cardProduto(id, p, history[id]))
      .join("");
    document.getElementById("cards").innerHTML =
      cards || `<p class="aviso">Nenhum produto configurado. Adicione em products.json.</p>`;
  } catch (e) {
    document.getElementById("cards").innerHTML =
      `<p class="aviso">Não consegui carregar os dados (${esc(e.message)}). A primeira coleta já rodou?</p>`;
  }
}

const links = linksRepo();
if (links) {
  document.getElementById("links-repo").hidden = false;
  document.getElementById("link-editar").href = links.editar;
  document.getElementById("link-rodar").href = links.rodar;
}
carregar();
setInterval(carregar, 5 * 60 * 1000);
