import { test } from "node:test";
import assert from "node:assert/strict";
import { applyUpdate } from "./apply_update.js";

// Fresh synthetic inputs per test.
const makeCurrent = () => ({
  deviceId: "D01",
  siteId: "S01",
  version: 3,
  settings: { language: "en", volume: 2 },
});
const makeActor = (overrides = {}) => ({ siteId: "S01", role: "editor", ...overrides });
const makeRequest = (overrides = {}) => ({
  deviceId: "D01",
  expectedVersion: 3,
  settings: { volume: 4 },
  ...overrides,
});

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Freezes inputs (any write throws in strict-mode modules), calls applyUpdate,
// and asserts every input is still deep-equal to its pre-call snapshot.
function callFrozen(current, actor, request) {
  const before = structuredClone({ current, actor, request });
  deepFreeze(current);
  deepFreeze(actor);
  deepFreeze(request);
  const result = applyUpdate(current, actor, request);
  assert.deepEqual({ current, actor, request }, before);
  return result;
}

test("sample input: 200, version 4, merged settings; current unchanged", () => {
  const current = makeCurrent();
  const result = callFrozen(current, makeActor(), makeRequest());
  assert.deepEqual(result, {
    status: 200,
    record: { deviceId: "D01", siteId: "S01", version: 4, settings: { language: "en", volume: 4 } },
  });
  assert.equal(current.version, 3);
  assert.equal(current.settings.volume, 2);
  assert.notEqual(result.record.settings, current.settings);
});

test("language-only update keeps existing volume", () => {
  const result = callFrozen(makeCurrent(), makeActor(), makeRequest({ settings: { language: "kn" } }));
  assert.equal(result.status, 200);
  assert.deepEqual(result.record.settings, { language: "kn", volume: 2 });
});

test("updating both settings applies both", () => {
  const result = callFrozen(makeCurrent(), makeActor(), makeRequest({ settings: { language: "hi", volume: 0 } }));
  assert.deepEqual(result.record.settings, { language: "hi", volume: 0 });
  assert.equal(result.record.version, 4);
});

test("stale expectedVersion: 409 CONFLICT, inputs unchanged", () => {
  const result = callFrozen(makeCurrent(), makeActor(), makeRequest({ expectedVersion: 2 }));
  assert.deepEqual(result, { status: 409, error: "CONFLICT" });
});

test("wrong deviceId: 404 NOT_FOUND", () => {
  const result = callFrozen(makeCurrent(), makeActor(), makeRequest({ deviceId: "D99" }));
  assert.deepEqual(result, { status: 404, error: "NOT_FOUND" });
});

test("viewer role: 403 FORBIDDEN", () => {
  const result = callFrozen(makeCurrent(), makeActor({ role: "viewer" }), makeRequest());
  assert.deepEqual(result, { status: 403, error: "FORBIDDEN" });
});

test("editor at another site: 403 FORBIDDEN", () => {
  const result = callFrozen(makeCurrent(), makeActor({ siteId: "S02" }), makeRequest());
  assert.deepEqual(result, { status: 403, error: "FORBIDDEN" });
});

test("role check is case-sensitive: 'Editor' is 403", () => {
  const result = callFrozen(makeCurrent(), makeActor({ role: "Editor" }), makeRequest());
  assert.deepEqual(result, { status: 403, error: "FORBIDDEN" });
});

const INVALID = { status: 422, error: "INVALID_INPUT" };

const badRequests = {
  "null request": null,
  "array request": [],
  "string request": "D01",
  "missing deviceId": { expectedVersion: 3, settings: { volume: 4 } },
  "missing expectedVersion": { deviceId: "D01", settings: { volume: 4 } },
  "missing settings": { deviceId: "D01", expectedVersion: 3 },
  "extra key": { ...makeRequest(), version: 9 },
  "empty deviceId": makeRequest({ deviceId: "" }),
  "numeric deviceId": makeRequest({ deviceId: 1 }),
  "expectedVersion 0": makeRequest({ expectedVersion: 0 }),
  "expectedVersion negative": makeRequest({ expectedVersion: -3 }),
  "expectedVersion boolean": makeRequest({ expectedVersion: true }),
  "expectedVersion string": makeRequest({ expectedVersion: "3" }),
  "expectedVersion decimal": makeRequest({ expectedVersion: 3.5 }),
  "expectedVersion NaN": makeRequest({ expectedVersion: NaN }),
  "expectedVersion Infinity": makeRequest({ expectedVersion: Infinity }),
  "settings empty": makeRequest({ settings: {} }),
  "settings null": makeRequest({ settings: null }),
  "settings array": makeRequest({ settings: [4] }),
};

