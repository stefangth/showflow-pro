import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        display: ["Geist", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
          active: "hsl(var(--primary-active))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          /* Accent stops are plain hex vars (not hsl channels): Tailwind /opacity
             modifiers (e.g. bg-accent-500/20) silently produce NO opacity here.
             Use a solid stop, or bg-[rgba(...)] / a dedicated token, for alpha. */
          50:  "var(--accent-50)",
          100: "var(--accent-100)",
          200: "var(--accent-200)",
          300: "var(--accent-300)",
          400: "var(--accent-400)",
          500: "var(--accent-500)",
          600: "var(--accent-600)",
          700: "var(--accent-700)",
          800: "var(--accent-800)",
          900: "var(--accent-900)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        /* shadcn compat (--radius = 0.625rem = 10px) */
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        /* design-system scale — collision-free keys only.
           Deliberately NOT `xl`/`2xl`: those are Tailwind built-ins (12px/16px)
           and overriding them silently resizes existing `rounded-xl`/`rounded-2xl`
           consumers (sidebar inset, chat bubbles, login card). The 14px step
           (`--radius-xl`, hero cards/sheets) stays a CSS var — sheets come from
           shadcn with their own radius, so no utility is needed for it. */
        xs:   "var(--radius-xs)",   /* 4px  — tags, badges, chips */
        s:    "var(--radius-s)",    /* 6px  — inputs */
        m:    "var(--radius-m)",    /* 8px  — buttons */
        l:    "var(--radius-l)",    /* 10px — cards */
        xxl:  "var(--radius-xxl)",  /* 20px — app icons */
        pill: "var(--radius-pill)", /* 999px */
      },
      boxShadow: {
        elev0:     "var(--shadow-0)",
        elev1:     "var(--shadow-1)",
        elev2:     "var(--shadow-2)",
        elev3:     "var(--shadow-3)",
        elev4:     "var(--shadow-4)",
        "elev-inset": "var(--shadow-inset)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        /* consume the motion tokens rather than hardcoding duration/easing */
        "accordion-down": "accordion-down var(--dur-base) var(--ease-out)",
        "accordion-up": "accordion-up var(--dur-base) var(--ease-out)",
      },
    },
  },
  plugins: [animate, typography],
} satisfies Config;
