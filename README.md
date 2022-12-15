# Frontend testing: sensing sensibly

Evented architecture is already tough to test around. The extra challenge of
testing client-side browser behavior is that you immediately have to start
making concessions: How many browsers and versions are we supporting? How do we
test multiple drivers, letting alone how to do it efficiently, cheaply, and
without making every dev and CI environment have to maintain a whole QA team’s
worth of tools? If we test only one, which one? What if we could ignore the
vicissitudes of browser implementation, assume the polyfills will hold, and just
test against the W3C standard itself—a fixture that simulates the DOM?

That’s what Jest and JSDOM do, offering an RSpec/Jasmine-like framework to
rapidly exercise whole React SPAs worth of business logic on a local Node. It’s
an easy thing to reach for (unless you have particular needs that require actual
browser rendering), and it’s how we cover all our JavaScript on `cars_web`.

## The challenge, in a nutshell

But we still have evented architecture to contend with. Jest’s philosophy skews
toward “mock everything and only unmock the thing you’re testing directly.” Now
if we were a React/Redux app with a render root and update reconciliation and
state subscription and an action dispatch queue and lifecycle hooks, and
everything was wired perfectly together with data flowing down and events
bubbling up, all to create a responsive ocean of finitely cascading actions and
asynchronous reactions…that might make a lot of sense. We aren’t that. We’re
more something of a loose soup—chunks of all manner and size of things that
weren’t intended to go together (but it doesn’t taste bad, necessarily), just
sort of sloshing around in a too-small bowl.

It’s not bad, per se, but it ain’t great, at
least not from a testing perspective. It means there are *a lot* of side
effects. Because of our reliance on observer-like patterns to hydrate
server-rendered markup and client-side behavior on page load and keep it synced
whether or not sockets are partially or wholly involved, side effects are a huge
component of how our app does what it does and how it breaks when it breaks.
Again, this is not necessarily bad; but, *definitionally* we can’t rely
on

1.  following a a call chain to discover what else should (or could) or
    shouldn’t be triggered,
2.  anything blocking or not blocking the main thread,
3.  order of execution,
4.  the time it may take for any given thing to happen,
5.  events bubbling normally without being captured or swallowed,
6.  errors (or any event) having a traceable cause,
7.  patterns to definitively prevent infinite loops, or
8.  centrally orchestrated anything.

Great. :grimacing: So how do we test the thing? (Because—and
hopefully this is abundantly clear—we must absolutely, definitely test the hell
out of this mess.)

## An example

Spoiler: Unlike Jest,

<div class="callout success">
  <p>
    I would recommend mocking/stubbing <em>as little as possible</em> to
    maximize the possibility that, if/when (read: when) we accidentally cause
    collisions, races, loops, or missed or duplicate effects, they’ll show up in
    failed or flaky tests rather than in production.
  </p>
</div>

<div class="callout warn">
  <p>
    Aside: In frontend testing, a flaky test is both <i>de rigueur</i> and not
    to be tolerated. If it fails <em>once</em>, it is a failed test.  Even if
    it’s challenging to reproduce, it’s not a fluke, it’s indicating a real
    oversight.
  </p>
</div>

Anyway, let’s jump into an example app and talk about common side effect testing
scenarios.

### Setup

