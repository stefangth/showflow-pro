import type { HireOrderCountersign } from "./CountersignCard";
import type { Letterhead } from "./LetterheadCard";
import type { HireOrderNumbering } from "./NumberingCard";
import type { HireOrderDefaults } from "./OrderDefaultsCard";

export const COUNTERSIGN_DEFAULT: HireOrderCountersign = { mode: "manual" };

export const LETTERHEAD_DEFAULT: Letterhead = {
  legal_name: "",
  address_lines: [],
  registration_line: "",
  agent_name: "",
  agent_email: "",
};

export const NUMBERING_DEFAULT: HireOrderNumbering = { prefix: "HO", pattern: "{prefix}-{yyyy}-{mmdd}-{seq}" };

export const ORDER_DEFAULTS_DEFAULT: HireOrderDefaults = { default_fee: null, currency: "EUR" };
