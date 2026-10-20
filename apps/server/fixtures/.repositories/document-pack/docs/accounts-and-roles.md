---
title: Accounts and roles
description: The four roles of a Tidewell workspace, what each may do, how a person is deactivated, and two-step sign-in.
---

# Accounts and roles

Every person in a workspace has exactly one role. Roles decide what a person sees and may change; they never limit which jobs a technician can be assigned to.

## The four roles

| Role | Who it is for | Sees | May change |
|---|---|---|---|
| Owner | The business owner or general manager | Everything, including billing and the audit log | Everything, including roles, the plan and the workspace settings |
| Dispatcher | Whoever runs the board | Jobs, customers, technicians' schedules | Jobs, customers, assignments, templates |
| Technician | The people in the field | Their own jobs and the customers on them | Notes, photos, parts and the status of their own jobs |
| Bookkeeper | Whoever does the accounts | Invoices, payments, customers | Invoices, payment records, tax settings, the accounting export |

A workspace must keep at least one owner. The last owner cannot change their own role or deactivate themselves.

## Changing a role

An owner changes a role from the People page; the change applies at the person's next request, and a technician promoted to dispatcher sees the full board the next time the app refreshes. Lowering a role never removes the person's name from work they did.

## Deactivating a person

Deactivating ends a person's access at once, on the web and in the mobile app, and keeps their history: completed jobs, notes and photos stay attributed to them. Their open jobs are left unassigned for the dispatcher to reassign, and the seat is freed for someone else. A deactivated person can be reactivated with the same email address and gets their history back.

Deleting a person outright is not possible, because invoices and the audit log refer to them.

## Two-step sign-in

Owners and bookkeepers must turn on two-step sign-in with an authenticator app; dispatchers and technicians may. The codes come from any app that implements time-based one-time passwords. Ten backup codes are shown once when two-step sign-in is turned on; store them somewhere safe, since a lost phone without them locks the account until another owner resets it.

An owner can reset another person's two-step sign-in from the People page; the person then sets it up again at their next sign-in.

## Session length

A web session lasts thirty days on a device the person marked as trusted and twelve hours elsewhere. The mobile app stays signed in until the person signs out or is deactivated.
