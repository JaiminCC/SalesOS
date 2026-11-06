import { createPrismaClient, decodeEncryptionKey, syncConnection, syncMailbox } from '@salesos/database';

async function main(): Promise<void> {
  const [tenantId, connectionId, kind] = process.argv.slice(2);
  const userId = process.env.SALESOS_MAILBOX_USER;
  const workerUrl = process.env.DATABASE_URL_WORKER;
  const key = process.env.DATA_ENCRYPTION_KEY;
  if (!tenantId || !connectionId || !userId || !workerUrl || !key) process.exit(2);
  const prisma = createPrismaClient(workerUrl);
  const pause = kind === 'provider' ? 'after-claim' as const
    : kind === 'after-response' ? 'after-response' as const
    : kind === 'during-commit' ? 'during-commit' as const
    : kind === 'after-commit' ? 'after-commit' as const
    : kind === 'during-recovery' || kind === 'graph-recovery' ? 'during-recovery' as const
    : 'after-row' as const;
  const actor = { tenantId, userId, key: decodeEncryptionKey(key), pause };
  const fixture = fixtureFetch(kind);
  if (kind === 'capture' || kind === '') await syncMailbox(prisma, actor, connectionId);
  else await syncConnection(prisma, actor, connectionId, fixture);
  await prisma.$disconnect();
}

function fixtureFetch(kind: string): typeof fetch {
  const port = process.env.SALESOS_MAILBOX_PORT;
  return (async (input: URL | string) => {
    const url = String(input);
    if (kind === 'during-http' || kind === 'during-refresh') {
      return fetch(`http://127.0.0.1:${port}/hold`);
    }
    if (kind === 'graph-recovery') return new Response(JSON.stringify({ error: { code: 'SyncStateNotFound' } }), { status: 410 });
    if (url.includes('history')) return new Response('missing', { status: 404 });
    if (url.includes('/users/me/messages?')) return new Response(JSON.stringify({ messages: [{ id: 'page-1', threadId: 'thread-1' }] }), { status: 200 });
    if (url.includes('/profile')) return new Response(JSON.stringify({ historyId: '9', emailAddress: process.env.SALESOS_MAILBOX_ADDRESS }), { status: 200 });
    return new Response(JSON.stringify({ id: 'page-1', threadId: 'thread-1', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'buyer@example.com' }, { name: 'Message-ID', value: '<page-1@example>' }], body: { data: Buffer.from('Hello').toString('base64url') } } }), { status: 200 });
  }) as typeof fetch;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'mailbox crash failed');
  process.exit(2);
});
