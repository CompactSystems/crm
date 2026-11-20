// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const followups = vi.hoisted(() => ({
    createFollowUp: vi.fn(),
    getFollowUpTargets: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../services/followupService", () => followups);
vi.mock("../../services/leadService", () => ({
    getLeadById: vi.fn(),
    getAllLeads: vi.fn().mockResolvedValue({ content: [] }),
}));
vi.mock("../../services/opportunityService", () => ({
    getOpportunityById: vi.fn().mockResolvedValue({
        id: 9, title: "Genset deal", lead: { id: 4, companyName: "Acme", assignedEmployee: { id: 2, name: "Asha" } },
        salesStage: { name: "IN PROGRESS" },
    }),
    getAllOpportunities: vi.fn().mockResolvedValue({ content: [] }),
}));
vi.mock("../../services/employeeService", () => ({ getAllEmployees: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/activityTypeService", () => ({
    getAllActivityTypes: vi.fn().mockResolvedValue([{ id: 3, name: "Call" }]),
    getAllActivityTypesAdmin: vi.fn(),
    createActivityType: vi.fn(),
    deleteActivityType: vi.fn(),
    activateActivityType: vi.fn(),
    updateActivityType: vi.fn(),
}));

import AddFollowUp from "../AddFollowUp";

function renderPage() {
    return render(
        <MemoryRouter initialEntries={["/followups/add?opportunityId=9"]}>
            <Routes>
                <Route path="/followups/add" element={<AddFollowUp />} />
                <Route path="/followups" element={<div>Follow-ups list</div>} />
            </Routes>
        </MemoryRouter>
    );
}

// The form is opened from an opportunity (?opportunityId=9), so that record is
// already chosen. The fields are filled in through the API payload in real use;
// what matters here is how many requests one submit gesture sends.
async function fillForm() {
    await screen.findByText("Create Follow Up");
    await screen.findByText(/Genset deal/);
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("role", "EMPLOYEE");
    localStorage.setItem("employeeId", "2");
    window.alert = vi.fn();
});
afterEach(cleanup);

describe("creating a follow-up", () => {

    it("sends one request however many times the button is clicked, and disables it while saving", async () => {

        let finish;
        followups.createFollowUp.mockReturnValue(new Promise((resolve) => { finish = resolve; }));

        renderPage();
        await fillForm();

        const form = screen.getByText("Create Follow Up").closest("form");
        fireEvent.submit(form);
        fireEvent.submit(form);
        fireEvent.submit(form);

        expect(followups.createFollowUp).toHaveBeenCalledTimes(1);

        const button = await screen.findByRole("button", { name: /Saving/ });
        expect(button.disabled).toBe(true);

        finish({});

        expect(await screen.findByText("Follow-ups list")).toBeTruthy();
        expect(followups.createFollowUp).toHaveBeenCalledTimes(1);
    });

    it("re-enables the button after a failure so the user can retry", async () => {

        followups.createFollowUp
            .mockRejectedValueOnce({ response: { data: { message: "Server said no" } } })
            .mockResolvedValueOnce({});

        renderPage();
        await fillForm();

        fireEvent.submit(screen.getByText("Create Follow Up").closest("form"));

        await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Server said no"));

        const button = await screen.findByRole("button", { name: "Create Follow Up" });
        expect(button.disabled).toBe(false);

        fireEvent.submit(button.closest("form"));

        expect(await screen.findByText("Follow-ups list")).toBeTruthy();
        expect(followups.createFollowUp).toHaveBeenCalledTimes(2);
    });
});
