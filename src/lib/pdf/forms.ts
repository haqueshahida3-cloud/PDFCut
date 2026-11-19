// AcroForm tools: inspect fields, create text and checkbox fields, fill values, and flatten.
import {
  PDFButton,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  type PDFDocument,
  type PDFField,
} from 'pdf-lib';
import { loadPdf, type Ctx } from './ops';

export interface FormFieldInfo {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'button' | 'signature' | 'other';
  page: number; // 0-based, or -1 when the widget has no page reference
  value: string;
}

export interface NewField {
  type: 'text' | 'checkbox';
  name: string;
  page: number; // 0-based
  x: number; // normalized, top-left origin
  y: number;
  w: number;
  h: number;
}

function kindOf(f: PDFField): FormFieldInfo['type'] {
  if (f instanceof PDFTextField) return 'text';
  if (f instanceof PDFCheckBox) return 'checkbox';
  if (f instanceof PDFDropdown) return 'dropdown';
  if (f instanceof PDFRadioGroup) return 'radio';
  if (f instanceof PDFButton) return 'button';
  if (f instanceof PDFSignature) return 'signature';
  return 'other';
}

function valueOf(f: PDFField): string {
  try {
    if (f instanceof PDFTextField) return f.getText() ?? '';
    if (f instanceof PDFCheckBox) return f.isChecked() ? 'on' : 'off';
    if (f instanceof PDFDropdown) return f.getSelected().join(', ');
  } catch {
    // A malformed value should not stop the listing.
  }
  return '';
}

function pageIndexOf(doc: PDFDocument, field: PDFField): number {
  const ref = field.acroField.getWidgets()[0]?.P();
  if (!ref) return -1;
  return doc.getPages().findIndex((p) => p.ref.toString() === ref.toString());
}

export async function inspectForms(bytes: Uint8Array): Promise<FormFieldInfo[]> {
  const doc = await loadPdf(bytes);
  return doc
    .getForm()
    .getFields()
    .map((f) => ({ name: f.getName(), type: kindOf(f), page: pageIndexOf(doc, f), value: valueOf(f) }));
}

export async function createFields(bytes: Uint8Array, fields: NewField[], ctx: Ctx): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const form = doc.getForm();
  const pages = doc.getPages();
  const taken = new Set(form.getFields().map((f) => f.getName()));
  for (const nf of fields) {
    if (!nf.name.trim()) throw new Error('Every form field needs a name.');
    if (taken.has(nf.name)) throw new Error(`A field named "${nf.name}" already exists.`);
    const page = pages[nf.page];
    if (!page) throw new Error(`Page ${nf.page + 1} does not exist.`);
    const { width, height } = page.getSize();
    const rect = {
      x: nf.x * width,
      y: (1 - nf.y - nf.h) * height,
      width: nf.w * width,
      height: nf.h * height,
    };
    if (nf.type === 'text') {
      form.createTextField(nf.name).addToPage(page, rect);
    } else {
      form.createCheckBox(nf.name).addToPage(page, rect);
    }
    taken.add(nf.name);
  }
  ctx.report(1);
  return doc.save();
}

export async function fillFields(bytes: Uint8Array, values: Record<string, string | boolean>, ctx: Ctx): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field) throw new Error(`No form field named "${name}".`);
    if (field instanceof PDFTextField) {
      field.setText(String(value));
    } else if (field instanceof PDFCheckBox) {
      if (value) field.check();
      else field.uncheck();
    } else if (field instanceof PDFDropdown) {
      field.select(String(value));
    } else {
      throw new Error(`Field "${name}" cannot be filled by this tool.`);
    }
  }
  ctx.report(1);
  return doc.save();
}

/** Draws every field into the page content and removes the interactive form. */
export async function flattenForms(bytes: Uint8Array, ctx: Ctx): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  doc.getForm().flatten();
  ctx.report(1);
  return doc.save();
}
