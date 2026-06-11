// Orquestrador: roda as fontes para cada produto, grava os JSONs do
// dashboard e dispara os alertas. Falha de uma fonte não derruba a rodada.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as amazon from "./sources/amazon.js";
import * as mercadolivre from "./sources/mercadolivre.js";
import * as zoom from "./sources/zoom.js";
import * as buscape from "./sources/buscape.js";
import * as pelando from "./sources/pelando.js";
import * as promobit from "./sources/promobit.js";
import { precoNaFaixa } from "./lib.js";
import { processarAlertas } from "./alert.js";
import { buscarCupons, alertarCuponsNovos } from "./cupons.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(raiz, "docs", "data");

// Tolerância antes de uma fonte ser marcada como "dado velho" no dashboard. As coletas
// (nuvem + PC) rodam a cada 3h e se intercalam, então 6h cobre uma falha pontual sem
// rebaixar o dado de quem coletou por último.
const STALE_MS = 6 * 60 * 60 * 1000;

// amazon/ml/zoom/buscape entregam preço de loja (entram na melhor oferta);
// pelando/promobit entregam promoções/cupons relacionados.
const FONTES = { amazon, mercadolivre, zoom, buscape, pelando, promobit };

function lerJson(arquivo, padrao) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, "utf8"));
  } catch {
    return padrao;
  }
}

async function coletarProduto(produto, anterior, agora) {
  // config embutida para o dashboard (products.json da raiz não é servido pelo Pages)
  const resultado = {
    config: {
      nome: produto.nome,
      precoAlvo: produto.precoAlvo,
      precoMin: produto.precoMin,
      precoMax: produto.precoMax,
      palavrasChave: produto.palavrasChave,
    },
    ofertas: [],
    promocoes: [],
    fontes: {},
  };

  const execucoes = await Promise.allSettled(
    Object.entries(FONTES).map(async ([nome, mod]) => [nome, await mod.buscar(produto)])
  );

  for (let i = 0; i < execucoes.length; i++) {
    const nome = Object.keys(FONTES)[i];
    const exec = execucoes[i];
    if (exec.status === "fulfilled") {
      const [, r] = exec.value;
      if (r.pulada) {
        resultado.fontes[nome] = { ok: true, pulada: true, em: agora };
        continue;
      }
      const novas = (r.ofertas ?? []).map((o) => ({ ...o, coletadoEm: agora }));
      const promos = (r.promocoes ?? []).map((o) => ({ ...o, coletadoEm: agora }));
      resultado.ofertas.push(...novas);
      resultado.promocoes.push(...promos);
      resultado.fontes[nome] = { ok: true, em: agora, ultimoOkEm: agora };
    } else {
      const erro = exec.reason?.message ?? String(exec.reason);
      // Merge por fonte: uma falha NÃO rebaixa um dado recente coletado por outra
      // rodada (ex.: nuvem falha ML/Zoom, mas o PC os pegou há pouco). Mantém o
      // último sucesso, preservando seu horário, e só marca "velho" após STALE_MS.
      const ultimoOkEm = anterior?.fontes?.[nome]?.ultimoOkEm ?? null;
      const idadeMs = ultimoOkEm ? Date.parse(agora) - Date.parse(ultimoOkEm) : Infinity;
      const fresco = idadeMs < STALE_MS;
      const antigasOfertas = (anterior?.ofertas ?? []).filter((o) => o.fonte === nome);
      const antigasPromos = (anterior?.promocoes ?? []).filter((o) => o.fonte === nome);
      resultado.ofertas.push(...antigasOfertas.map((o) => ({ ...o, desatualizado: !fresco })));
      resultado.promocoes.push(...antigasPromos.map((o) => ({ ...o, desatualizado: !fresco })));
      resultado.fontes[nome] = { ok: fresco, erro, em: agora, ultimoOkEm };
      console.error(`  [${produto.id}] fonte ${nome} falhou: ${erro}${fresco ? " (usando dado recente de outra coleta)" : ""}`);
    }
  }

  // Zoom e Buscapé (mesmo grupo) frequentemente repetem a mesma oferta loja+preço;
  // remove duplicatas mantendo a primeira, para a listagem não ficar redundante
  const chaveOferta = (o) => `${(o.loja ?? o.fonte).toLowerCase()}|${o.preco}|${o.titulo}`;
  const vistasOfertas = new Set();
  resultado.ofertas = resultado.ofertas.filter((o) => {
    const k = chaveOferta(o);
    if (vistasOfertas.has(k)) return false;
    vistasOfertas.add(k);
    return true;
  });

  // melhor oferta: lojas diretas + promoções do Promobit com preço estruturado,
  // sempre dentro da faixa de preço plausível; prefere dado fresco, mas cai para o
  // último conhecido (marcado como desatualizado) se todas as fontes de preço falharem
  const candidatas = [
    ...resultado.ofertas,
    ...resultado.promocoes.filter((p) => p.fonte === "promobit" && p.preco != null),
  ].filter((o) => precoNaFaixa(o.preco, produto));
  const frescas = candidatas.filter((o) => !o.desatualizado);
  resultado.melhorOferta = (frescas.length ? frescas : candidatas).sort((a, b) => a.preco - b.preco)[0] ?? null;
  return resultado;
}

