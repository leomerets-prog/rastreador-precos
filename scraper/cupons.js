import { UAS_DESKTOP, headersNavegador, fetchComRetry, decodificarEntidades } from "./lib.js";
import { enviarEmailResend, emailConfigurado } from "./email.js";

// Monitora cupons gerais de loja (campanhas tipo "MEIOCAMPO" da Amazon) via Cuponomia,
// que mantém páginas por loja em /desconto/<slug> com os códigos ativos.

// Um código válido não tem espaços, tem 3–25 chars e não é auto-promo da Cuponomia
// nem um CTA ("Ative o cupom no link").
function codigoValido(c) {
  if (!c || /\s/.test(c)) return false;
  if (c.length < 3 || c.length > 25) return false;
  if (/^cuponomia/i.test(c)) return false;
  return /[A-Z0-9]/.test(c);
}

// Parser puro (testável): extrai os cupons de uma página de loja da Cuponomia.
export function parseCupons(html) {
  // cada cupom é um <li class="item ..."> com título, descrição e código
  const blocos = html.split(/<li class="item[ "]/).slice(1);
  if (blocos.length === 0) return { erro: "nenhum item de cupom na página" };

  const cupons = [];
  const vistos = new Set();
  for (const bloco of blocos) {
    const codigo = decodificarEntidades((bloco.match(/js-itemCode[^>]*>([^<]+)</) || [])[1]);
    if (!codigoValido(codigo) || vistos.has(codigo)) continue;
    vistos.add(codigo);
    const descricao = decodificarEntidades((bloco.match(/class="item-desc"[^>]*>([^<]+)</) || [])[1]) || null;
    const titulo = decodificarEntidades((bloco.match(/js-itemTitle[^>]*>([^<]+)</) || [])[1]) || null;
    const verificadoHoje = /Verificado\s*(?:&nbsp;|\s)*hoje/i.test(bloco);
    cupons.push({ codigo, descricao, titulo, verificadoHoje });
  }
  if (cupons.length === 0) return { erro: "nenhum código de cupom reconhecido" };
  return { cupons };
}

// Busca os cupons de uma loja. `loja` = { slug, nome, alerta? }.
export async function buscarLoja(loja, limite = 8) {
  const url = `https://www.cuponomia.com.br/desconto/${loja.slug}`;
  const html = await fetchComRetry(url, { headers: headersNavegador(UAS_DESKTOP[0]), tentativas: 2 });
  const r = parseCupons(html);
  if (r.erro) throw new Error(r.erro);
  // prioriza os verificados hoje, preserva a ordem do site dentro de cada grupo
  const ordenados = [...r.cupons].sort((a, b) => Number(b.verificadoHoje) - Number(a.verificadoHoje));
  return { loja: loja.nome, slug: loja.slug, alerta: !!loja.alerta, url, cupons: ordenados.slice(0, limite) };
}

// Busca todas as lojas configuradas; falha de uma não derruba as outras.
export async function buscarCupons(lojas, agora) {
  const execs = await Promise.allSettled(lojas.map((l) => buscarLoja(l)));
  const resultado = [];
  for (let i = 0; i < lojas.length; i++) {
    const e = execs[i];
    if (e.status === "fulfilled") {
      resultado.push({ ...e.value, ok: true, em: agora });
    } else {
      resultado.push({
        loja: lojas[i].nome,
        slug: lojas[i].slug,
        alerta: !!lojas[i].alerta,
        url: `https://www.cuponomia.com.br/desconto/${lojas[i].slug}`,
        cupons: [],
        ok: false,
        erro: e.reason?.message ?? String(e.reason),
        em: agora,
      });
    }
  }
  return resultado;
}

const QUINZE_DIAS_MS = 15 * 24 * 60 * 60 * 1000;

// Detecta cupons inéditos e, para lojas com alerta:true, manda UM email com os novos.
// Estado: { codigos: { "slug:CODIGO": { loja, em } } }. Só marca como visto um cupom
// alertável após o email sair (se falhar, re-alerta na próxima). Retorna { novoState, novos }.
export async function alertarCuponsNovos(lojasResultado, state, agora) {
  const novoState = { codigos: { ...(state?.codigos ?? {}) } };
  const novosAlertaveis = [];

  for (const loja of lojasResultado) {
    for (const cupom of loja.cupons ?? []) {
      const chave = `${loja.slug}:${cupom.codigo}`;
      const inedito = !(chave in novoState.codigos);
      if (inedito && loja.alerta) {
        novosAlertaveis.push({ ...cupom, loja: loja.loja, url: loja.url, chave });
      } else {
        // já visto, ou loja sem alerta: registra/atualiza imediatamente
        novoState.codigos[chave] = { loja: loja.loja, em: agora };
      }
    }
  }

  // poda códigos que sumiram há mais de 15 dias (assim, se voltarem, re-alertam)
  const limite = Date.parse(agora) - QUINZE_DIAS_MS;
  for (const [k, v] of Object.entries(novoState.codigos)) {
    if (v.em && Date.parse(v.em) < limite) delete novoState.codigos[k];
  }

  if (novosAlertaveis.length === 0) return { novoState, novos: [] };

  if (!emailConfigurado()) {
    // sem Resend: marca como visto para não disparar uma enxurrada quando configurar
    for (const c of novosAlertaveis) novoState.codigos[c.chave] = { loja: c.loja, em: agora };
    return { novoState, novos: novosAlertaveis, enviado: false };
  }

  try {
    await enviarEmailCupons(novosAlertaveis);
    for (const c of novosAlertaveis) novoState.codigos[c.chave] = { loja: c.loja, em: agora };
    return { novoState, novos: novosAlertaveis, enviado: true };
  } catch (e) {
    // não marca como visto: tenta de novo na próxima rodada
    console.error(`Cupons: falha ao enviar email: ${e.message}`);
    return { novoState: state ?? { codigos: {} }, novos: novosAlertaveis, enviado: false };
  }
}

async function enviarEmailCupons(novos) {
  const dashboardUrl = process.env.DASHBOARD_URL ?? "";
  const linhas = novos.map(
    (c) =>
      `<li style="margin-bottom:8px"><strong>${c.loja}</strong> — <code style="background:#f4e3a1;padding:2px 6px;border-radius:4px;font-size:1.1em">${c.codigo}</code>${c.verificadoHoje ? " ✓ verificado hoje" : ""}<br><span style="color:#555">${c.descricao ?? ""}</span> <a href="${c.url}">ver</a></li>`
  );
  const titulo =
    novos.length === 1
      ? `🎟️ Novo cupom ${novos[0].loja}: ${novos[0].codigo}`
      : `🎟️ ${novos.length} novos cupons (${[...new Set(novos.map((c) => c.loja))].join(", ")})`;
  const html = [
    `<h2>Cupons novos</h2><ul style="list-style:none;padding:0">`,
    ...linhas,
    `</ul>`,
    dashboardUrl ? `<p><a href="${dashboardUrl}">Abrir dashboard</a></p>` : "",
    `<p style="color:#999;font-size:.85em">⚠️ Cupons de loja esgotam rápido — corra!</p>`,
  ].join("\n");
  await enviarEmailResend({ subject: titulo, html });
}
