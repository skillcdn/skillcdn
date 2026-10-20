---
title: API authentication
description: How a request to the Tidewell API is authenticated with an API key, which scopes exist, how keys are rotated, and the rate limits.
---

# API authentication

Every request carries an API key an owner created under Settings. Keys belong to the workspace, not to a person, so a request made with a key is recorded in the audit log as the key's name.

## The authorization header

Send the key in the `Authorization` header with the `Bearer` scheme. A request without a key, or with a revoked one, is answered with status 401 and a JSON body whose `error` is `unauthorized`. A key that lacks the scope a request needs is answered with 403 and `forbidden`.

## Scopes

A key has one or more scopes: `jobs:read`, `jobs:write`, `customers:read`, `customers:write`, `invoices:read`. Writing invoices is not possible through the API; an invoice is made from a done job in the app. Choose the smallest set a program needs, and make one key per program so that revoking one does not break the others.

## Rotating a key

Create the new key, switch the program to it, then revoke the old key from the same page. A revoked key fails immediately, and its name stays in the audit log on the requests it made. Keys unused for ninety days are flagged on the page as candidates for revocation.

## Rate limits

A key may make six hundred requests per minute. Beyond that, requests are answered with status 429 and a `Retry-After` header saying how many seconds to wait. Listing endpoints count once per page; a program that polls should instead subscribe to webhooks, which push changes without polling.
