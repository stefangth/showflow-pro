import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openPdfBase64 } from "./openPdf";

describe("openPdfBase64", () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(window, "open").mockImplementation(() => null);
  });
  afterEach(() => {
    vi.useRealTimers();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.restoreAllMocks();
  });

  it("decodes base64 to a pdf blob and opens it in a new tab", () => {
    openPdfBase64("JVBERi0="); // base64 of "%PDF-"
    const create = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
    expect(create).toHaveBeenCalledTimes(1);
    const blob = create.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/pdf");
    expect(window.open).toHaveBeenCalledWith("blob:mock", "_blank", "noopener,noreferrer");
  });

  it("revokes the object url after the timeout (no leak)", () => {
    openPdfBase64("JVBERi0=");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });
});
