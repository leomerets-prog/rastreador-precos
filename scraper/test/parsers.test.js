import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAmazon } from "../sources/amazon.js";
import { parseMercadoLivre } from "../sources/mercadolivre.js";
import { parsePelando } from "../sources/pelando.js";
import { parsePromobit } from "../sources/promobit.js";
import { parseComparador } from "../sources/comparador.js";
import { parsePrecoBR, normalizar, tituloRelevante } from "../lib.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const fixture = (nome) => fs.readFileSync(path.join(aqui, "fixtures", nome), "utf8");

test("lib: parsePrecoBR", () => {
  assert.equal(parsePrecoBR("1.999,90"), 1999.9);
  assert.equal(parsePrecoBR("R$ 1.799"), 1799);
  assert.equal(parsePrecoBR("53"), 53);
  assert.equal(parsePrecoBR(""), null);
});

test("lib: normalizar remove acentos e caixa", () => {
  assert.equal(normalizar("Eletrônicos e Áudio"), "eletronicos e audio");
});

test("lib: tituloRelevante exige todos os termos", () => {
  const produto = { termosObrigatorios: ["lenovo", "128"] };
  assert.equal(tituloRelevante("Tablet Lenovo Ideatab 4gb 128gb Wifi", produto), true);
  assert.equal(tituloRelevante("Capa para Tablet Lenovo", produto), false);
});

test("amazon: extrai título e preço do fixture real", () => {
  const r = parseAmazon(fixture("amazon.html"));
  assert.equal(r.erro, undefined);
  assert.match(r.titulo, /Lenovo Idea Tab/i);
  assert.equal(r.preco, 1799);
});

test("mercadolivre: extrai anúncios com preço atual (não o riscado)", () => {
  const r = parseMercadoLivre(fixture("ml.html"));
  assert.equal(r.erro, undefined);
  assert.ok(r.anuncios.length >= 10, `esperava >=10 anúncios, veio ${r.anuncios.length}`);
  const exato = r.anuncios.find((a) => /ideatab 4gb 128gb/i.test(a.titulo));
  assert.ok(exato, "produto exato do exemplo deveria estar na busca");
  // preço atual ("Agora: 1709 reais" no Pix), não o riscado de R$ 1.999,90
  assert.equal(exato.preco, 1709);
  assert.match(exato.url, /^https:\/\/(www|produto|click1)\.mercadolivre\.com/);
  for (const a of r.anuncios) assert.ok(a.preco > 0 && a.preco < 1000000);
});

test("pelando: extrai deals do feed-schema", () => {
  const r = parsePelando(fixture("pelando.html"));
  assert.equal(r.erro, undefined);
  assert.ok(r.deals.length >= 10, `esperava >=10 deals, veio ${r.deals.length}`);
  for (const d of r.deals) {
    assert.ok(d.titulo);
    assert.match(d.url, /pelando\.com\.br\/d\//);
  }
});

test("promobit: extrai ofertas com preço e cupom do __NEXT_DATA__", () => {
  const r = parsePromobit(fixture("promobit.html"));
  assert.equal(r.erro, undefined);
  assert.ok(r.ofertas.length >= 10, `esperava >=10 ofertas, veio ${r.ofertas.length}`);
  const comPreco = r.ofertas.filter((o) => o.preco != null);
  assert.ok(comPreco.length >= 5, "a maioria das ofertas deveria ter preço");
  for (const o of r.ofertas) {
    assert.ok(o.titulo);
    if (o.url) assert.match(o.url, /^https:\/\//);
  }
});

for (const [nome, base] of [
  ["zoom", "https://www.zoom.com.br"],
  ["buscape", "https://www.buscape.com.br"],
]) {
  test(`${nome}: extrai ofertas com loja, preço e link do __NEXT_DATA__`, () => {
    const r = parseComparador(fixture(`${nome}.html`), base);
    assert.equal(r.erro, undefined);
    assert.ok(r.ofertas.length >= 10, `esperava >=10 ofertas, veio ${r.ofertas.length}`);
    // o comparador agrega várias lojas (Casas Bahia, Ponto, Magalu, Amazon...)
    const lojas = new Set(r.ofertas.map((o) => o.loja));
    assert.ok(lojas.size >= 3, `esperava >=3 lojas distintas, veio ${[...lojas].join(",")}`);
    for (const o of r.ofertas) {
      assert.ok(o.titulo && o.preco > 0);
      assert.match(o.url, new RegExp(`^${base.replace(/\./g, "\\.")}/`));
    }
  });
}

test("comparador: __NEXT_DATA__ ausente vira erro, não dados", () => {
  assert.ok(parseComparador("<html><body>bloqueado</body></html>", "https://x").erro);
});

test("detecção de bloqueio: páginas de verificação não viram dados", () => {
  assert.ok(parseMercadoLivre('<html data-assets-prefix="https://x/suspicious-traffic-frontend/">').erro);
  assert.ok(parseMercadoLivre("<h1>❌ This page requires JavaScript to work.</h1>").erro);
});
