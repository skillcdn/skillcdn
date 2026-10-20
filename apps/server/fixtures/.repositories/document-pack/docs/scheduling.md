---
title: Scheduling
description: The board, creating jobs, recurring jobs, travel time and buffers, double bookings and how to reschedule.
---

# Scheduling

The board is where a dispatcher plans the day: one column per technician, one card per job, in the working hours of the workspace. Jobs can also be scheduled from a customer's page and from the API.

## The board

The board shows one day at a time, or a week with the technicians as rows. Unassigned jobs sit in the tray on the left until a dispatcher drags them onto a column. The color of a card is its status: grey for scheduled, blue for on the way, amber for in progress, green for done, red for a problem the technician flagged.

Filters narrow the board to a service area, a job type or a single technician, and the filter is remembered per person.

## Creating a job

A job is created by dragging a slot onto the board, from the customer's page, or by duplicating an earlier job for the same customer. It needs a customer, a service address, a start time and an expected duration. The duration defaults to the job type's duration, which the owner sets under Settings; a dispatcher can shorten or lengthen it per job.

A job may carry a checklist from a template, parts from the catalog, and an estimate, which becomes the quote the customer sees.

## Recurring jobs

A job can repeat weekly, every two weeks, monthly or on a custom interval, for a fixed number of times or until a date. Each occurrence is a job of its own: it can be moved, reassigned or cancelled without touching the others. Editing the series changes the occurrences that have not started yet and leaves the completed ones as they were.

Recurring jobs are created ninety days ahead, so the board never shows an occurrence further out than that.

## Travel time and buffers

Tidewell estimates travel time between consecutive jobs of a technician from the service addresses, and shows it as a hatched block between the cards. A buffer, set per job type, is added after each job for cleanup and paperwork. When a new job would not fit between its neighbours with the travel time and the buffer, the card is placed with a warning, and the dispatcher decides whether to keep it.

## Conflicts and double booking

Two jobs on one technician cannot overlap: dropping a card onto a slot that is already taken shows the conflict and offers the nearest free slot. A technician who is away, on leave or outside their working hours shows a shaded column, and jobs cannot be dropped there without confirming.

Overlaps that come in through the API are accepted with a warning in the response, because an integration may know better than the board; they appear on the board with a red outline.

## Rescheduling

Dragging a card to another time or column reschedules the job; the customer gets a reminder with the new time if reminders are on, and the technician gets an alert. Rescheduling a job that is in progress is not possible from the board, only from the job itself, so that the technician's running timer is not lost. Cancelling a job keeps it in the customer's history as cancelled, and a cancelled job can be restored within thirty days.
