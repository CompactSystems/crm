// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

const requestExport = vi.hoisted(() => vi.fn());

vi.mock("../api", async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, requestExport };
});

import { backupOpportunities } from "../opportunityService";

describe("backupOpportunities", () => {

    it("requests the unfiltered backup endpoint (no filters, selection or columns)", async () => {
        const blob = new Blob(["x"]);
        requestExport.mockResolvedValue({ data: blob, headers: { "x-export-row-count": "7" } });

        const result = await backupOpportunities();

        expect(requestExport).toHaveBeenCalledWith("/opportunities/backup", {}, null);
        expect(result.rowCount).toBe(7);
    });
});
