import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimeframeFilter, upcomingTimeframe, type TimeframeValue } from "./TimeframeFilter";

describe("upcomingTimeframe", () => {
  it("returns { from: start of today, to: today + 3650 days, preset: 'upcoming' }, computed at call time", () => {
    const before = new Date();
    const tf = upcomingTimeframe();
    const after = new Date();

    expect(tf.preset).toBe("upcoming");
    expect(tf.from).not.toBeNull();
    expect(tf.to).not.toBeNull();

    // `from` is start-of-day "today" at call time (not a fixed module-load value).
    expect(tf.from!.getHours()).toBe(0);
    expect(tf.from!.getMinutes()).toBe(0);
    expect(tf.from!.getSeconds()).toBe(0);
    expect(tf.from!.toDateString()).toBe(before.toDateString());
    expect(tf.from!.toDateString()).toBe(after.toDateString());

    // `to` is exactly 3650 days after `from`.
    const diffDays = Math.round((tf.to!.getTime() - tf.from!.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(3650);
  });

  it("computes a fresh value on each call rather than caching it at module load", () => {
    const a = upcomingTimeframe();
    const b = upcomingTimeframe();
    expect(a.from).not.toBe(b.from); // distinct Date instances
    expect(a.from!.getTime()).toBe(b.from!.getTime()); // same moment (same day)
  });
});

describe("TimeframeFilter", () => {
  it("shows 'Upcoming' as the trigger label when value.preset is 'upcoming'", () => {
    render(<TimeframeFilter value={upcomingTimeframe()} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Upcoming/ })).toBeInTheDocument();
  });

  it("lists Upcoming as the first preset option and emits the upcoming range on click", () => {
    const onChange = vi.fn();
    render(<TimeframeFilter value={{ from: null, to: null }} onChange={onChange} />);

    // Trigger shows "Any time" when value is {from:null,to:null,preset:undefined}.
    fireEvent.click(screen.getByRole("button", { name: "Any time" }));

    const buttons = screen.getAllByRole("button");
    // buttons[0] is the trigger itself; the first preset option must be "Upcoming".
    expect(buttons[1]).toHaveTextContent("Upcoming");

    fireEvent.click(screen.getByRole("button", { name: "Upcoming" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as TimeframeValue;
    expect(emitted.preset).toBe("upcoming");
    expect(emitted.from).not.toBeNull();
    expect(emitted.to).not.toBeNull();
    const diffDays = Math.round((emitted.to!.getTime() - emitted.from!.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(3650);
  });

  it("still supports the existing 'Past' and 'Any time' presets", () => {
    const onChange = vi.fn();
    render(<TimeframeFilter value={{ from: null, to: null }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Any time" }));

    fireEvent.click(screen.getByRole("button", { name: "Past" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ preset: "past" }),
    );
  });
});
