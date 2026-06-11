import { UAS_DESKTOP, headersNavegador, fetchComRetry, decodificarEntidades } from "./lib.js";

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

// Busca os cupons de uma loja. `loja` = { slug, nome }.
export async function buscarLoja(loja, limite = 8) {
  const url = `https://www.cuponomia.com.br/desconto/${loja.slug}`;
  const html = await fetchComRetry(url, { headers: headersNavegador(UAS_DESKTOP[0]), tentativas: 2 });
  const r = parseCupons(html);
  if (r.erro) throw new Error(r.erro);
  // prioriza os verificados hoje, preserva a ordem do site dentro de cada grupo
  const ordenados = [...r.cupons].sort((a, b) => Number(b.verificadoHoje) - Number(a.verificadoHoje));
  return { loja: loja.nome, slug: loja.slug, url, cupons: ordenados.slice(0, limite) };
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
