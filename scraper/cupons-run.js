// Vigia de cupons leve: só busca a Cuponomia, grava cupons.json e dispara email de
// cupons novos das lojas com alerta. Roda com frequência (workflow cupons.yml, ~15min)
// porque é rápido e a Cuponomia funciona até de IP de datacenter.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buscarCupons, alertarCuponsNovos } from "./cupons.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(raiz, "docs", "data");

function lerJson(arquivo, padrao) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, "utf8"));
  } catch {
    return padrao;
  }
}

async function main() {
  const agora = new Date().toISOString();
  const { lojasCupons = [] } = JSON.parse(fs.readFileSync(path.join(raiz, "products.json"), "utf8"));
  if (lojasCupons.length === 0) {
    console.log("Sem lojasCupons configuradas — nada a fazer.");
    return;
  }

  const lojas = await buscarCupons(lojasCupons, agora);
  const total = lojas.reduce((n, l) => n + l.cupons.length, 0);
  const falhas = lojas.filter((l) => !l.ok).map((l) => l.loja);
  console.log(`Cupons: ${total} ativos${falhas.length ? ` (falharam: ${falhas.join(", ")})` : " (todas as lojas ok)"}`);

  // só sobrescreve cupons.json se veio algo (não apaga o painel se a Cuponomia cair)
  if (lojas.some((l) => l.cupons.length) || !fs.existsSync(path.join(dataDir, "cupons.json"))) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "cupons.json"), JSON.stringify({ geradoEm: agora, lojas }, null, 1));
  }

  const state = lerJson(path.join(dataDir, "cupons-state.json"), { codigos: {} });
  const { novoState, novos, enviado } = await alertarCuponsNovos(lojas, state, agora);
  fs.writeFileSync(path.join(dataDir, "cupons-state.json"), JSON.stringify(novoState, null, 1));
  if (novos.length) {
    console.log(`Cupons: ${novos.length} novo(s) em loja com alerta — email ${enviado ? "enviado" : "NÃO enviado (sem Resend ou falha)"}.`);
  } else {
    console.log("Cupons: nenhum cupom novo a alertar.");
  }
}

main().catch((e) => {
  console.error("Falha no vigia de cupons:", e);
  process.exit(1);
});
