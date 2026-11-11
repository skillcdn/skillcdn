---
title: Carrier loss and resumption
description: When the carrier of a link counts as lost, how long a buoy tries to take the link up again, and what it keeps when it gives up, each point quoted from the clause that says it.
derived:
  kind: note
  from: ../link-protocol
  by: a run that answered questions about link failures
  at: 2026-11-11
---
# Carrier loss and resumption

## When the carrier counts as lost

The loss is a count of windows, not a time.

> At the count maxSilentWindows the carrier is lost.
>
> — [4.2.7](../link-protocol/04-link-control/040-4.2.7-to-4.2.8-carrier-loss.md#4.2.7)

One window of noise does not start it.

> A single window of noise is no loss: the count starts again whenever the carrier is heard.
>
> — [4.2.7](../link-protocol/04-link-control/040-4.2.7-to-4.2.8-carrier-loss.md#4.2.7)

## How long a buoy tries

The buoy begins, and two guard times bound the attempt.

> A buoy that detects the loss of its carrier … enters HELD and sends a LinkResumeRequest in its next window.
>
> — [4.2.6.1](../link-protocol/04-link-control/030-4.2.6-link-resumption.md#4.2.6.1)

> The buoy waits g21 after a request before it sends the next, and gives up after g22 in all.
>
> — [4.2.6.2](../link-protocol/04-link-control/030-4.2.6-link-resumption.md#4.2.6.2)

The bounds of the first are in the definition.

> g21       Milliseconds (100..6000)
>
> — [6.1.8](../link-protocol/06-messages/010-6.1-message-definitions.md#6.1.8)

## What is kept when it gives up

> When g22 runs out the buoy returns to LISTEN and keeps its measurements.
>
> — [4.2.6.3](../link-protocol/04-link-control/030-4.2.6-link-resumption.md#4.2.6.3)
