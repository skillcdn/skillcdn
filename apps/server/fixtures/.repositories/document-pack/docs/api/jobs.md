---
title: Jobs API
description: The job object, and how to list, create, update and cancel jobs through the API, with pagination.
---

# Jobs API

Jobs are the work on the board. The API reads and writes them under `/v1/jobs`.

## The job object

A job has an `id`, a `customer_id`, a `technician_id` or null when unassigned, a `status` among `scheduled`, `on_the_way`, `in_progress`, `done` and `cancelled`, a `starts_at` and a `duration_minutes`, the `address` of the service, `notes`, and `lines`, the parts and hours recorded on it. Times are in the time zone of the workspace, written with their offset.

## Listing jobs

`GET /v1/jobs` lists jobs newest first. Filter with `status`, `technician_id`, `customer_id`, and a window with `from` and `to` on the start time. The list is paged: each page has at most one hundred jobs and a `next_cursor` to pass as `cursor` for the following page; a missing cursor means the last page. Cursors expire after an hour.

## Creating a job

`POST /v1/jobs` with a `customer_id`, `starts_at`, `duration_minutes` and `address` creates a scheduled job; `technician_id` is optional and leaves the job in the tray when absent. A job that overlaps another job of the same technician is created with a `warnings` list in the response naming the conflict, and shows on the board with a red outline. The `Idempotency-Key` header makes a repeated request return the job created the first time instead of a second job.

## Updating a job

`PATCH /v1/jobs/{id}` changes any field of a job that has not started. A job in progress accepts only `notes` and `lines`. Changing `starts_at` or `technician_id` reschedules the job, with the reminders and alerts the board would send.

## Cancelling a job

`POST /v1/jobs/{id}/cancel` cancels a job and keeps it in the customer's history; `POST /v1/jobs/{id}/restore` within thirty days brings it back. A done job cannot be cancelled: void or credit its invoice instead.
