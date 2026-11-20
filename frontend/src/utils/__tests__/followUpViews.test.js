import { describe, it, expect } from "vitest";

import {
    FOLLOWUP_VIEWS,
    filtersForView,
    resolveFollowUpView,
    statusesForView,
    statusOptionsForView,
    summaryFilters,
} from "../followUpViews";

describe("resolveFollowUpView", () => {

    it("is Open when the URL names no view", () => {
        expect(resolveFollowUpView(null, {})).toBe("open");
        expect(resolveFollowUpView("nonsense", {})).toBe("open");
    });

    it("honours an explicit History or All", () => {
        expect(resolveFollowUpView("history", {})).toBe("history");
        expect(resolveFollowUpView("all", {})).toBe("all");
    });

    it("shows a pre-views link that asks for a non-pending status as All", () => {
        expect(resolveFollowUpView(null, { status: ["COMPLETED"] })).toBe("all");
        expect(resolveFollowUpView(null, { status: ["PENDING", "MISSED"] })).toBe("all");
        expect(resolveFollowUpView(null, { status: ["PENDING"] })).toBe("open");
    });
});

describe("statusesForView / filtersForView", () => {

    it("Open is PENDING only", () => {
        expect(filtersForView("open", {})).toEqual({ status: ["PENDING"] });
    });

    it("History is completed, missed and cancelled", () => {
        expect(filtersForView("history", {})).toEqual({ status: ["COMPLETED", "MISSED", "CANCELLED"] });
    });

    it("All sends no status restriction", () => {
        expect(filtersForView("all", {})).toEqual({});
    });

    it("an individual status filter narrows the view", () => {
        expect(statusesForView("history", ["CANCELLED"])).toEqual(["CANCELLED"]);
        expect(statusesForView("all", ["PENDING", "MISSED"])).toEqual(["PENDING", "MISSED"]);
    });

    it("a status filter from another view is ignored, not turned into an empty list", () => {
        expect(statusesForView("history", ["PENDING"])).toEqual(FOLLOWUP_VIEWS.history.statuses);
        expect(statusesForView("open", ["COMPLETED"])).toEqual(["PENDING"]);
    });

    it("keeps the other filters", () => {
        expect(filtersForView("history", { activityTypeId: ["3"], scheduledFrom: "2026-01-01" }))
            .toEqual({ activityTypeId: ["3"], scheduledFrom: "2026-01-01", status: ["COMPLETED", "MISSED", "CANCELLED"] });
    });
});

describe("helpers", () => {

    it("summaryFilters drops only the status", () => {
        expect(summaryFilters({ status: ["PENDING"], activityTypeId: ["3"] })).toEqual({ activityTypeId: ["3"] });
    });

    it("the Status filter only offers what the view can show", () => {
        const options = [
            { value: "PENDING" }, { value: "COMPLETED" }, { value: "MISSED" }, { value: "CANCELLED" },
        ];

        expect(statusOptionsForView("open", options)).toHaveLength(1);
        expect(statusOptionsForView("history", options).map((o) => o.value))
            .toEqual(["COMPLETED", "MISSED", "CANCELLED"]);
        expect(statusOptionsForView("all", options)).toHaveLength(4);
    });

    it("sorts Open oldest first and the other views newest first", () => {
        expect(FOLLOWUP_VIEWS.open.sort).toEqual({ field: "scheduledDate", dir: "asc" });
        expect(FOLLOWUP_VIEWS.history.sort.dir).toBe("desc");
        expect(FOLLOWUP_VIEWS.all.sort.dir).toBe("desc");
    });
});
