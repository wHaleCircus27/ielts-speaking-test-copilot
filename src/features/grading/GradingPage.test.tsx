import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GradingPage } from "./GradingPage";
import { defaultPublicConfig } from "../../types/config";

describe("GradingPage report tabs", () => {
  it("switches the non-glass report panel tabs", async () => {
    render(<GradingPage config={defaultPublicConfig} serviceReady={false} />);

    fireEvent.click(screen.getByTestId("report-tab-syntax"));
    expect(screen.getByTestId("report-panel-syntax")).toBeInTheDocument();
    expect(screen.getAllByText("学生病错原词句 (ORIGINAL)").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("report-tab-report"));
    expect(screen.getByTestId("report-panel-report")).toBeInTheDocument();
    expect(screen.getByText("反馈报告全文预览")).toBeInTheDocument();
  });
});
