import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const EMBEDDING_DIMENSIONS = 384;
export const EMBEDDING_TEST_MODEL = 'salesos-test-384';

export class KnowledgeFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeFileError';
  }
}

const extensions: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
};

export function assertKnowledgeBytes(fileName: string, bytes: Buffer, maxBytes: number): { extension: string; contentType: string } {
  if (bytes.length === 0) throw new KnowledgeFileError('File is empty');
  if (bytes.length > maxBytes) throw new KnowledgeFileError('File exceeds the size limit');
  const base = fileName.split(/[/\\]/).pop() ?? '';
  if (!base || base !== fileName.trim() || base.includes('..') || base.includes('\0')) {
    throw new KnowledgeFileError('File name is not allowed');
  }
  const extension = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '';
  const contentType = extensions[extension];
  if (!contentType) throw new KnowledgeFileError('File type is not allowed');
  if (extension === 'pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new KnowledgeFileError('File signature does not match PDF');
  }
  if (extension === 'docx' && !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw new KnowledgeFileError('File signature does not match DOCX');
  }
  if (extension !== 'pdf' && extension !== 'docx') {
    if (bytes.includes(0)) throw new KnowledgeFileError('Text file contains binary content');
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new KnowledgeFileError('Text file is not valid UTF-8');
    }
  }
  return { extension, contentType };
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .split('\u0000').join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim()
    .slice(0, 1_000_000);
}

export type ExtractedSection = { page: number | null; section: string | null; text: string };
export type ChunkDraft = { index: number; content: string; page: number | null; section: string | null };

export function extractDocument(fileName: string, bytes: Buffer, maxBytes: number): { sections: ExtractedSection[]; pageCount: number } {
  const { extension } = assertKnowledgeBytes(fileName, bytes, maxBytes);
  if (extension === 'pdf') return pdfSections(bytes);
  if (extension === 'docx') return { sections: [{ page: null, section: null, text: docxText(bytes) }], pageCount: 1 };
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (extension === 'html' || extension === 'htm') {
    return { sections: [{ page: null, section: null, text: htmlToText(text) }], pageCount: 1 };
  }
  if (extension === 'md' || extension === 'markdown') return markdownSections(text);
  return { sections: [{ page: null, section: null, text: normalizeText(text) }], pageCount: 1 };
}

export function chunkSections(sections: ExtractedSection[]): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  for (const section of sections) {
    const text = normalizeText(section.text);
    if (!text) continue;
    let start = 0;
    while (start < text.length && chunks.length < 500) {
      const end = Math.min(text.length, start + 800);
      const content = text.slice(start, end).trim();
      if (content) {
        chunks.push({ index: chunks.length, content, page: section.page, section: section.section });
      }
      if (end === text.length) break;
      start = end - 80;
    }
  }
  if (!chunks.length) throw new KnowledgeFileError('No text could be extracted');
  return chunks;
}

export function deterministicEmbedding(text: string): number[] {
  const out = new Array<number>(EMBEDDING_DIMENSIONS);
  let seed = createHash('sha256').update(text).digest();
  let offset = 0;
  for (let index = 0; index < EMBEDDING_DIMENSIONS; index += 1) {
    if (offset + 4 > seed.length) {
      seed = createHash('sha256').update(seed).digest();
      offset = 0;
    }
    out[index] = (seed.readUInt32BE(offset) / 0xffffffff) * 2 - 1;
    offset += 4;
  }
  const norm = Math.sqrt(out.reduce((sum, value) => sum + value * value, 0)) || 1;
  return out.map((value) => value / norm);
}

export type EmbeddingVector = { model: string; dimensions: number; vector: number[] };

export type EmbeddingProvider =
  | { kind: 'disabled' }
  | { kind: 'test' }
  | { kind: 'http'; url: string; model: string };

export function embeddingProviderFromEnv(env: NodeJS.ProcessEnv): EmbeddingProvider {
  const kind = env.SALESOS_EMBEDDING_PROVIDER ?? 'disabled';
  if (kind === 'disabled') return { kind: 'disabled' };
  if (kind === 'test') return { kind: 'test' };
  if (kind === 'http') {
    if (env.NODE_ENV === 'test' || env.CI === 'true') {
      throw new Error('Hosted embedding APIs are disabled when NODE_ENV=test or CI=true');
    }
    const url = env.SALESOS_EMBEDDING_URL ?? '';
    if (!url.startsWith('https://') && !url.startsWith('http://')) throw new Error('SALESOS_EMBEDDING_URL is required');
    return { kind: 'http', url, model: env.SALESOS_EMBEDDING_MODEL || 'configured-embedding' };
  }
  throw new Error('SALESOS_EMBEDDING_PROVIDER must be disabled, test, or http');
}

