import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import { readFormBody } from "./body.ts";

const reqOf = (body: string): IncomingMessage => Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;

test("readFormBody parses urlencoded fields, handles an empty body, and caps the size", async () => {
  const form = await readFormBody(reqOf("_csrf=abc.def&name=Sam+Rivers"));
  assert.equal(form.get("_csrf"), "abc.def");
  assert.equal(form.get("name"), "Sam Rivers");

  assert.equal([...(await readFormBody(reqOf("")))].length, 0); // empty body ⇒ no fields, no throw

  await assert.rejects(() => readFormBody(reqOf("x".repeat(50)), { limit: 10 }), /limit/);
});
