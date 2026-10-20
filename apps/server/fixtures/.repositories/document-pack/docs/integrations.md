---
title: Integrations
description: Calendar sync, the accounting export, card payments through a processor, webhooks for other systems, and API keys.
---

# Integrations

Tidewell works with the tools a company already has: the calendars people look at, the accounting software the bookkeeper uses, a card processor, and any other system through webhooks and the API.

## Calendar sync

Each technician can subscribe to their jobs as a calendar feed, read-only, in any calendar app that takes a subscription address. The feed shows the next ninety days and updates within a few minutes of a change on the board. An owner can turn the feeds off for the whole workspace, which invalidates every address issued.

## Accounting export

The bookkeeper exports invoices, payments and credit notes for a period as a file the common accounting programs import, with one line per invoice line and the tax as its own line. An export marks what it covered, so the next export starts after it; an invoice edited after it was exported appears again in the next export as a correction.

## Card payments

Card payments run through a payment processor the owner connects under Settings. Customers pay from the link on the invoice; the processor's fee is deducted before the payout, and the payout arrives in the company's bank account on the processor's schedule. Tidewell never sees or stores a card number. Refunds go back through the processor to the same card.

## Webhooks

A webhook posts a JSON message to an address of yours whenever a job or an invoice changes: created, scheduled, started, done, cancelled, sent, paid, refunded. Each message is signed with the webhook's secret so the receiver can verify it, and a message that is not acknowledged with a success status is retried with increasing delays for twenty-four hours, then dropped and listed under the webhook as failed. The API creates a webhook from its address and its secret, sent as `{"url":"https://...","secret":"..."}` with the real values in place.

## API keys

An owner creates API keys under Settings, each with a name and a set of scopes: read jobs, write jobs, read customers, write customers, read invoices. The key is shown once; Tidewell keeps only a hash. A key is rotated by creating a new one and revoking the old one once every integration uses the new key. Keys that have not been used for ninety days are flagged on the page so that forgotten ones get revoked.
