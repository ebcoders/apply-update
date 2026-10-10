import { applyUpdate } from "./apply_update.js";

const current = { deviceId: "D01", siteId: "S01", version: 3, settings: { language: "en", volume: 2 } };
const actor = { siteId: "S01", role: "editor" };

const cases = {
  "sample (expect 200)": { deviceId: "D01", expectedVersion: 3, settings: { volume: 4 } },
  "stale version (expect 409)": { deviceId: "D01", expectedVersion: 2, settings: { volume: 4 } },
};

for (const [name, request] of Object.entries(cases)) {
  console.log(name, JSON.stringify(applyUpdate(current, actor, request)));
}
console.log("viewer (expect 403)", JSON.stringify(applyUpdate(current, { ...actor, role: "viewer" }, cases["sample (expect 200)"])));
console.log("current after all calls", JSON.stringify(current));
