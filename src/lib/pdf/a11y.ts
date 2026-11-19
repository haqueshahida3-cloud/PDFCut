// Accessibility checks. structureFacts() reads the catalog (worker-safe); evaluateAccessibility() is pure.
// These are automated checks only: passing them does not mean a document meets WCAG or PDF/UA.
import { PDFName } from 'pdf-lib';
import { loadPdf } from './ops';

export interface StructureFacts {
  title: string;
  language: string;
  tagged: boolean;
  pageCount: number;
}

export async function structureFacts(bytes: Uint8Array): Promise<StructureFacts> {
  const doc = await loadPdf(bytes);
  const lang = doc.catalog.lookup(PDFName.of('Lang'));
  let language = '';
  if (lang && typeof (lang as { decodeText?: unknown }).decodeText === 'function') {
    language = (lang as unknown as { decodeText(): string }).decodeText();
  } else if (lang) {
    language = String(lang);
  }
  return {
    title: doc.getTitle() ?? '',
    language: language.trim(),
    tagged: doc.catalog.has(PDFName.of('StructTreeRoot')),
    pageCount: doc.getPageCount(),
  };
}

export interface A11yInput extends StructureFacts {
  bookmarks: number;
  sampledPages: number;
  sampledWithText: number;
}

export interface A11yCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export function evaluateAccessibility(f: A11yInput): A11yCheck[] {
  const checks: A11yCheck[] = [];
  const hasTitle = f.title.trim().length > 0;
  checks.push({
    id: 'title',
    label: 'Document title',
    status: hasTitle ? 'pass' : 'fail',
    detail: hasTitle ? f.title : 'Screen readers announce the title. Set it in Security → Metadata.',
  });
  checks.push({
    id: 'language',
    label: 'Document language',
    status: f.language ? 'pass' : 'fail',
    detail: f.language ? `Language: ${f.language}` : 'Set /Lang so screen readers use the right voice.',
  });
  checks.push({
    id: 'tagged',
    label: 'Tagged structure',
    status: f.tagged ? 'pass' : 'fail',
    detail: f.tagged
      ? 'A structure tree is present.'
      : 'No structure tree, so reading order and alternative text cannot be verified.',
  });
  const needsBookmarks = f.pageCount > 10;
  checks.push({
    id: 'bookmarks',
    label: 'Navigation bookmarks',
    status: f.bookmarks > 0 ? 'pass' : needsBookmarks ? 'warn' : 'pass',
    detail:
      f.bookmarks > 0
        ? `${f.bookmarks} bookmark(s).`
        : needsBookmarks
          ? 'Long documents should have bookmarks for navigation.'
          : 'Not required for short documents.',
  });
  const ratio = f.sampledPages > 0 ? f.sampledWithText / f.sampledPages : 0;
  checks.push({
    id: 'text',
    label: 'Selectable text',
    status: f.sampledPages === 0 ? 'warn' : ratio >= 0.8 ? 'pass' : ratio > 0 ? 'warn' : 'fail',
    detail:
      f.sampledPages === 0
        ? 'No pages could be sampled.'
        : `${f.sampledWithText} of ${f.sampledPages} sampled pages have text. Scanned pages need OCR.`,
  });
  return checks;
}
