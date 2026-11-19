// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import DropdownAddManage from "../DropdownAddManage";

const OPTIONS = [{ id: 1, name: "Telecom" }, { id: 2, name: "Retail" }];

function renderDropdown(props) {
    return render(
        <DropdownAddManage
            title="Industry"
            name="industryId"
            value=""
            onChange={() => {}}
            options={OPTIONS}
            create={vi.fn()}
            getAllIncludingInactive={vi.fn().mockResolvedValue([])}
            deactivate={vi.fn()}
            activate={vi.fn()}
            onRefresh={vi.fn()}
            {...props}
        />
    );
}

describe("DropdownAddManage master-data RBAC", () => {

    afterEach(cleanup);

    it.each([
        ["EMPLOYEE", false],
        ["MANAGER", false],
    ])("%s still selects existing options but gets no Add/Manage control", (_role, isAdmin) => {
        renderDropdown({ isAdmin });

        expect(screen.getByRole("combobox")).toBeTruthy();
        expect(screen.getByText("Telecom")).toBeTruthy();
        expect(screen.getByText("Retail")).toBeTruthy();
        expect(screen.queryByRole("button", { name: /add|manage/i })).toBeNull();
    });

    it("hides the control for a non-admin even when canAdd is forced true", () => {
        renderDropdown({ isAdmin: false, canAdd: true });

        expect(screen.queryByRole("button", { name: /add|manage/i })).toBeNull();
    });

    it("ADMIN keeps the + Add control", () => {
        renderDropdown({ isAdmin: true });

        expect(screen.getByRole("button", { name: /\+ add/i })).toBeTruthy();
    });
});
