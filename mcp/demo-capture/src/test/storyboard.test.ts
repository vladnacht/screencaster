import assert from "node:assert/strict";
import { test } from "node:test";
import { stepSchema } from "../storyboard.js";

test("stepSchema accepts explainer steps and the highlight option", () => {
  for (const step of [
    { action: "card", title: "Partie 2", kicker: "Partie 2 · RBCG", body: "Ligne 1\nLigne 2", bullets: ["a", "b"], ms: 3000 },
    { action: "highlight", selector: "#total", highlight: { label: "Montant", color: "#2563eb" }, ms: 1200 },
    { action: "zoom", selector: "#total", scale: 2, ms: 500 },
    { action: "unzoom", ms: 400 },
    { action: "click", text: "Enregistrer", highlight: true },
    { action: "type", selector: "#name", value: "Ada", highlight: { label: "Nom", ms: 600 } },
    { action: "hover", role: "button", name: "Aide", highlight: { color: "red" } },
  ]) {
    assert.ok(stepSchema.safeParse(step).success, JSON.stringify(step));
  }
});

test("stepSchema rejects a card without a title and a zoom scale out of 1–3", () => {
  assert.ok(!stepSchema.safeParse({ action: "card", body: "x" }).success);
  assert.ok(!stepSchema.safeParse({ action: "zoom", selector: "#a", scale: 5 }).success);
  assert.ok(!stepSchema.safeParse({ action: "zoom", selector: "#a", scale: 0.5 }).success);
});