export async function embedText(provider: EmbeddingProvider, text: string): Promise<EmbeddingVector | null> {
  if (provider.kind === 'disabled') return null;
  if (provider.kind === 'test') {
    return { model: EMBEDDING_TEST_MODEL, dimensions: EMBEDDING_DIMENSIONS, vector: deterministicEmbedding(text) };
  }
  const response = await fetch(provider.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ input: text, model: provider.model }),
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new KnowledgeFileError('Embedding provider rejected the chunk');
  const body = (await response.json()) as { embedding?: unknown };
  if (!Array.isArray(body.embedding) || body.embedding.length !== EMBEDDING_DIMENSIONS || body.embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new KnowledgeFileError('Embedding dimensions are incompatible with the index');
  }
  return { model: provider.model, dimensions: EMBEDDING_DIMENSIONS, vector: body.embedding };
}

function pdfSections(bytes: Buffer): { sections: ExtractedSection[]; pageCount: number } {
  const raw = bytes.toString('latin1');
  const pages = Math.max(1, raw.match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0);
  const parts: string[] = [];
  const pattern = /\((?:\\[()\\]|[^\\)]){0,400}\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) && parts.join(' ').length < 1_000_000) {
    parts.push(match[0].slice(1, -1).replace(/\\([()\\])/g, '$1').replace(/\\n/g, '\n'));
  }
  const text = normalizeText(parts.join(' '));
  if (!text) throw new KnowledgeFileError('No text could be extracted');
  return { sections: [{ page: 1, section: null, text }], pageCount: pages };
}

function htmlToText(source: string): string {
  const withoutScripts = source.replace(/<script\b[^>]*>[\s\S]*?(?:<\/script>|$)/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?(?:<\/style>|$)/gi, ' ');
  const text = withoutScripts
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return normalizeText(text);
}

function markdownSections(source: string): { sections: ExtractedSection[]; pageCount: number } {
  const lines = source.split(/\r?\n/);
  const sections: ExtractedSection[] = [];
  let section: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    const text = normalizeText(buffer.join('\n'));
    if (text) sections.push({ page: null, section, text });
    buffer = [];
  };
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      section = heading[2]?.trim().slice(0, 200) ?? null;
    } else {
      buffer.push(line);
    }
  }
  flush();
  return { sections: sections.length ? sections : [{ page: null, section: null, text: normalizeText(source) }], pageCount: 1 };
}

function docxText(bytes: Buffer): string {
  const xml = readZipEntry(bytes, 'word/document.xml');
  const parts: string[] = [];
  const pattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) && parts.join(' ').length < 1_000_000) {
    parts.push(
      (match[1] ?? '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"'),
    );
  }
  const text = normalizeText(parts.join(' '));
  if (!text) throw new KnowledgeFileError('No text could be extracted');
  return text;
}

function readZipEntry(bytes: Buffer, wanted: string): string {
  let offset = 0;
  let entries = 0;
  let total = 0;
  let found: Buffer | null = null;
  while (offset + 30 <= bytes.length && entries < 30) {
    if (bytes.readUInt32LE(offset) !== 0x04034b50) break;
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const uncompressedSize = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const dataStart = nameStart + nameLength + extraLength;
    if ((flags & 0x1) !== 0) throw new KnowledgeFileError('Encrypted archives are not allowed');
    if ((flags & 0x8) !== 0 || compressedSize === 0) throw new KnowledgeFileError('Archive entry sizes must be declared');
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) throw new KnowledgeFileError('Archive entry path is not allowed');
    if (name.toLowerCase().includes('vbaproject') || name.toLowerCase().endsWith('.bin')) {
      throw new KnowledgeFileError('Macros are not allowed');
    }
    if (uncompressedSize > 4_000_000 || compressedSize > 4_000_000 || uncompressedSize > compressedSize * 100) {
      throw new KnowledgeFileError('Archive entry exceeds the safe size limit');
    }
    total += uncompressedSize;
    if (total > 8_000_000) throw new KnowledgeFileError('Archive exceeds the safe size limit');
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    if (compressed.length !== compressedSize) throw new KnowledgeFileError('Archive entry is truncated');
    if (name === wanted) {
      found = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: uncompressedSize });
      if (found.length > uncompressedSize) throw new KnowledgeFileError('Archive entry exceeds the safe size limit');
    } else if (method !== 0 && method !== 8) {
      throw new KnowledgeFileError('Archive compression method is not allowed');
    }
    entries += 1;
    offset = dataStart + compressedSize;
  }
  if (!found) throw new KnowledgeFileError('DOCX document body is missing');
  return found.toString('utf8');
}