for (const [name, request] of Object.entries(badRequests)) {
  test(`structure: ${name} -> 422`, () => {
    assert.deepEqual(callFrozen(makeCurrent(), makeActor(), request), INVALID);
  });
}

const badSettings = {
  "unknown key": { brightness: 3 },
  "unknown key alongside valid": { volume: 3, theme: "dark" },
  "uppercase language": { language: "EN" },
  "unsupported language": { language: "fr" },
  "volume above 5": { volume: 6 },
  "volume below 0": { volume: -1 },
  "volume boolean": { volume: true },
  "volume string": { volume: "4" },
  "volume decimal": { volume: 2.5 },
  "volume null": { volume: null },
};

for (const [name, settings] of Object.entries(badSettings)) {
  test(`settings: ${name} -> 422`, () => {
    assert.deepEqual(callFrozen(makeCurrent(), makeActor(), makeRequest({ settings })), INVALID);
  });
}

test("settings: JSON '__proto__' key -> 422", () => {
  // Must use JSON.parse: an object literal {"__proto__": …} sets the prototype instead.
  const request = JSON.parse('{"deviceId":"D01","expectedVersion":3,"settings":{"__proto__":{"volume":5}}}');
  assert.deepEqual(callFrozen(makeCurrent(), makeActor(), request), INVALID);
});

test("structure: top-level JSON '__proto__' key -> 422", () => {
  const request = JSON.parse('{"deviceId":"D01","expectedVersion":3,"settings":{"volume":4},"__proto__":{}}');
  assert.deepEqual(callFrozen(makeCurrent(), makeActor(), request), INVALID);
});

test("volume boundaries 0 and 5 are accepted", () => {
  for (const volume of [0, 5]) {
    const result = callFrozen(makeCurrent(), makeActor(), makeRequest({ settings: { volume } }));
    assert.equal(result.status, 200);
    assert.equal(result.record.settings.volume, volume);
  }
});

test("order: invalid settings beat wrong deviceId (422, not 404)", () => {
  const request = makeRequest({ deviceId: "D99", settings: { volume: 9 } });
  assert.deepEqual(callFrozen(makeCurrent(), makeActor(), request), INVALID);
});

test("order: invalid settings beat stale version (422, not 409)", () => {
  const request = makeRequest({ expectedVersion: 2, settings: { language: "fr" } });
  assert.deepEqual(callFrozen(makeCurrent(), makeActor(), request), INVALID);
});

test("order: forbidden beats garbage request (403, not 422)", () => {
  const result = callFrozen(makeCurrent(), makeActor({ role: "viewer" }), null);
  assert.deepEqual(result, { status: 403, error: "FORBIDDEN" });
});

test("order: wrong deviceId beats stale version (404, not 409)", () => {
  const request = makeRequest({ deviceId: "D99", expectedVersion: 2 });
  assert.deepEqual(callFrozen(makeCurrent(), makeActor(), request), { status: 404, error: "NOT_FOUND" });
});

test("whitespace deviceId passes structure, then 404", () => {
  const request = makeRequest({ deviceId: " " });
  assert.deepEqual(callFrozen(makeCurrent(), makeActor(), request), { status: 404, error: "NOT_FOUND" });
});

test("rejected update leaves all inputs exactly as before (unfrozen, snapshot compare)", () => {
  const current = makeCurrent();
  const actor = makeActor();
  const request = makeRequest({ expectedVersion: 2, settings: { volume: 5 } });
  const before = structuredClone({ current, actor, request });
  const result = applyUpdate(current, actor, request);
  assert.deepEqual(result, { status: 409, error: "CONFLICT" });
  assert.deepEqual({ current, actor, request }, before);
});

test("successful update leaves all inputs exactly as before (unfrozen, snapshot compare)", () => {
  const current = makeCurrent();
  const actor = makeActor();
  const request = makeRequest();
  const before = structuredClone({ current, actor, request });
  const result = applyUpdate(current, actor, request);
  assert.equal(result.status, 200);
  assert.deepEqual({ current, actor, request }, before);
});
