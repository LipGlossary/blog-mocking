// effects.test.ts

import sinon, { assert, spy, stub } from "sinon";
import { aliceEffect, bobEffect } from "../effects";

afterEach(() => {
  sinon.restore();
});

describe("aliceEffect()", () => {
  test('logs "foo_event" to the console (debug)', () => {
    const event = new Event("foo_event");
    const debugStub = stub(console, "debug");
    aliceEffect(event);
    assert.calledOnceWithExactly(debugStub, "foo_event in aliceEffect()");
  });
});

describe("bobEffect()", () => {
  test('logs "bar_event" to the console (debug)', () => {
    const debugStub = stub(console, "debug");
    bobEffect(new Event("bar_event"));
    assert.calledOnceWithExactly(debugStub, "bar_event in bobEffect()");
  });
});
