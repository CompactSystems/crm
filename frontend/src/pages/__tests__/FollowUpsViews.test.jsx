// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const followups = vi.hoisted(() => ({
    getAllFollowUps: vi.fn(),
    getFollowUpSummary: vi.fn(),
    bulkDeleteFollowUps: vi.fn(),
    exportFollowUps: vi.fn(),
}));

vi.mock("../../services/followupService", () => followups);
vi.mock("../../services/employeeService", () => ({ getAllEmployees: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/activityTypeService", () => ({
    getAllActivityTypes: vi.fn().mockResolvedValue([{ id: 3, name: "Call" }]),
}));

import FollowUps from "../FollowUps";

const SUMMARY = { total: 130, pending: 40, completed: 80, missed: 5, cancelled: 5, dueToday: 7 };
const HISTORY = ["COMPLETED", "MISSED", "CANCELLED"];

const probe = { url: "" };

function UrlProbe() {
    const location = useLocation();
    useEffect(() => { probe.url = location.pathname + location.search; });
    return null;
}

function renderAt(url) {
    return render(
        <MemoryRouter initialEntries={[url]}>
            <UrlProbe />
            <Routes>
                <Route path="*" element={<FollowUps />} />
            </Routes>
        </MemoryRouter>
    );
}

function lastListCall() {
    const calls = followups.getAllFollowUps.mock.calls;
    return calls[calls.length - 1][0];
}

