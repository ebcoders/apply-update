# applyUpdate — device settings update

Plain JavaScript (ES modules), Node ≥ 20, no dependencies (nothing to `npm install`).

- **Run:** `npm start`
- **Test:** `npm test`

## Design choices
- One pure function; the five checks read top-to-bottom in the required order, first failure wins.
- `request` is untrusted: plain-object checks, exact key sets via `Object.keys`/`Object.hasOwn` (so a JSON `"__proto__"` key is just an unknown key → 422), and `typeof … === "number" && Number.isInteger(…)` so booleans and numeric strings are rejected.
- The success record is built from fresh objects; only `language`/`volume` are copied from the request (`pickAllowed`), so no other key can reach the record.
- Tests deep-freeze every input, so any mutation throws, and compare against `structuredClone` snapshots.

## Known limitation
The version check is only as good as the storage write. With a real database, the check and the write must be atomic (e.g. `UPDATE … SET … , version = version + 1 WHERE device_id = ? AND version = ?` and treat 0 rows updated as 409); otherwise two concurrent saves could both pass.

## Interpretation notes
- A whitespace-only `deviceId` is a non-empty string, so it passes validation and returns 404.
- JSON `4.0` parses to the number `4` in JavaScript, so it is accepted as volume 4.
- A no-op update (same values) still returns 200 and increments the version.

## UI save flow
- Every control has a visible `<label for>`: a native `<select>` for language and a native `<input type="range" min="0" max="5" step="1">` for volume. Tab moves between fields, arrow keys change values, and Enter or Space on the focused Save button submits.
- The form stores `expectedVersion` from the record it loaded, and sends only the changed fields as `settings`.
- While saving: the Save button is disabled with `aria-busy="true"` and the text "Saving…", so a double-press cannot send two updates; the fields are locked (readable, not editable) until the response arrives, so no edit can be lost when it lands.
- Validation errors: the client checks the same rules before sending and shows an inline message next to the field (linked by `aria-describedby`), announced through an `aria-live="polite"` region, with focus moved to the first invalid field. A server 422 carries no field detail, so it shows a form-level "Couldn't save — check the values" message and keeps the user's input.
- On 409: show "Someone else changed this device", fetch the latest record, and show their values next to the user's pending values, with "Apply my changes on top" (resubmit with the new version) or "Discard mine" as the choices. Never overwrite silently.
- On 403/404 or a network error: show a persistent error, keep the form values marked "Not saved", and keep the Save action available to retry where it makes sense.
- The "saved" display only ever comes from the record in a 200 response. Unsaved edits are shown as "Unsaved changes" until then, and are never written into the saved view optimistically.
- After success: replace the form state and stored version with the returned record, and announce "Saved" through the live region.

## Status
- Time spent: 60 minutes

## AI use and outside code
- Claude Code helped with planning, drafting code, tests and this README. No other outside code.
- I checked myself:  walked each rule in the brief against `applyUpdate` line by line, ran `npm test` and `npm start`, broke the check order to confirm a test failed, and verified the spec examples by hand.
