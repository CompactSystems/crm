// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

const dashboardService = vi.hoisted(() => ({ getDashboardStats: vi.fn() }));
vi.mock("../../services/dashboardService", () => dashboardService);
vi.mock("../../components/OpportunityAlerts", () => ({ default: () => null }));

import Dashboard from "../Dashboard";

function Where() {
    const location = useLocation();
    return <div data-testid="location">{location.pathname}</div>;
}

function renderDashboard(stats) {
    dashboardService.getDashboardStats.mockResolvedValue({
        leads: 0, customers: 0, opportunities: 0, followUps: 0,
        pipeline: {}, otherStages: {}, inProgressBreakdown: {},
        recentLeads: [], upcomingFollowUps: [],
        ...stats,
    });

    return render(
        <MemoryRouter initialEntries={["/"]}>
            <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="*" element={<Where />} />
            </Routes>
        </MemoryRouter>
    );
}

const overdue = [
    {
        id: 11, scheduledDate: "2026-11-10T09:30:00", status: "PENDING",
        leadId: 4, companyName: "Dropped Co", opportunityId: 40, activityTypeName: "Call",
    },
    {
        id: 12, scheduledDate: "2026-11-12T15:00:00", status: "PENDING",
        leadId: 5, companyName: null, opportunityId: null, activityTypeName: null,
    },
];

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("role", "EMPLOYEE");
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe("Dashboard - Overdue Follow Ups card", () => {

    it("shows the empty state when nothing is overdue (and when an older API sends no overdue fields)", async () => {
        renderDashboard({});

        const card = await screen.findByTestId("overdue-followups");
        expect(within(card).getByText("Overdue Follow Ups")).toBeTruthy();
        expect(within(card).getByText("No Overdue Follow Ups")).toBeTruthy();
        expect(within(card).queryByTestId("overdue-followups-count")).toBeNull();
        expect(within(card).queryAllByTestId("overdue-followup")).toHaveLength(0);
    });

    it("lists the overdue follow-ups in the order the API sends them, with count and fallbacks", async () => {
        renderDashboard({ overdueFollowUps: overdue, overdueFollowUpCount: 2 });

        const card = await screen.findByTestId("overdue-followups");
        const rows = within(card).getAllByTestId("overdue-followup");

        expect(rows).toHaveLength(2);
        expect(within(rows[0]).getByText("Dropped Co")).toBeTruthy();
        expect(within(rows[0]).getByText("Call")).toBeTruthy();
        expect(rows[0].textContent).toContain("Was due");
        expect(within(rows[1]).getByText("Unknown")).toBeTruthy();
        expect(within(rows[1]).getByText("Follow Up")).toBeTruthy();

        expect(within(card).getByTestId("overdue-followups-count").textContent).toBe("2");
        expect(within(card).queryByTestId("overdue-followups-more")).toBeNull();
        expect(within(card).queryByText("No Overdue Follow Ups")).toBeNull();
    });

    it("says how many more exist beyond the five shown", async () => {
        renderDashboard({ overdueFollowUps: overdue, overdueFollowUpCount: 9 });

        const more = await screen.findByTestId("overdue-followups-more");
        expect(more.textContent).toContain("and 7 more");
        expect(screen.getByTestId("overdue-followups-count").textContent).toBe("9");
    });

    it("keeps the Upcoming Follow Ups card separate", async () => {
        renderDashboard({
            overdueFollowUps: overdue,
            overdueFollowUpCount: 2,
            upcomingFollowUps: [{
                id: 21, scheduledDate: "2026-11-16T10:00:00", status: "PENDING",
                leadId: 6, companyName: "Today Co", opportunityId: 60, activityTypeName: "Visit",
            }],
        });

        const card = await screen.findByTestId("overdue-followups");
        expect(within(card).queryByText("Today Co")).toBeNull();
        expect(screen.getByText("Today Co")).toBeTruthy();
        expect(screen.getByText("Upcoming Follow Ups")).toBeTruthy();
    });

    it("opens the opportunity, or the lead when there is no opportunity", async () => {
        renderDashboard({ overdueFollowUps: overdue, overdueFollowUpCount: 2 });

        fireEvent.click((await screen.findAllByTestId("overdue-followup"))[0]);
        expect(screen.getByTestId("location").textContent).toBe("/opportunities/40");

        cleanup();
        renderDashboard({ overdueFollowUps: overdue, overdueFollowUpCount: 2 });

        fireEvent.click((await screen.findAllByTestId("overdue-followup"))[1]);
        expect(screen.getByTestId("location").textContent).toBe("/leads/5");
    });

    it("View All goes to the follow-ups list", async () => {
        renderDashboard({ overdueFollowUps: overdue, overdueFollowUpCount: 2 });

        const card = await screen.findByTestId("overdue-followups");
        fireEvent.click(within(card).getByText("View All"));
        expect(screen.getByTestId("location").textContent).toBe("/followups");
    });
});