async function main() {
  const agora = new Date().toISOString();
  const { products, lojasCupons = [] } = JSON.parse(fs.readFileSync(path.join(raiz, "products.json"), "utf8"));
  const latestAnterior = lerJson(path.join(dataDir, "latest.json"), { produtos: {} });
  const history = lerJson(path.join(dataDir, "history.json"), {});
  const state = lerJson(path.join(dataDir, "state.json"), {});

  const latest = { geradoEm: agora, produtos: {} };
  for (const produto of products) {
    console.log(`Coletando: ${produto.nome}`);
    latest.produtos[produto.id] = await coletarProduto(produto, latestAnterior.produtos?.[produto.id], agora);
    const melhor = latest.produtos[produto.id].melhorOferta;
    console.log(melhor ? `  melhor: R$ ${melhor.preco} (${melhor.fonte})` : "  nenhuma oferta válida nesta rodada");

    // histórico só recebe preço fresco — e só quando muda, para não inflar com pontos
    // repetidos a cada rodada (várias coletas/dia republicam o mesmo melhor preço)
    if (melhor && !melhor.desatualizado) {
      const serie = (history[produto.id] ??= []);
      if (serie.length === 0 || serie[serie.length - 1].preco !== melhor.preco) {
        serie.push({ em: agora, preco: melhor.preco, fonte: melhor.fonte });
        if (serie.length > 2000) history[produto.id] = serie.slice(-2000);
      }
    }
  }

  // cupons gerais de loja (campanhas tipo "MEIOCAMPO"), independentes de produto
  let cupons = { geradoEm: agora, lojas: [] };
  if (lojasCupons.length) {
    console.log(`Buscando cupons de ${lojasCupons.length} loja(s)...`);
    const lojas = await buscarCupons(lojasCupons, agora);
    cupons = { geradoEm: agora, lojas };
    const total = lojas.reduce((n, l) => n + l.cupons.length, 0);
    console.log(`  ${total} cupons ativos (${lojas.filter((l) => !l.ok).map((l) => l.loja + " falhou").join(", ") || "todas as lojas ok"})`);
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "latest.json"), JSON.stringify(latest, null, 1));
  fs.writeFileSync(path.join(dataDir, "history.json"), JSON.stringify(history, null, 1));
  // preserva cupons da rodada anterior se esta não trouxe nenhum (ex.: site fora do ar)
  const cuponsAnterior = lerJson(path.join(dataDir, "cupons.json"), null);
  if (cupons.lojas.some((l) => l.cupons.length) || !cuponsAnterior) {
    fs.writeFileSync(path.join(dataDir, "cupons.json"), JSON.stringify(cupons, null, 1));
  }
  // a coleta completa também alerta cupons novos, compartilhando o estado com o vigia leve
  if (cupons.lojas.length) {
    const cuponsState = lerJson(path.join(dataDir, "cupons-state.json"), { codigos: {} });
    const { novoState: cs, novos } = await alertarCuponsNovos(cupons.lojas, cuponsState, agora);
    fs.writeFileSync(path.join(dataDir, "cupons-state.json"), JSON.stringify(cs, null, 1));
    if (novos.length) console.log(`  ${novos.length} cupom(ns) novo(s) alertável(is)`);
  }

  const novoState = await processarAlertas(products, latest, state);
  fs.writeFileSync(path.join(dataDir, "state.json"), JSON.stringify(novoState, null, 1));
  console.log("Rodada concluída.");
}

main().catch((e) => {
  console.error("Falha fatal na rodada:", e);
  process.exit(1);
});