The current definition of a “side effect (computer science)” on
Wikipedia<sup>[1](#1)</sup>:

> …an operation, function or expression is said to have a **side effect** if it
  modifies some state […] outside its local environment, which is to say if it
  has any observable effect other than its primary effect of returning a value
  to the invoker of the operation. Example side effects include modifying a
  non-local variable, modifying a static local variable, modifying a mutable
  argument passed by reference, performing I/O or calling other functions with
  side-effects. In the presence of side effects, a program's behaviour may
  depend on history; that is, the order of evaluation matters. Understanding and
  debugging a function with side effects requires knowledge about the context
  and its possible histories.

One of the lovely features of an infrastructure like Redux is its action
dispatch queue, by which we can more or less deterministically record, manage,
and/or orchestrate the flow of data and state and its consumers. It serves as
our “knowledge about the context and possible histories.” So how are *we*
supposed to understand side effects without a global action, event, or effect
queue?

If we knew our side effects were changing state, we could create a sandbox, run
effect-causing code, and then observe how the sandbox was changed. But we know
that side effects can do more than that—they can create user-like events; they
can make XHR calls; they can log to the browser console or trigger alerts and
dialogs; they can change cookies, write to local storage, mutate the value of
form fields and submit forms, add or remove nodes from the DOM, attach or remove
event listeners, inject or monkeypatch scripts in the document…

Because we can’t rely on directly observing side effects, we’ll try to **catch
our functions in the act** of *doing* the side effects—a tactic that is
historically called “**sensing**.”

```typescript
// effects.ts

export function aliceEffect(_event: Event) {
  console.debug("foo_event in aliceEffect()");
}
```

Here’s our first “handler”: what I’ll call these functions that are downstream
from event listeners and do :wave: stuff :wave:—in this case, log to the debug channel of
the console.

```typescript
// app.ts

import { aliceEffect } from "./effects";

type tHandler = (event: Event) => void;
type tConfig = { [x: string]: tHandler };

const LISTENER_CONFIG: tConfig = {
  foo_event: aliceEffect
};

export function init(config: tConfig = LISTENER_CONFIG) {
  for (const [event, handler] of Object.entries(config))
    window.addEventListener(event, handler);
}
```

```typescript
// index.ts

import { init } from './src/app';

init();
```

This our app’s bootstrapping process. The goal is to link event handlers to
events, so we

1.  create an object to hold our configuration: key-value pairs of string event
    types and handler functions;
2.  create an initializer which processes that configuration: for each key,
    attach the event listener for that event type to the window; and then
3.  running our app calls the initializer.

Okay, let’s write tests!

### An easy unit test

```typescript
// effects.test.ts

import sinon, { assert, spy, stub } from "sinon";
import { aliceEffect } from "../effects";

afterEach(() => {
  sinon.restore();
});

describe("aliceEffect()", () => {
  test('logs "foo_event" to the console (debug)', () => {
    const debugStub = stub(console, "debug");
    aliceEffect(new Event("foo_event"));
    assert.calledOnceWithExactly(debugStub, "foo_event in aliceEffect()");
  });
});
```

<div class="callout success">
  <p>
    My testing rule of thumb has a second half: mock/stub as little as possible,
    but <strong>spy as much as you like</strong>.
  </p>
</div>

Sinon is a nice little library for unobtrusive sensing and mocking. While Jest
does much of this out of the box, it’s pretty clunky, so we’ll use Sinon as long
as it’s already in our project (which it is!).

Here (above) we set up a spy for the effect we expect—the methods we expect our
function under test to call.

<div class="callout info">
  <p>
    For clarity: A <code>spy</code> is a wrapper for a function (or object) that
    records information about calls made to it. In most frameworks, the function
    is replaced with a dummy or <code>stub</code>, sometimes with the option to
    "call through" to the original. In Jest and Sinon, the original function
    behavior is maintained (by default).
  </p>
 </div>

We stub rather than spy on `debug()` because we don’t actually want all that
console noise when we run hundreds of tests.

<div class="callout info">
  <p>
    In Sinon, a <code>stub</code> is a dummy replacement for a function.  It
    records all the same information that a spy does, but it also prevents the
    original function from running. Stubs accept all arguments<sup>*️⃣</sup> and
    return nothing by default, but you can define any behavior that calling
    functions might expect.  In Jest, these are called <code>mock</code>s.
  </p>
  <p>
    <small>*️⃣&ensp; In TypeScript, Sinon stubs accept the same arguments
    as the original function, and you’re expected define the return type to
    match as well.</small>
  </p>
</div>

<div class="callout note">
  <p>
    Sinon’s <code>mock</code>s are stubs that also have expectations attached to
    how they're used. This means they're prescriptively tied to implementation
    details, which is a specialty use case we won't get into here.
  </p>
</div>

<div class="callout warn">
  <p>
    It probably goes without saying that Sinon’s and Jest’s sensing,
    expectation/assertion, and matching classes are not interchangeable.
    However, there are some test utility libraries that let you mix them.
  </p>
</div>

Aaanyway, we then call the handler and then check for the expected effects.
These effects aren’t stateful, so we can’t look for evidence that they happened;
instead, we sense them with our spies. Notice the API is written in past tense:
`called*()`. This is because *we* are not the spy, nor do the spies let us
intercept the calls as they happen. Instead, we have to ask our spies *after the
fact* to report to us what they witnessed.

In unit testing our handlers, this is all straightforward. Call the function,
check the spies. Everything that happens after we hear an event is synchronous.
How do we test that events are sounding and being heard correctly?

#### Targeted language

I’m using this sounding/listening/hearing language deliberately. Events are not
thrown and caught like exceptions. Neither are they sent and received like
messages. We attach “event listeners” to `EventTarget`s to declare that the
target is listening for events of a particular `type`. Hearing and responding to
an event doesn’t necessarily prevent other listeners on the same target or even
other targets from also hearing and responding to the event. The grand scheme of
how events are propagated and captured is fairly complicated and out of scope of
what we’re doing here; but, generally speaking, unless otherwise prevented,
events flow in two phases: first they are **dispatched** to a target’s children,
and then they are **bubbled** to a target’s parent. A target can be *anything*
to which an event is dispatched, whether or not it’s listening.

### An asynchronous integration test

```typescript
// app.test.ts

import { spy, stub } from "sinon";
import * as effects from "../effects";

describe("events", () => {
  describe("foo_event", () => {
    test("fires aliceEffect()", async () => {
      spy(effects, "aliceEffect"");
      stub(console, "debug");
      /* ... */
    });
  });
});
```

The system under test will now be our whole app’s event handling setup, so,
while not end-to-end (i.e. in a browser), I’d still call it a kind of
integration test. One thing that makes it tricky is that our handler—the thing
we want to sense (exported by `src/effects.ts`)—is a dependency of the module
under test (imported by `src/app.ts`).

We can import and spy on `aliceEffect()` in the test file, as we did with
`debug()`, but the `src/effects.ts` module *cached* for use in `src/app.ts` is
probably not same code that was spied on. (Sinon’s docs remind us that exports
can’t be destructured—a common and desirable way to import methods—without
breaking those references.) So we’ll have to create a link seam: load,
intercept, mock, and cache the dependent module app-wide, but only while its
consumers are under test.

As much as I love Sinon, it’s not a module interceptor…but Jest is. The easiest
way to get Jest to do what we want is with the two-part incantation:

```typescript
import "./foo-module"; // whether or not we use anything from it in this test file
jest.mock("./foo-module");
```

:magic_wand: And now :magic_wand: *for every test scope in <u>this</u> module*
(including `beforeAll()`, etc.), `foo-module` will be mocked for the *whole
environment*. By default, it has the same API as the original, but all members
have been replaced by Jest mock functions which are synchronous, accept
anything, do nothing, and never throw. Very powerful. This is especially handy
for mocking modules that access external processes or need to be rerouted in
test (such as `fs`, `path`, or `fetch`).

We don’t actually want a whole mock, though. We want the module’s original
behavior in all ways, we just want to wrap *one* method in a spy before sending
the module off to be cached. So that’s what we tell Jest to do. The solution is
verbose but effective.

```typescript
// app.test.ts

import sinon, { SinonSpy, spy } from "sinon";
import { aliceEffect } from "../effects";

jest.mock("../effects", () => {
  const { aliceEffect, ...original } = jest.requireActual('../effects');
  return {
    ...original,
    __esModule: true,
    aliceEffect: spy(aliceEffect),
  };
});

afterEach(() => {
  (aliceEffect as SinonSpy).resetHistory();
  sinon.restore();
});
```

Now, when we `import { aliceEffect } from "../effects";` here and anywhere else
in the app (as long as it’s invoked from this test context), we’ll get the spy!

One last little gotcha: `jest.mock()` gets hoisted above *everything* in this
module, including the declaration of local variables. Incidentally, Sinon also
loses track of the spies we created in the mocked module.<sup>:asterisk:</sup>
But it's just as well—we don't want these spies restored between each test,
anyway. So in teardown, we'll explicitly call `resetHistory()` to clear their
call history between tests.

<div class="callout">
  <p>
    <small>*️⃣&ensp; We <em>could</em> memoize them to this module's
    scope (i.e.  <code>this</code> inside an arrow function callback passed to
    <code>jest.mock()</code> is the module scope), but it's really ugly and
    annoying to do in TypeScript and I don't wanna. Guess it’s TS’s way of
    discouraging too-clever JS shenanigans.</small>
  </p>
</div>

Now, let’s add the test:

```typescript
// app.test.ts

import sinon, { SinonSpy, assert, spy, stub } from "sinon";
import { aliceEffect } from "../effects";
import { init } from "../app";

jest.mock("../effects", () => { /* ... */ });

let clock: sinon.SinonFakeTimers;
beforeEach(() => {
  clock = sinon.useFakeTimers();
});
afterEach(() => {
  (aliceEffect as SinonSpy).resetHistory();
  sinon.restore();
  clock.restore();
});

describe("events", () => {
  describe("foo_event", () => {
    test("fires aliceEffect()", async () => {
      const event = new Event("foo_event", { bubbles: true });
      stub(console, "debug");
      init();
      document.body.dispatchEvent(event);
      await clock.runAllAsync();
      assert.calledOnceWithExactly(aliceEffect as SinonSpy, event);
    });
  });
});
```

The test itself shouldn’t be too surprising. First, notice that it’s declared
asynchronous

```typescript
test("fires aliceEffect()", async () => {
```

so we can use the `await` syntax.

We create a synthetic event with `{ bubbles: true }` because I want to
demonstrate that, wherever an event is sounded from, it can bubble up to the
“global” listeners attached to the window.

Stub `console.debug()` so it’s not noisy.

In most apps, we’ll have some setup helpers or rendering process that
initializes our test environment. In this stripped-down example, I’ve already
created a seam so we can attach our listeners *when* we want (i.e. after each
test’s sensing setup) with `init()`.

That done, we can get to the functional bit of the test: we have one of
`window`’s children sound a `foo_event`.

In the test setup (in `beforeEach()`), we created a test clock that can do two
things for us: it replaces all of the global time APIs (`setTimeout`,
`clearTimeout`, `setInterval`, `clearInterval`, `setImmediate`,
`clearImmediate`, `process.hrtime`, `performance.now`, and `Date`) with versions
we can control, and it has some methods that break the event loop and flush
pending callbacks and outstanding promises. This means that if, in the actual
running of our app, we would have to wait for a timeout to callback or an
endpoint to return, in test, we can fast-forward to the moment when all that is
done. Why should we wait at a red light when, not only is there no traffic, but
we control the traffic?

To finish up the test, we tell the clock to advance time, flushing all the
scheduled asynchronous calls. This includes our events bubbling, our listeners
hearing and our handlers handling.

<div class="callout note">
  <p>Jest also has fake timers and they function much the same.</p>
  <p>
    If you find you have to wait an arbitrary amount of time for things not tied
    to job scheduling (animations, cascading events, the (dis)appearance of
    elements), <code>@testing-library/dom</code> has utilities such as
    <code>waitFor()</code>, which will retry any code you give it until it
    doesn’t throw. For example:
  </p>
  <p><pre><code>await waitFor(() => { expect(appearingElementQuery).toBeTruthy(); });</code></pre></p>
</div>

Finally, we assert our spy saw what we expected it to see. While TypeScript
remembers `aliceEffect()`’s signature as the way we wrote it, that was at
compile time. We know it will be replaced by a spy at runtime; so, we have to
cast it to a `SinonSpy` to please `calledOnceWithExactly()`’s API.

That’s all there is to it! :tada:

(Yeah, I know it’s a lot.)

#### Testing downstream effects

One can imagine that, in a simple setup like this, when we have a ton of
top-level listeners, we can probably take for granted that the right handlers
are called for the right events. Testing that *every* handler that is declared
and attached the same way is called the same way is pretty tedious, and I get
diminishing ROI in terms of confidence per test written. It’s probably better to
seam up and unit test our listener configuration and attachment algorithm; then,
assuming that works, test the final effects of sounding events over testing that
the handler itself was called.

```typescript
// app.test.ts

describe("init", () => {
  test("given a configuration of events and handlers, attaches listeners to \
  the window", async () => {
    const config: { [x: string]: sinon.SinonStub } = {};
    for (const eventType of ["zim", "gir", "dib", "gaz"])
      config[eventType] = stub();
    init(config);
    for (const eventType of Object.keys(config))
      document.body.dispatchEvent(new Event(eventType, { bubbles: true }));
    await clock.runAllAsync();
    for (const [type, handler] of Object.entries(config))
      assert.calledOnceWithExactly(handler, match({ type }));
  });
});

describe("events", () => {
  describe("foo_event", () => {
    test("logs to console.debug()", async () => {
      const debugStub = stub(console, "debug");
      init();
      document.body.dispatchEvent(new Event("foo_event", { bubbles: true }));
      await clock.runAllAsync();
      assert.calledOnceWithExactly(debugStub, "foo_event in aliceEffect()");
    });

    test("fires aliceEffect()", async () => { /* ... */ });
  });
});
```

### Let’s add complexity

Now that we have the idea, let’s add another handler, and this one should
respond to `bar_event`s.

```typescript
// effects.ts

export function bobEffect(_event: Event) {
  console.debug("bar_event in bobEffect()");
}
```

```typescript
// app.ts

import { aliceEffect, bobEffect } from "./effects";

const LISTENER_CONFIG: tConfig = {
  foo_event: aliceEffect,
  bar_event: bobEffect
};
```

And to test:

```typescript
// effects.test.ts

import { aliceEffect, bobEffect } from "../effects";

describe("bobEffect()", () => {
  test('logs "bar_event" to the console (debug)', () => {
    const debugStub = stub(console, "debug");
    bobEffect(new Event("bar_event"));
    assert.calledOnceWithExactly(debugStub, "bar_event in bobEffect()");
  });
});
```

```typescript
// app.test.ts

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

afterEach(() => {
  (aliceEffect as SinonSpy).resetHistory();
  (bobEffect as SinonSpy).resetHistory();
  clock.restore();
  sinon.restore();
});

describe("events", () => {
  describe("bar_event", () => {
    const event = new Event("bar_event", { bubbles: true });
    let debugStub: sinon.SinonStub;

    beforeEach(async () => {
      debugStub = stub(console, "debug");
      init();
      document.body.dispatchEvent(event);
      await clock.runAllAsync();
    });

    test("fires bobEffect()", () => {
      assert.calledOnceWithExactly(bobEffect as SinonSpy, event);
    });
    test("logs to console.debug()", () => {
      assert.calledOnceWithExactly(debugStub, "bar_event in bobEffect()");
    });
  });

  describe("foo_event", () => { /* ... */ });
});
```

Notice we have to update the mocked module to return the spy-wrapped
`bobEffect()`.

<div class="callout note">
  <p>
    I believe it’s a matter of taste how much repetition to extract into setup
    and teardown blocks. There are pros and cons to either extreme. Here, I’m
    DRYing the tests out to highlight repetition and save space.
  </p>
</div>

All the tests pass and everything looks good. We could continue on like this
indefinitely.

#### Logic creep

What if the powers-that-be were to say, “This is all great, but when the app
does `aliceEffect`, it should also do `bobEffect`.” We might solve it this way:

```typescript
// effects.ts

export function aliceEffect(event: Event) {
  console.debug("foo_event in aliceEffect()");
  bobEffect(event);
}

export function bobEffect(_event: Event) {
  ...
```

And of course we have to update our tests. Most of them are trivial, except…

```typescript
// app.test.ts

describe("foo_event", () => {
  const event = new Event("foo_event", { bubbles: true });

  beforeEach(async () => {
    stub(console, "debug");
    init();
    document.body.dispatchEvent(event);
    await clock.runAllAsync();
  });

  test("fires bobEffect()", () => {
    assert.calledOnceWithExactly(bobEffect as SinonSpy, event);
  });

  test("fires aliceEffect()", () => { /* ... */ });
  test("logs to console.debug()", () => { /* ... */ });
});
```

Even though it’s practically identical to the `aliceEffect()` test, this one
fails. The spy is never called. Why? The problem here is we have no seam by
which to sense `bobEffect` as a dependency of `aliceEffect` because they’re
declared in the same module. The spied-on `aliceEffect()` calls the real,
locally defined `bobEffect()`, not the spy. We need another seam.

<div class="question">
  <p>
    But why should one change an implementation just to make it easier to test?
  </p>
</div>

I won’t advocate for it in all situations, but a case of inadequate test seams
at least invites us to reconsider our implementation. Indeed, this points to
three potential issues:

1.  Poor discoverability: We can’t tell from our configuration object that a
    `foo_event` will trigger `bobEffect()`. That information is buried in the
    implementation and the tests.
2.  Artificial entanglement: `bobEffect()` doesn’t actually have any relation to
   `aliceEffect()`’s implementation. Instead, it’s related to *what triggers*
   `aliceEffect()`.
3.  Brittle behavior: Associating these effects in implementation opens us up to
    a whole new hell of special casing. What if the very next ask of us is, “Do
    `bobEffect` whenever the app does `aliceEffect`, *except*…”

Instead, let’s make our configuration/initializer more flexible. Now each event
type can be associated with either a single effect or an (arbitrary length)
array of effects:

```typescript
// app.ts

type tConfig = { [x: string]: tHandler | tHandler[] };

const LISTENER_CONFIG: tConfig = {
  foo_event: [aliceEffect, bobEffect],
  bar_event: bobEffect,
};

export function init(config: tConfig = LISTENER_CONFIG) {
  for (const [event, handlers] of Object.entries(config))
    for (const handler of castArray(handlers))
      window.addEventListener(event, handler);
}
```

```typescript
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
```

Verbose, but it gets the job done. There are many, many perfectly acceptable
ways to test this. It’s not really relevant to this article, but I thought I’d
include it as an example of what might constitute adequate coverage.

<div class="callout warn">
  <p>
    The handler configuration may be defined in an array, but this doesn’t
    determine their order of execution, only their order of attachment to the
    <code>window</code>. Thus <strong>we can’t safely make any assertions about
    the order of calls</strong> to <code>stubC</code>.
  </p>
</div>


### Wrapping it all up

After all that, we have one last failing test:

```typescript
// app.test.ts

describe("foo_event", () => {
  const event = new Event("foo_event", { bubbles: true });
  let debugStub: sinon.SinonStub;

  beforeEach(async () => {
    debugStub = stub(console, "debug");
    init();
    document.body.dispatchEvent(event);
    await clock.runAllAsync();
  });

  test("logs to console.debug()", () => {
    assert.calledTwice(debugStub);
    assert.calledWith(debugStub, "foo_event in aliceEffect()");
    assert.calledWith(debugStub, "foo_event in bobEffect()");
  });

  test("fires aliceEffect()", () => { /* ... */ });
  test("fires bobEffect()", () => { /* ... */ });
});
```

```shell
 FAIL  src/test/app.test.ts
  ● events › foo_event › logs to console.debug()

    AssertError: expected debug to be called with argument
    "foo_event in bobEffect()"

    Call 1:
    "foo_event in aliceEffect()"
    Call 2:
    "bar_event in bobEffect()"

      |     assert.calledTwice(debugStub);
      |     assert.calledWith(debugStub, "foo_event in aliceEffect()");
    > |     assert.calledWith(debugStub, "foo_event in bobEffect()");
      |            ^
      |   });
      | });
```

Recall:

```typescript
// effects.ts

export function bobEffect(_event: Event) {
  // same effect, regardless of the event received
  console.debug("bar_event in bobEffect()");
}
```

This innocuous little oversight is the real reason we’re here. `"bar_event in
bobEffect()"` is doing the heavy lifting of representing *any* and *all* complex
downstream effects an event could trigger. See how *easy* it is to bake our
assumptions into misleading naming, comments, and test cases/coverage.

Evented architectures are necessarily declarative; and, while it doesn’t often
look like it, JavaScript was designed as a functional language and works
beautifully as one. Thus, best practices dictate that we

- keep functions small;
- describe things plainly, as they are and what they do (and not how or what
  they’re used for); and,
- design for generics and polymorphism, pushing specificity as far as possible
  to the entry points or leaves of operational chains.

In test is our chance to verify those atoms, but, more importantly, it’s where
we both document and exercise our intentions and actual usage of these molecules
of behavior. If we mock everything but the atoms, the test will never tell us
more than what we implicitly assumed when we wrote them. If the following were
all the tests we wrote for `foo_event`:

```typescript
describe("foo_event", () => {
  const event = new Event("foo_event", { bubbles: true });

  beforeEach(async () => {
    stub(console, "debug");
    init();
    document.body.dispatchEvent(event);
    await clock.runAllAsync();
  });

  test("fires aliceEffect()", () => {
    assert.calledOnceWithExactly(aliceEffect as SinonSpy, event);
  });
  test("fires bobEffect()", () => {
    assert.calledOnceWithExactly(bobEffect as SinonSpy, event);
  });
});
```

we never would have caught that `bobEffect()` assumes a `bar_event` and does the
*wrong thing* for other events.

I’d go as far as to say we don’t even need these sorts of tests. The unit tests
in `effect.ts` cover this behavior. Do we actually care that sounding a
`foo_event` triggers these implementation details? No, what we care about is
that `foo_event` gets the right strings logged to the console. Then *that*’s
what we should test.

The moral of the story is this:

<div class="callout error">
  <p>
    Don’t test that your code <strong>says what you told it</strong> to say.
  </p>
</div>

<div class="callout success">
  <p>
    Test that your code <strong>does what you intend</strong> it to do. (And
    falsifiably so!)
  </p>
</div>

---

## References

<sup><a id="1">1</a></sup> Wikimedia Foundation. (2022, August 17). _Side effect
(computer science)_.  Wikipedia. Retrieved December 13, 2022, from
https://en.wikipedia.org/wiki/Side_effect_(computer_science)

<style>
  .callout,
  .question {
    margin: 1em 0em;
    padding-bottom: 0.25em;
    padding-left: 1em;
    padding-right: 1em;
    padding-top: 1em;
  }
  .callout {
    background-color: rgba(255, 255, 255, 0.1);
    border-radius: 0.25em;
  }
  .question {
    font-weight: bold;
  }
  .callout p:first-child,
  .question p:first-child {
    position: relative;
  }
  .callout p:first-child::before,
  .question p:first-child::before {
    align-items: center;
    bottom: 0;
    display: flex;
    font-size: 150%;
    left: -1.5em;
    position: absolute;
    top: 0;
  }
  .error,
  .info,
  .note,
  .question,
  .success,
  .warn {
    padding-left: 3.25em;
  }
  .error {
    background-color: rgba(252, 92, 101, 0.25); /* fusion red */
  }
  .info {
    background-color: rgba(69, 170, 242, 0.25); /* high blue */
    }
  .note {
    background-color: rgba(165, 94, 234, 0.25); /* lighter purple */
  }
  .success {
    background-color: rgba(38, 222, 129, 0.25); /* reptile green */
  }
  .warn {
    background-color: rgba(254, 211, 48, 0.25); /* flirtatious */
  }
  .error p:first-child::before {
    content: "❌";
  }
  .info p:first-child::before {
    content: "ℹ️";
  }
  .note p:first-child::before {
    content: "📝";
  }
  .question p:first-child::before {
    content: "❓";
  }
  .success p:first-child::before {
    content: "✅";
  }
  .warn p:first-child::before {
    content: "⚠️";
  }
</style>
