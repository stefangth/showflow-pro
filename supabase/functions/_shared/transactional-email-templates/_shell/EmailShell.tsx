/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import {
  Body,
  Button,
  Container,
  Font,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "npm:@react-email/components@0.0.22";
import type { EmailFamily, EmailRoleKey, EmailTheme } from "./emailTheme.ts";
import { EMAIL_FAMILY_ACCENTS } from "./emailTheme.ts";

export interface EmailShellCta {
  href: string;
  label: string;
}

export interface EmailShellProps {
  family: EmailFamily;
  theme: EmailTheme;
  previewText: string;
  heading: string;
  subheading?: string;
  children?: React.ReactNode;
  footer?: string;
  cta?: EmailShellCta;
  /** Preview-only outline used by the template editor. */
  highlightRole?: EmailRoleKey;
}

function roleStyle(theme: EmailTheme, role: EmailRoleKey, highlightRole?: EmailRoleKey): React.CSSProperties {
  const source = theme.roles[role];
  const colors = theme.base.colors;
  return {
    color: colors[source.color ?? "bodyText"],
    fontFamily: source.family === "heading" ? theme.base.headingFamily : theme.base.bodyFamily,
    fontSize: `${source.size ?? 14}px`,
    fontWeight: source.weight,
    letterSpacing: source.letterSpacing === undefined ? undefined : `${source.letterSpacing}px`,
    textTransform: source.transform,
    outline: highlightRole === role ? `2px solid ${colors.accent}` : undefined,
    outlineOffset: highlightRole === role ? "2px" : undefined,
  };
}

export function EmailShell({
  family,
  theme,
  previewText,
  heading,
  subheading,
  children,
  footer,
  cta,
  highlightRole,
}: EmailShellProps) {
  const colors = theme.base.colors;
  const accent = EMAIL_FAMILY_ACCENTS[family];
  const heroFallbackAttributes = { bgcolor: accent.solid } as React.TdHTMLAttributes<HTMLTableDataCellElement> & { bgcolor: string };

  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <Font
          fontFamily="Geist"
          fallbackFontFamily="Arial"
          webFont={{
            url: "https://cdn.jsdelivr.net/fontsource/fonts/geist@latest/latin-400-normal.woff2",
            format: "woff2",
          }}
          fontWeight={400}
          fontStyle="normal"
        />
      </Head>
      <Preview>{previewText}</Preview>
      <Body style={{ margin: "0", backgroundColor: colors.pageBg, fontFamily: theme.base.bodyFamily }}>
        <Container style={{ width: "600px", maxWidth: "100%", margin: "0 auto", backgroundColor: colors.cardBg }}>
          <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style={{ borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td
                  {...heroFallbackAttributes}
                  style={{
                    backgroundColor: accent.solid,
                    backgroundImage: `linear-gradient(135deg, ${accent.from} 0%, ${accent.to} 100%)`,
                    padding: "28px 32px",
                  }}
                >
                  <Text style={{ ...roleStyle(theme, "header", highlightRole), margin: "0 0 12px" }}>ShowFlow</Text>
                  <Heading style={{ ...roleStyle(theme, "heading", highlightRole), margin: "0" }}>{heading}</Heading>
                  {subheading && (
                    <Text style={{ ...roleStyle(theme, "subheading", highlightRole), margin: "10px 0 0", lineHeight: "1.5" }}>
                      {subheading}
                    </Text>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style={{ borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={{ padding: "28px 32px" }}>{children}</td>
              </tr>
            </tbody>
          </table>

          {cta && (
            <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style={{ borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={{ padding: "0 32px 28px", textAlign: "center" }}>
                    <Button
                      href={cta.href}
                      style={{
                        ...roleStyle(theme, "button", highlightRole),
                        backgroundColor: colors.buttonBg,
                        borderRadius: `${theme.base.buttonRadius}px`,
                        padding: "12px 24px",
                        textDecoration: "none",
                      }}
                    >
                      {cta.label}
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          )}

          {footer && (
            <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style={{ borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={{ borderTop: `1px solid ${colors.line}`, padding: "20px 32px 28px" }}>
                    <Text style={{ ...roleStyle(theme, "footer", highlightRole), margin: "0", lineHeight: "1.5" }}>{footer}</Text>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </Container>
      </Body>
    </Html>
  );
}

export function emailRoleStyle(theme: EmailTheme, role: EmailRoleKey, highlightRole?: EmailRoleKey): React.CSSProperties {
  return roleStyle(theme, role, highlightRole);
}
