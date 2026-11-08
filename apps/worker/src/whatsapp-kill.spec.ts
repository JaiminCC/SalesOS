import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { acceptWhatsAppWebhook, addPhone, createConnection, createPrismaClient, processWhatsAppIngress } from '@salesos/database';
import { whatsAppSignature } from '@salesos/shared';
import { afterAll, describe, expect, it } from 'vitest';

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP;
const workerUrl = process.env.DATABASE_URL_WORKER;
const secret = 'local-whatsapp-kill-secret';

describe.skipIf(!adminUrl || !appUrl || !workerUrl)('whatsapp worker kill recovery', () => {
  const admin = createPrismaClient(adminUrl as string);
  const app = createPrismaClient(appUrl as string);
  const worker = createPrismaClient(workerUrl as string);
  const stamp = randomUUID().slice(0, 8);
  const phone = `300000${stamp.replace(/\D/g, '').padEnd(8, '3').slice(0, 8)}`;
  let tenantId = '';
  let userId = '';
  let body = '';
  let ingressId = '';

  afterAll(async () => {
    if (tenantId) await admin.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    if (userId) await admin.user.delete({ where: { id: userId } }).catch(() => undefined);
    await admin.whatsappIngress.deleteMany({ where: { providerPhoneId: phone } }).catch(() => undefined);
    await admin.$disconnect();
    await app.$disconnect();
    await worker.$disconnect();
  });

  it('rolls back a killed message write and recovers once', async () => {
    const tenant = await admin.tenant.create({ data: { name: `Kill WA ${stamp}`, slug: `kill-wa-${stamp}` } });
    tenantId = tenant.id;
    const user = await admin.user.create({ data: { emailHmac: `kill-wa-${stamp}`, emailCiphertext: Buffer.from('k'), displayName: 'Owner', status: 'ACTIVE' } });
    userId = user.id;
    await admin.membership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    const role = await admin.role.create({ data: { tenantId, name: 'OWNER', isSystem: true } });
    await admin.rolePermission.create({ data: { tenantId, roleId: role.id, permission: 'whatsapp.conversations.manage' } });
    await admin.membershipRole.create({ data: { tenantId, userId, roleId: role.id } });
    const actor = { tenantId, userId };
    const connection = await createConnection(app, actor, { displayName: 'Kill', wabaId: '123456789012399' });
    await addPhone(app, actor, { connectionId: connection.id, providerPhoneId: phone, displayNumber: '+15550003333' });
    body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: phone }, messages: [{ from: '15551239999', id: `wamid.KILL.${stamp}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Hello' } }] } }] }] });
    await killChild('before-receipt');
    expect(await admin.whatsappIngress.count({ where: { providerPhoneId: phone } })).toBe(0);
    const raw = Buffer.from(body);
    const accepted = await acceptWhatsAppWebhook(worker, { secret, raw, signature: whatsAppSignature(secret, raw), origin: 'STUB_TESTED' });
    ingressId = accepted.ingressIds[0] ?? '';
    await killChild('during-message');
    expect(await admin.whatsappMessage.count({ where: { tenantId } })).toBe(0);
    const recovered = await processWhatsAppIngress(worker, { ingressId, userId });
    expect(recovered.sendAttempts).toBe(0);
    expect(await admin.whatsappMessage.count({ where: { tenantId } })).toBe(1);
    const drafts = await admin.whatsappDraft.count({ where: { tenantId } });
    expect(drafts).toBe(1);
    await processWhatsAppIngress(worker, { ingressId, userId });
    expect(await admin.whatsappMessage.count({ where: { tenantId } })).toBe(1);
    expect(await admin.whatsappDraft.count({ where: { tenantId } })).toBe(drafts);
    await admin.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    const second = Buffer.from(body.replace('wamid.KILL', 'wamid.SUSPEND'));
    const suspendedIngress = await acceptWhatsAppWebhook(worker, { secret, raw: second, signature: whatsAppSignature(secret, second), origin: 'STUB_TESTED' });
    const suspended = await processWhatsAppIngress(worker, { ingressId: suspendedIngress.ingressIds[0] ?? '', userId });
    expect(suspended.stopped).toBe('TENANT_SUSPENDED');
    expect(await admin.whatsappMessage.count({ where: { tenantId, direction: 'OUTBOUND' } })).toBe(0);
  });

  function killChild(pause: string): Promise<void> {
    return new Promise((done, fail) => {
      const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', resolve(process.cwd(), 'src/whatsapp-crash.ts'), pause], {
        cwd: process.cwd(),
        env: { ...process.env, SALESOS_WHATSAPP_SECRET: secret, SALESOS_WHATSAPP_BODY: body, SALESOS_WHATSAPP_INGRESS: ingressId, SALESOS_WHATSAPP_USER: userId },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      let seen = false;
      const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error(output || 'checkpoint timed out')); }, 20000);
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (!output.includes('checkpoint') || seen) return;
        seen = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
      });
      child.on('close', () => { if (seen) done(); else fail(new Error(output || 'exited before checkpoint')); });
      child.on('error', fail);
    });
  }
});