function urlParams() {
    return new URLSearchParams(probe.url.split("?")[1] || "");
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("role", "EMPLOYEE");
    followups.getAllFollowUps.mockResolvedValue({ content: [], totalPages: 0, totalElements: 0 });
    followups.getFollowUpSummary.mockResolvedValue(SUMMARY);
    followups.exportFollowUps.mockResolvedValue(new Blob(["x"]));
    window.alert = vi.fn();
    window.URL.createObjectURL = vi.fn(() => "blob:x");
    window.URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("Follow-ups views", () => {

    it("opens on Open: pending only, oldest first, and says so", async () => {
        renderAt("/followups");

        await waitFor(() => expect(followups.getAllFollowUps).toHaveBeenCalled());

        expect(lastListCall().filters.status).toEqual(["PENDING"]);
        expect(lastListCall().sort).toEqual({ field: "scheduledDate", dir: "asc" });
        expect(screen.getByRole("tab", { name: /Open/ }).getAttribute("aria-selected")).toBe("true");
        expect(screen.getByRole("tab", { name: /History/ }).getAttribute("aria-selected")).toBe("false");
        expect(urlParams().get("view")).toBeNull();
    });

    it("History shows completed, missed and cancelled, newest first, and is kept in the URL", async () => {
        renderAt("/followups");
        await waitFor(() => expect(followups.getAllFollowUps).toHaveBeenCalled());

        fireEvent.click(screen.getByRole("tab", { name: /History/ }));

        await waitFor(() => expect(lastListCall().filters.status).toEqual(HISTORY));
        expect(lastListCall().sort).toEqual({ field: "scheduledDate", dir: "desc" });
        expect(urlParams().get("view")).toBe("history");
        expect(screen.getByRole("tab", { name: /History/ }).getAttribute("aria-selected")).toBe("true");
    });

    it("All sends no status restriction", async () => {
        renderAt("/followups");
        await waitFor(() => expect(followups.getAllFollowUps).toHaveBeenCalled());

        fireEvent.click(screen.getByRole("tab", { name: /^All/ }));

        await waitFor(() => expect(urlParams().get("view")).toBe("all"));
        await waitFor(() => expect(lastListCall().filters.status).toBeUndefined());
    });

    it("switching back to Open removes the view parameter", async () => {
        renderAt("/followups?view=history");
        await waitFor(() => expect(followups.getAllFollowUps).toHaveBeenCalled());

        fireEvent.click(screen.getByRole("tab", { name: /Open/ }));

        await waitFor(() => expect(urlParams().get("view")).toBeNull());
        await waitFor(() => expect(lastListCall().filters.status).toEqual(["PENDING"]));
    });

    it("a refresh or shared link restores the view, search, page and filters", async () => {
        const filters = encodeURIComponent(JSON.stringify({ activityTypeId: ["3"] }));

        renderAt(`/followups?view=history&q=acme&page=2&filters=${filters}`);
        await waitFor(() => expect(followups.getAllFollowUps).toHaveBeenCalled());

        const call = lastListCall();
        expect(call.search).toBe("acme");
        expect(call.page).toBe(1);
        expect(call.filters.activityTypeId).toEqual(["3"]);
        expect(call.filters.status).toEqual(HISTORY);
        expect(screen.getByRole("tab", { name: /History/ }).getAttribute("aria-selected")).toBe("true");
    });

    it("switching view keeps the search and other filters but returns to page 1", async () => {
        const filters = encodeURIComponent(JSON.stringify({ activityTypeId: ["3"] }));

        renderAt(`/followups?q=acme&page=3&filters=${filters}`);
        await waitFor(() => expect(followups.getAllFollowUps).toHaveBeenCalled());

        fireEvent.click(screen.getByRole("tab", { name: /History/ }));

        await waitFor(() => expect(urlParams().get("view")).toBe("history"));
        expect(urlParams().get("q")).toBe("acme");
        expect(urlParams().get("page")).toBeNull();
        expect(JSON.parse(urlParams().get("filters"))).toEqual({ activityTypeId: ["3"] });
    });

    it("an old link with a non-pending status filter opens as All and says so in the URL", async () => {
        const filters = encodeURIComponent(JSON.stringify({ status: ["COMPLETED"] }));

        renderAt(`/followups?filters=${filters}`);

        await waitFor(() => expect(urlParams().get("view")).toBe("all"));
        await waitFor(() => expect(lastListCall().filters.status).toEqual(["COMPLETED"]));
        expect(screen.getByRole("tab", { name: /^All/ }).getAttribute("aria-selected")).toBe("true");
    });

    it("Clear Filters keeps the view and leaves no hidden default behind", async () => {
        const filters = encodeURIComponent(JSON.stringify({ activityTypeId: ["3"] }));

        renderAt(`/followups?view=history&filters=${filters}`);
        await waitFor(() => expect(followups.getAllFollowUps).toHaveBeenCalled());

        fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
        fireEvent.click(await screen.findByText("Clear Filters"));

        await waitFor(() => expect(urlParams().get("filters")).toBeNull());
        expect(urlParams().get("view")).toBe("history");
        await waitFor(() => expect(lastListCall().filters).toEqual({ status: HISTORY }));
    });

    it("an Open page with nothing pending points to History", async () => {
        renderAt("/followups");

        expect(await screen.findByText(/No pending follow ups.*History/)).toBeTruthy();
    });
});

describe("Follow-ups summary", () => {

    it("shows server totals, not the rows on the page", async () => {
        // two rows on the page, 130 in total
        followups.getAllFollowUps.mockResolvedValue({
            content: [
                { id: 1, status: "PENDING", scheduledDate: "2026-11-20T10:00:00", employee: { name: "A" }, related: {} },
                { id: 2, status: "COMPLETED", scheduledDate: "2026-11-20T11:00:00", employee: { name: "A" }, related: {} },
            ],
            totalPages: 1,
            totalElements: 2,
        });

        renderAt("/followups");

        expect(await screen.findByText("40", { selector: "h3" })).toBeTruthy();
        expect(screen.getByText("80", { selector: "h3" })).toBeTruthy();
        expect(screen.getByText("7", { selector: "h3" })).toBeTruthy();

        // tabs: Open = pending, History = completed + missed + cancelled, All = total
        expect(screen.getByRole("tab", { name: /Open/ }).textContent).toMatch(/40/);
        expect(screen.getByRole("tab", { name: /History/ }).textContent).toMatch(/90/);
        expect(screen.getByRole("tab", { name: /^All/ }).textContent).toMatch(/130/);
    });

    it("asks for the counts with the search and filters but without the status", async () => {
        const filters = encodeURIComponent(JSON.stringify({ activityTypeId: ["3"], status: ["COMPLETED"] }));

        renderAt(`/followups?q=acme&view=all&filters=${filters}`);

        await waitFor(() => expect(followups.getFollowUpSummary).toHaveBeenCalled());

        const args = followups.getFollowUpSummary.mock.calls[0][0];
        expect(args.search).toBe("acme");
        expect(args.filters).toEqual({ activityTypeId: ["3"] });
    });

    it("does not refetch the counts when only the page changes", async () => {
        followups.getAllFollowUps.mockResolvedValue({ content: [], totalPages: 3, totalElements: 120 });

        renderAt("/followups?page=2");
        await waitFor(() => expect(followups.getFollowUpSummary).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(followups.getAllFollowUps).toHaveBeenCalled());

        expect(followups.getFollowUpSummary).toHaveBeenCalledTimes(1);
    });

    it("shows a dash rather than a made-up number when the counts cannot be loaded", async () => {
        followups.getFollowUpSummary.mockRejectedValue(new Error("down"));

        renderAt("/followups");

        await waitFor(() => expect(followups.getFollowUpSummary).toHaveBeenCalled());
        expect((await screen.findAllByText("-", { selector: "h3" })).length).toBe(3);
    });
});

describe("Follow-ups export", () => {

    beforeEach(() => localStorage.setItem("role", "ADMIN"));

    async function exportAll() {
        await waitFor(() => expect(followups.getAllFollowUps).toHaveBeenCalled());
        fireEvent.click(screen.getByRole("button", { name: "Export" }));
        fireEvent.click(await screen.findByText("Export all matching"));
        await waitFor(() => expect(followups.exportFollowUps).toHaveBeenCalled());
        return followups.exportFollowUps.mock.calls[0][0];
    }

    it("exports only the open follow-ups from the Open view", async () => {
        renderAt("/followups");

        expect((await exportAll()).filters.status).toEqual(["PENDING"]);
    });

    it("exports the history statuses and the selected filters from the History view", async () => {
        const filters = encodeURIComponent(JSON.stringify({ activityTypeId: ["3"] }));

        renderAt(`/followups?view=history&q=acme&filters=${filters}`);

        const args = await exportAll();
        expect(args.filters.status).toEqual(HISTORY);
        expect(args.filters.activityTypeId).toEqual(["3"]);
        expect(args.filters.search).toBe("acme");
    });

    it("exports every status from the All view", async () => {
        renderAt("/followups?view=all");

        expect((await exportAll()).filters.status).toBeUndefined();
    });
});
