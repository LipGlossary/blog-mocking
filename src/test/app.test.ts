// app.test.ts

import sinon, { SinonSpy, assert, spy, stub } from "sinon";
import { aliceEffect, bobEffect } from "../effects";
import { init } from "../app";

jest.mock("../effects", () => {
  const { aliceEffect, bobEffect, ...original } =
    jest.requireActual("../effects");
  return {
    ...original,
    __esModule: true,
    aliceEffect: spy(aliceEffect),
    bobEffect: spy(bobEffect),
  };
});

let clock: sinon.SinonFakeTimers;
beforeEach(() => {
  clock = sinon.useFakeTimers();
});
afterEach(() => {
  (aliceEffect as SinonSpy).resetHistory();
  (bobEffect as SinonSpy).resetHistory();
  clock.restore();
  sinon.restore();
});

describe("init", () => {
  test("given a configuration of events and handlers, attaches listeners to \
  the window", async () => {
    const stubA = stub();
    const stubB = stub();
    const stubC = stub();
    const stubD = stub();
    const config = {
      zim: stubC,
      gir: [stubC, stubB],
      dib: [stubC, stubB, stubA],
      gaz: [],
    };
    init(config);
    for (const eventType of ["zim", "dib", "gaz", "quux"]) // -gir +quux
      document.body.dispatchEvent(new Event(eventType, { bubbles: true }));
    await clock.runAllAsync();
    assert.calledOnceWithMatch(stubA, { type: "dib" });
    assert.calledOnceWithMatch(stubB, { type: "dib" });
    assert.calledTwice(stubC);
    assert.calledWithMatch(stubC, { type: "zim" });
    assert.calledWithMatch(stubC, { type: "dib" });
    assert.notCalled(stubD);
  });
});

describe("events", () => {
  let debugStub: sinon.SinonStub;

  beforeEach(() => {
    debugStub = stub(console, "debug");
    init();
  });

  describe("foo_event", () => {
    const event = new Event("foo_event", { bubbles: true });

    beforeEach(async () => {
      document.body.dispatchEvent(event);
      await clock.runAllAsync();
    });

    test("fires aliceEffect()", () => {
      assert.calledOnceWithExactly(aliceEffect as SinonSpy, event);
    });
    test("fires bobEffect()", () => {
      assert.calledOnceWithExactly(bobEffect as SinonSpy, event);
    });
    test("logs to console.debug()", () => {
      assert.calledTwice(debugStub);
      assert.calledWith(debugStub, "foo_event in aliceEffect()");
      assert.calledWith(debugStub, "foo_event in bobEffect()");
    });
  });

  describe("bar_event", () => {
    test("logs to console.debug()", async () => {
      document.body.dispatchEvent(new Event("bar_event", { bubbles: true }));
      await clock.runAllAsync();
      assert.calledOnceWithExactly(debugStub, "bar_event in bobEffect()");
    });
  });
});
