---
title: Customers API
description: Listing and creating customers through the API, finding a customer by phone or email, and merging duplicates.
---

# Customers API

Customers are the people and companies jobs are done for, under `/v1/customers`.

## The customer object

A customer has an `id`, a `name`, an optional `company`, `emails` and `phones` as lists, `addresses` with one marked as default, a `tax_exempt` flag with the exemption number, and `notes`. Deleted customers are not returned; a customer with jobs cannot be deleted, only archived.

## Listing and finding customers

`GET /v1/customers` lists customers alphabetically, one hundred per page with a cursor. `GET /v1/customers?phone=` and `?email=` find customers by an exact phone number or email address, normalized before matching, so that spaces and punctuation in a phone number do not matter.

## Creating a customer

`POST /v1/customers` needs a `name` and at least one phone number or email address. A request whose phone number or email address matches an existing customer is answered with status 409 and the `id` of that customer, unless `allow_duplicate` is true.

## Merging duplicates

`POST /v1/customers/{id}/merge` with `into` moves the jobs, invoices and notes of one customer onto another and archives the first. The merge cannot be undone; the audit log records which customer was merged into which.
