// The Follow-ups page's three views, kept apart from the page so the rules are
// plain functions that can be tested on their own.
//
//  - open    (the default): PENDING only - the actionable work;
//  - history: COMPLETED, MISSED and CANCELLED;
//  - all:     every status.
//
// The view lives in the URL as `view=history` / `view=all`; `open` is the
// absence of the parameter, so a plain /followups link always lands on the
// actionable list. It is an explicit parameter (not a status filter) because
// the shared list hook drops empty filters from the URL: a default status filter
// would look exactly like "no filter", and Clear Filters could not tell a user
// who cleared it from a user who never set it.

export const FOLLOWUP_VIEWS = {
    open: {
        label: "Open",
        hint: "Pending follow-ups only",
        statuses: ["PENDING"],
        // overdue work first
        sort: { field: "scheduledDate", dir: "asc" },
    },
    history: {
        label: "History",
        hint: "Completed, missed and cancelled",
        statuses: ["COMPLETED", "MISSED", "CANCELLED"],
        // most recent first
        sort: { field: "scheduledDate", dir: "desc" },
    },
    all: {
        label: "All",
        hint: "Every status",
        statuses: null,
        // newest first - the old ascending order put years-old completed rows ahead of upcoming work
        sort: { field: "scheduledDate", dir: "desc" },
    },
};

export const FOLLOWUP_VIEW_KEYS = ["open", "history", "all"];

// The view named by the URL. A link or bookmark saved before the views existed
// carries only a status filter: one that asks for anything other than PENDING
// (e.g. status=COMPLETED) keeps showing those records, as All.
export function resolveFollowUpView(viewParam, filters) {

    if (viewParam === "history" || viewParam === "all") {
        return viewParam;
    }

    const legacyStatuses = Array.isArray(filters?.status) ? filters.status : [];

    if (legacyStatuses.some((s) => s && s !== "PENDING")) {
        return "all";
    }

    return "open";
}

// The statuses to request: the user's own Status filter narrowed to what the
// view allows. A selection that has nothing in common with the view (a stale
// filter from another view) is ignored rather than producing an empty list.
// undefined = no status restriction (the All view without a Status filter).
export function statusesForView(view, selected) {

    const allowed = FOLLOWUP_VIEWS[view]?.statuses ?? null;
    const chosen = (Array.isArray(selected) ? selected : []).filter((s) => !allowed || allowed.includes(s));

    if (chosen.length > 0) {
        return chosen;
    }

    return allowed || undefined;
}

// Filters as sent to the server (list and export): the other filters as they
// are, with the status set decided by the view.
export function filtersForView(view, filters) {

    const { status, ...rest } = filters || {};
    const statuses = statusesForView(view, status);

    return statuses ? { ...rest, status: statuses } : rest;
}

// Filters for the summary counts: everything except the status, which the
// counts are broken down by.
export function summaryFilters(filters) {

    const { status, ...rest } = filters || {}; // eslint-disable-line no-unused-vars

    return rest;
}

// The Status filter offered in the panel: only statuses the view can show
// (none for Open, which is one status).
export function statusOptionsForView(view, options) {

    const allowed = FOLLOWUP_VIEWS[view]?.statuses ?? null;

    return allowed ? options.filter((o) => allowed.includes(o.value)) : options;
}
