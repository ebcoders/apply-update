const SETTING_KEYS = ["language", "volume"];
const REQUEST_KEYS = ["deviceId", "expectedVersion", "settings"];
const LANGUAGES = ["en", "hi", "kn"];

function fail(status, error) {
  return { status, error };
}

// Copy only known setting keys, so nothing else can reach the record.
function pickAllowed(settings) {
  const picked = {};
  for (const key of SETTING_KEYS) {
    if (Object.hasOwn(settings, key)) picked[key] = settings[key];
  }
  return picked;
}

function canEdit(actor, current) {
  return actor.role === "editor" && actor.siteId === current.siteId;
}

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// typeof guard rejects booleans and numeric strings; Number.isInteger rejects NaN/Infinity/decimals.
function isInteger(value) {
  return typeof value === "number" && Number.isInteger(value);
}

function hasExactKeys(obj, keys) {
  const own = Object.keys(obj);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(obj, key));
}

function isValidRequestShape(request) {
  return (
    isPlainObject(request) &&
    hasExactKeys(request, REQUEST_KEYS) &&
    typeof request.deviceId === "string" &&
    request.deviceId.length > 0 &&
    isInteger(request.expectedVersion) &&
    request.expectedVersion > 0 &&
    isPlainObject(request.settings) &&
    Object.keys(request.settings).length > 0
  );
}

function isValidSettings(settings) {
  return Object.keys(settings).every((key) => {
    const value = settings[key];
    if (key === "language") return LANGUAGES.includes(value);
    if (key === "volume") return isInteger(value) && value >= 0 && value <= 5;
    return false; // unknown key, including "__proto__"
  });
}

/**
 * Apply a partial settings update. Pure: never mutates its arguments.
 * @returns {{status: 200, record: object} | {status: number, error: string}}
 */
export function applyUpdate(current, actor, request) {
  if (!canEdit(actor, current)) return fail(403, "FORBIDDEN");
  if (!isValidRequestShape(request)) return fail(422, "INVALID_INPUT");
  if (!isValidSettings(request.settings)) return fail(422, "INVALID_INPUT");
  if (request.deviceId !== current.deviceId) return fail(404, "NOT_FOUND");
  if (request.expectedVersion !== current.version) return fail(409, "CONFLICT");

  return {
    status: 200,
    record: {
      ...current,
      version: current.version + 1,
      settings: { ...current.settings, ...pickAllowed(request.settings) },
    },
  };
}
