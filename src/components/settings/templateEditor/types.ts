/** Domain-neutral description of an editable copy/style role. */
export interface TemplateRole<RoleKey extends string, CopyKey extends string = never> {
  key: RoleKey;
  label: string;
  copyKeys?: readonly CopyKey[];
}

/** A labelled group in a template outline. */
export interface TemplateSection<RoleKey extends string, CopyKey extends string = never> {
  title: string;
  roles: readonly TemplateRole<RoleKey, CopyKey>[];
}

/** Shared shape for presentation-role overrides. Domain themes may narrow it. */
export interface GenericRoleStyle {
  family?: string;
  size?: number;
  weight?: number;
  color?: string;
  letterSpacing?: number;
  transform?: string;
}

export interface TemplateCopyField<CopyKey extends string> {
  key: CopyKey;
  label: string;
  tokens: readonly string[];
  multiline?: boolean;
}

export interface TemplateFont {
  key: string;
  label: string;
  kind?: string;
}

export interface TemplateColorField<ColorKey extends string> {
  key: ColorKey;
  label: string;
}
