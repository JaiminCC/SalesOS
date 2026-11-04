import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { assertKnowledgeBytes, chunkSections, deterministicEmbedding, extractDocument, KnowledgeFileError } from './knowledge';
import { knowledgeObjectKey, resolveObjectPath } from './object-storage';
import { agentPricing, canTransitionVersion, emptySnapshot, mergeProductContext } from './product';

describe('knowledge files', () => {
  it('rejects the wrong type, signature, and size', () => {
    expect(() => assertKnowledgeBytes('../secret.txt', Buffer.from('hello'), 100)).toThrow(KnowledgeFileError);
    expect(() => assertKnowledgeBytes('notes.exe', Buffer.from('hello'), 100)).toThrow(/not allowed/);
    expect(() => assertKnowledgeBytes('notes.pdf', Buffer.from('hello'), 100)).toThrow(/signature/);
    expect(() => assertKnowledgeBytes('notes.txt', Buffer.from('a'.repeat(20)), 10)).toThrow(/size/);
    expect(() => assertKnowledgeBytes('notes.txt', Buffer.from('ok\u0000'), 100)).toThrow(/binary/);
  });

  it('strips scripts and keeps readable HTML', () => {
    const extracted = extractDocument('page.html', Buffer.from('<script>alert(1)</script><h1>Visible claim</h1>'), 1000);
    expect(extracted.sections[0]?.text).toContain('Visible claim');
    expect(extracted.sections[0]?.text).not.toContain('alert');
  });

  it('extracts a PDF string and a safe DOCX entry', () => {
    const pdf = extractDocument('guide.pdf', Buffer.from('%PDF-1.4\n(Approved capability) Tj\n'), 1000);
    expect(pdf.sections[0]?.text).toContain('Approved capability');
    expect(pdf.sections[0]?.page).toBe(1);
    const xml = Buffer.from('<w:document><w:t>Installation note</w:t></w:document>');
    const docx = extractDocument('guide.docx', storedZip('word/document.xml', xml), 10_000);
    expect(docx.sections[0]?.text).toContain('Installation note');
  });

  it('rejects archive traversal, macros, and decompression bombs', () => {
    expect(() => extractDocument('bad.docx', storedZip('../secret.xml', Buffer.from('<w:t>x</w:t>')), 10_000)).toThrow(/not allowed/);
    expect(() => extractDocument('macro.docx', storedZip('word/vbaProject.bin', Buffer.from('x')), 10_000)).toThrow(/Macros/);
    expect(() => extractDocument('bomb.docx', declaredBomb(), 10_000)).toThrow(/size/);
  });

  it('chunks markdown under the section heading', () => {
    const extracted = extractDocument('notes.md', Buffer.from('# Setup\n\nApproved installation steps for the field kit.\n'), 1000);
    const chunks = chunkSections(extracted.sections);
    expect(chunks[0]?.section).toBe('Setup');
    expect(chunks[0]?.content).toContain('field kit');
    expect(deterministicEmbedding(chunks[0]?.content ?? '')).toHaveLength(384);
  });
});

describe('object keys', () => {
  it('rejects traversal and absolute paths', () => {
    const key = knowledgeObjectKey('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
    expect(resolveObjectPath('/tmp/salesos-objects', key)).toContain('/tenant/');
    expect(() => resolveObjectPath('/tmp/salesos-objects', '../etc/passwd')).toThrow(/invalid object key/);
    expect(() => knowledgeObjectKey('../etc', '22222222-2222-4222-8222-222222222222')).toThrow(/invalid object key/);
  });
});

describe('product context', () => {
  it('lets a non-empty product field replace the organization default', () => {
    const snapshot = emptySnapshot('USD');
    snapshot.positioning.tone = 'direct';
    const merged = mergeProductContext(snapshot, { positioning: { tone: 'formal', brandVoice: 'calm' }, pricing: { model: 'FIXED', summary: '100' } });
    expect(merged.positioning.tone).toBe('direct');
    expect(merged.positioning.brandVoice).toBe('calm');
    expect(merged.pricing.model).toBe('FIXED');
    snapshot.pricing = { model: 'USAGE', visible: false, currency: 'USD', summary: 'metered', tiers: [] };
    expect(mergeProductContext(snapshot, { pricing: { model: 'FIXED' } }).pricing.model).toBe('USAGE');
    expect(agentPricing({ ...merged.pricing, visible: false }).summary).toBe('');
  });

  it('refuses to publish from a draft or an editor-only transition', () => {
    expect(canTransitionVersion('DRAFT', 'PUBLISHED')).toBe(false);
    expect(canTransitionVersion('APPROVED', 'PUBLISHED')).toBe(true);
    expect(canTransitionVersion('PUBLISHED', 'SUPERSEDED')).toBe(true);
    expect(canTransitionVersion('PUBLISHED', 'DRAFT')).toBe(false);
  });
});

function storedZip(name: string, data: Buffer): Buffer {
  const nameBytes = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  return Buffer.concat([header, nameBytes, data]);
}

function declaredBomb(): Buffer {
  const nameBytes = Buffer.from('word/document.xml');
  const payload = deflateRawSync(Buffer.from('<w:t>x</w:t>'));
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(payload.length, 18);
  header.writeUInt32LE(5_000_000, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  return Buffer.concat([header, nameBytes, payload]);
}
