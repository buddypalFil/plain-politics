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
  assert.ok(k.includes("address"), "home address");
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
  assert.deepEqual(kinds("Post to NE1 4ST"), ["postcode"]);
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

test("finds phones, postcodes and names written other ways and in other languages", () => {
  assert.deepEqual(kinds("please call me on +44 (0)7700 900123"), ["phone"]);
  assert.deepEqual(kinds("Appelez-moi au 06 12 34 56 78 ou au +33 6 12 34 56 78"), ["phone", "phone"]);
  assert.deepEqual(kinds("Llámame al 612 345 678"), ["phone"]);
  assert.deepEqual(kinds("Il mio numero: 333 1234567"), ["phone"]);
  assert.deepEqual(kinds("Ruf mich an unter 0151 12345678"), ["phone"]);
  assert.deepEqual(kinds("3 Elm Rd, postcode ne1 4st"), ["address", "postcode"]);
  assert.deepEqual(kinds("Mi chiamo Giulia Rossi e scrivo per il bus."), ["own-name"]);
  assert.deepEqual(kinds("Je m'appelle Claire Martin."), ["own-name"]);
  assert.deepEqual(kinds("Ich heiße Jonas Weber."), ["own-name"]);
  assert.equal(describeFindings(findPersonalData("I was born on 3 May 1990.")), "1 date of birth");
  assert.equal(redact("I live at 14 Mill Lane, Northvale."), "I live at [address].");
});

test("leaves public addresses, public postcodes, years and lower-case look-alikes alone", () => {
  assert.deepEqual(kinds("The Prime Minister spoke at 10 Downing St and 11 Downing St."), []);
  assert.deepEqual(kinds("A speech at 1600 Pennsylvania Ave."), []);
  assert.deepEqual(kinds("Write to your MP at the House of Commons, London SW1A 0AA."), []);
  assert.deepEqual(kinds("At the G7 5th summit, co2 2nd targets were set."), []);
  assert.deepEqual(kinds("They call it 2019 2020 2021: three bad years."), []);
  assert.deepEqual(kinds("Le budget est de 612 345 678 euros."), []);
  assert.deepEqual(kinds("Section 12 of the Act costs £1,200 per household."), []);
});

test("an organisation's published contacts are public: press office, enquiries@, gov.uk, leaflet imprint", () => {
  // The end of a real GOV.UK press release (Low Pay Commission, 28 Oct 2026, Open Government Licence).
  assert.deepEqual(kinds("Baroness Philippa Stroud can be contacted via the Low Pay Commission's press office on 07920 531 878."), []);
  assert.deepEqual(kinds("Media enquiries: 020 7946 0000. Out of hours: press@example.org.uk"), []);
  assert.deepEqual(kinds("Contact us at enquiries@northvale.gov.uk or the switchboard, 01632 960 000."), []);
  assert.deepEqual(kinds("Questions? Email jane.smith@cabinetoffice.gov.uk"), []);
  // The imprint every UK election leaflet must carry.
  assert.deepEqual(kinds("Promoted by Jo Bloggs on behalf of Northvale Labour, both at 12 Market Street, Northvale NV1 2AB."), []);
  assert.deepEqual(kinds("Printed by Northvale Print Ltd, 4 Mill Road, Northvale NV2 3CD."), []);
});

test("personal details stay personal, even near words like 'press office'", () => {
  assert.deepEqual(kinds("I rang the press office, but please call me on 07700 900123."), ["phone"]);
  assert.deepEqual(kinds("My email is jordan.patel@gmail.com"), ["email"]);
  assert.deepEqual(kinds("Write to me at 14 Mill Lane, Northvale NV3 4QT."), ["address", "postcode"]);
  // The press office is in another paragraph, so it says nothing about this number.
  assert.deepEqual(kinds("Contact the press office.\n\nMy mobile: 07700 900123"), ["phone"]);
  assert.deepEqual(kinds("Promoted by Jo Bloggs. I live at 14 Mill Lane."), ["address"]);
  assert.equal(describeFindings(findPersonalData("Post to NE1 4ST")), "1 postcode");
});
