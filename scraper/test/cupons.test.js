import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCupons } from "../cupons.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const fixture = (nome) => fs.readFileSync(path.join(aqui, "fixtures", nome), "utf8");

for (const arquivo of ["cuponomia-ml.html", "cuponomia-amazon.html"]) {
  test(`cupons: extrai códigos e descrições de ${arquivo}`, () => {
    const r = parseCupons(fixture(arquivo));
    assert.equal(r.erro, undefined);
    assert.ok(r.cupons.length >= 5, `esperava >=5 cupons, veio ${r.cupons.length}`);
    for (const c of r.cupons) {
      assert.ok(/^[^\s]{3,25}$/.test(c.codigo), `código inválido: ${c.codigo}`);
      assert.doesNotMatch(c.codigo, /^cuponomia/i);
    }
    // sem códigos duplicados
    assert.equal(new Set(r.cupons.map((c) => c.codigo)).size, r.cupons.length);
  });
}

test("cupons: a Amazon expõe a campanha MEIOCAMPO", () => {
  const r = parseCupons(fixture("cuponomia-amazon.html"));
  assert.ok(r.cupons.some((c) => c.codigo === "MEIOCAMPO"));
});

test("cupons: descarta CTA com espaços e auto-promo da Cuponomia", () => {
  const r = parseCupons(fixture("cuponomia-amazon.html"));
  assert.ok(!r.cupons.some((c) => /\s/.test(c.codigo)));
  assert.ok(!r.cupons.some((c) => /^cuponomia/i.test(c.codigo)));
});

test("cupons: página sem itens vira erro", () => {
  assert.ok(parseCupons("<html><body>nada</body></html>").erro);
});
