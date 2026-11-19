// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// Regression: the Export button used data-bs-toggle="dropdown", which only
// works when Bootstrap's JavaScript is loaded - the app loads only its CSS,
// so clicking Export opened nothing and "Backup Opportunities" was unreachable.

const opportunityService = vi.hoisted(() => ({
    getAllOpportunities: vi.fn(),
    bulkDeleteOpportunities: vi.fn(),
    exportOpportunities: vi.fn(),
    backupOpportunities: vi.fn(),
}));
const downloadFile = vi.hoisted(() => ({
    downloadBlob: vi.fn(),
    exportCountNotice: vi.fn(() => null),
    exportErrorMessage: vi.fn(async () => "Backup failed: server said no"),
}));

vi.mock("../../services/opportunityService", () => opportunityService);
vi.mock("../../utils/downloadFile", () => downloadFile);
vi.mock("../../services/salesStageService", () => ({ getAllSalesStages: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/industryService", () => ({ getAllIndustries: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/productService", () => ({ getAllProducts: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/batteryService", () => ({ getAllBatteries: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/employeeService", () => ({ getAllEmployees: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/bulkEmailService", async (importActual) => ({
    ...(await importActual()),
    getEmailAccess: vi.fn().mockResolvedValue({ canSend: false }),
}));
vi.mock("../../services/bulkWhatsAppService", async (importActual) => ({
    ...(await importActual()),
    getWhatsAppAccessCached: vi.fn().mockResolvedValue({ canSend: false }),
}));

import Opportunities from "../Opportunities";

function renderPage() {
    return render(
        <MemoryRouter initialEntries={["/opportunities"]}>
            <Routes>
                <Route path="*" element={<Opportunities />} />
            </Routes>
        </MemoryRouter>
    );
}

async function openExportMenu() {
    // wait for the list request to settle before interacting
    await waitFor(() => expect(opportunityService.getAllOpportunities).toHaveBeenCalled());
    await screen.findByText(/Page 1 of 1/);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("role", "EMPLOYEE");
    opportunityService.getAllOpportunities.mockResolvedValue({
        content: [{ id: 1, title: "Acme Ltd", lead: { companyName: "Acme Ltd" } }],
        totalPages: 1,
        totalElements: 1,
    });
    opportunityService.backupOpportunities.mockResolvedValue(new Blob(["x"]));
    opportunityService.exportOpportunities.mockResolvedValue(new Blob(["x"]));
    window.alert = vi.fn();
});

afterEach(cleanup);

describe("Opportunities Export menu", () => {

    it("opens when Export is clicked and offers every export option, including Backup Opportunities", async () => {
        renderPage();

        // closed before the click
        expect(screen.queryByText(/Backup Opportunities/)).toBeNull();

        await openExportMenu();

        expect(await screen.findByText(/Export all matching/)).toBeTruthy();
        expect(screen.getByText(/Export selected/)).toBeTruthy();
        expect(screen.getByText(/Backup Opportunities/)).toBeTruthy();
        // the toggle reports it is open (what a user / Bootstrap CSS keys off)
        expect(screen.getByRole("button", { name: "Export" }).getAttribute("aria-expanded")).toBe("true");
    });

    it("keeps the existing 'Export all matching' action working", async () => {
        renderPage();
        await openExportMenu();

        fireEvent.click(await screen.findByText(/Export all matching/));

        await waitFor(() => expect(opportunityService.exportOpportunities).toHaveBeenCalledTimes(1));
        expect(opportunityService.backupOpportunities).not.toHaveBeenCalled();
    });

    it("Backup Opportunities downloads the backup file via the backup service only", async () => {
        renderPage();
        await openExportMenu();

        fireEvent.click(await screen.findByText(/Backup Opportunities/));

        await waitFor(() => expect(opportunityService.backupOpportunities).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(downloadFile.downloadBlob).toHaveBeenCalledWith(
            expect.any(Blob), "Backup Opportunities.xlsx"));
        expect(opportunityService.exportOpportunities).not.toHaveBeenCalled();
    });

    it("shows the server's message when the backup fails", async () => {
        opportunityService.backupOpportunities.mockRejectedValue(new Error("boom"));
        vi.spyOn(console, "error").mockImplementation(() => {});

        renderPage();
        await openExportMenu();

        fireEvent.click(await screen.findByText(/Backup Opportunities/));

        await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Backup failed: server said no"));
        expect(downloadFile.downloadBlob).not.toHaveBeenCalled();
    });

    it("shows a loading label and ignores a second click while the backup is running", async () => {
        let finish;
        opportunityService.backupOpportunities.mockReturnValue(new Promise((resolve) => { finish = resolve; }));

        renderPage();
        await openExportMenu();

        fireEvent.click(await screen.findByText(/Backup Opportunities/));

        // while running the Export toggle is disabled
        await waitFor(() => expect(screen.getByRole("button", { name: "Export" }).disabled).toBe(true));
        expect(opportunityService.backupOpportunities).toHaveBeenCalledTimes(1);

        finish(new Blob(["x"]));
        await waitFor(() => expect(downloadFile.downloadBlob).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByRole("button", { name: "Export" }).disabled).toBe(false));
    });
});
