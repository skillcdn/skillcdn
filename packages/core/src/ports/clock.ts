/** The only source of "now". Injected so that the domain stays deterministic and tests stay stable. */
export interface Clock {
  now(): Date;
}
