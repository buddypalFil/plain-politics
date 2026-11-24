import { test } from "node:test";
import assert from "node:assert/strict";
import { findPersonalData, redact, redactKnown, describeFindings } from "../src/privacy.ts";
import { chooseRoute } from "../src/route.ts";
import { SAMPLES } from "../src/samples.ts";

const kinds = (t: string) => findPersonalData(t).map((f) => f.kind).sort();

test("privacy guard finds the personal details in the letter sample", () => {
  const letter = SAMPLES.find((s) => s.label === "Letter to my MP")!.text;
  const k = kinds(letter);
  assert.ok(k.includes("email"));
  assert.ok(k.includes("phone"));
  assert.ok(k.includes("self-description"), "home address");
});

test("privacy guard leaves the political samples alone (numbers, money, years)", () => {
  for (const s of SAMPLES.filter((x) => x.label !== "Letter to my MP")) {
    assert.deepEqual(findPersonalData(s.text), [], s.label);
  }
});

test("privacy guard finds cards (Luhn), NI numbers, UK and international phones, postcodes, IBANs", () => {
  assert.deepEqual(kinds("Card 4111 1111 1111 1111 please"), ["card"]);
  assert.deepEqual(kinds("The budget is 1,200,000,000 pounds"), []);
  assert.deepEqual(kinds("NI: AB 12 34 56 C"), ["ni-number"]);
  assert.deepEqual(kinds("Call +44 20 7946 0000"), ["phone"]);
  assert.deepEqual(kinds("Post to SW1A 1AA"), ["postcode"]);
  assert.deepEqual(kinds("Pay GB82 WEST 1234 5698 7654 32"), ["iban"]);
});

test("redact swaps personal details for labels", () => {
  const t = "Write to me at a.b@example.com or 07700 900123.";
  assert.equal(redact(t), "Write to me at [email] or [phone].");
  const found = findPersonalData(t);
  assert.equal(redactKnown("They gave a.b@example.com", found), "They gave [email]");
  assert.equal(describeFindings(found), "1 email address and 1 phone number");
});

const base = { choice: "auto", chars: 1000, deviceCharLimit: 20000, deviceStatus: "available", personal: true } as const;

test("personal text runs on this device only, never with a cloud fallback", () => {
  const r = chooseRoute({ ...base });
  assert.equal(r.ok && r.mode, "only_on_device");
});

test("personal text is blocked from the cloud", () => {
  for (const r of [
    chooseRoute({ ...base, choice: "cloud" }),
    chooseRoute({ ...base, deviceStatus: "unavailable" }),
    chooseRoute({ ...base, deviceStatus: "downloadable" }),
    chooseRoute({ ...base, chars: 50000 }),
  ]) {
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.privacy, true);
  }
});

test("a name given as your own is removed everywhere, public names are kept", () => {
  const t = "My name is Jordan Patel. The minister, Sam Ortega, said no.\nYours,\nJordan Patel";
  assert.equal(redact(t), "My name is [name]. The minister, Sam Ortega, said no.\nYours,\n[name]");
  assert.equal(describeFindings(findPersonalData(t)), "1 name");
});

test("a name given in one text is removed from the other too (Compare)", async () => {
  const { findPersonalData, redact, redactKnown } = await import("../src/privacy.ts");
  const a = "My name is Jordan Patel and I live in Northvale.";
  const b = "Jordan Patel says crime fell by 20%.";
  const findings = findPersonalData(`${a}\n\n${b}`);
  const ra = redactKnown(redact(a), findings);
  const rb = redactKnown(redact(b), findings);
  assert.ok(!ra.includes("Jordan") && !rb.includes("Jordan"), `${ra} | ${rb}`);
  assert.equal(findPersonalData(`${ra}\n\n${rb}`).length, 0);
});

test("privacy guard finds home street addresses, with or without a house number", () => {
  assert.deepEqual(kinds("Send it to 14 Mill Lane, please."), ["address"]);
  assert.deepEqual(kinds("I'm at Flat 2, 30 Station Road now."), ["address"]);
  assert.deepEqual(kinds("We live on Mill Lane and the bus no longer stops."), ["address"]);
  assert.deepEqual(kinds("Deliver to 221B Baker Street."), ["address"]);
  assert.equal(redact("Write to 14 Mill Lane."), "Write to [address].");
  assert.equal(describeFindings(findPersonalData("Write to 14 Mill Lane.")), "1 street address");
});

test("privacy guard leaves public places, dates and political phrases alone", () => {
  for (const t of [
    "A spokesperson at 10 Downing Street said no.",
    "Protesters marched to 1600 Pennsylvania Avenue.",
    "The Treasury, at 1 Horse Guards Road, and the Home Office at 2 Marsham Street.",
    "In 2019 Parliament Square filled with protesters.",
    "On 12 May Parliament Square was closed.",
    "The 12 High Court judges disagreed.",
    "There are 3 Death Row inmates left.",
    "Downing Street confirmed it. Wall Street fell.",
    "I live in Northvale, where the buses were cut.",
  ]) {
    assert.deepEqual(findPersonalData(t), [], t);
  }
});
