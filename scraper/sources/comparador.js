import { headersNavegador, UAS_DESKTOP, fetchComRetry, tituloRelevante, precoNaFaixa } from "../lib.js";

// Zoom e Buscapé (mesmo grupo) expõem os resultados no __NEXT_DATA__, em
// props.initialReduxState.hits.hits[]. Cada hit tem name, price e bestOffer.merchantName
// (a loja real: Casas Bahia, Ponto, Extra, Magazine Luiza, KaBuM, Amazon...).
// Parser puro e compartilhado (testável).
export function parseComparador(html, base) {
  const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nd) return { erro: "__NEXT_DATA__ não encontrado" };
  let hits;
  try {
    hits = JSON.parse(nd[1])?.props?.initialReduxState?.hits?.hits;
  } catch {
    return { erro: "__NEXT_DATA__ inválido" };
  }
  if (!Array.isArray(hits) || hits.length === 0) return { erro: "nenhum resultado na página" };

  const ofertas = hits
    .filter((h) => h?.name && typeof h.price === "number" && h.price > 0)
    .map((h) => ({
      titulo: h.name,
      preco: h.price,
      loja: h.bestOffer?.merchantName ?? null,
      url: h.url ? (h.url.startsWith("http") ? h.url : base + h.url) : base,
    }));
  return { ofertas };
}

// Fábrica do módulo de fonte: buscar(produto) -> { ofertas: [...] }
export function criarFonteComparador({ fonte, base, urlBusca }) {
  return {
    async buscar(produto) {
      const url = urlBusca(produto.palavrasChave);
      const html = await fetchComRetry(url, {
        headers: headersNavegador(UAS_DESKTOP[0]),
        validar: (h) => parseComparador(h, base).erro ?? null,
      });
      const r = parseComparador(html, base);
      if (r.erro) throw new Error(r.erro);
      const relevantes = r.ofertas
        .filter((o) => tituloRelevante(o.titulo, produto) && precoNaFaixa(o.preco, produto))
        .sort((a, b) => a.preco - b.preco);
      const vistos = new Set();
      const ofertas = [];
      for (const o of relevantes) {
        const chave = `${o.loja}|${o.preco}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        ofertas.push({ fonte, ...o });
        if (ofertas.length >= 5) break;
      }
      return { ofertas };
    },
  };
}
