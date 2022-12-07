// app.ts

import { castArray } from "lodash";
import { aliceEffect, bobEffect } from "./effects";

type tHandler = (event: Event) => void;
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
