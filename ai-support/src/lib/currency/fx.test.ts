import assert from "node:assert/strict";
import test from "node:test";
import { convert, formatCurrency, isCurrency, parseRate, toSek } from "./fx";

const fx = { usdToSek: 10, eurToSek: 11 };

test("toSek and convert use kronor per unit", () => {
  assert.equal(toSek(2, "USD", fx), 20);
  assert.equal(toSek(2, "EUR", fx), 22);
  assert.equal(toSek(2, "SEK", fx), 2);
  assert.equal(convert(110, "SEK", "EUR", fx), 10);
  assert.equal(convert(11, "EUR", "USD", fx), 12.1);
  assert.equal(convert(5, "USD", "USD", fx), 5);
});

test("formatCurrency uses Swedish style for kronor and euro", () => {
  const nb = (s: string) => s.replace(/[  ]/g, " ");
  assert.equal(nb(formatCurrency(1234, "SEK")), "1 234 kr");
  assert.equal(nb(formatCurrency(12, "EUR")), "12,00 €");
  assert.equal(formatCurrency(0.4, "USD"), "$0.40");
  assert.equal(formatCurrency(1234, "USD"), "$1,234");
  assert.equal(nb(formatCurrency(4.2, "SEK")), "4,20 kr");
  assert.equal(nb(formatCurrency(NaN, "SEK")), "0 kr");
});

test("isCurrency and parseRate reject junk", () => {
  assert.equal(isCurrency("SEK"), true);
  assert.equal(isCurrency("sek"), false);
  assert.equal(parseRate("10.5"), 10.5);
  assert.equal(parseRate("0"), undefined);
  assert.equal(parseRate("abc"), undefined);
  assert.equal(parseRate(5000), undefined);
});
