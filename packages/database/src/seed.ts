import { SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES } from '@salesos/shared';
import { createPrismaClient } from './client';
import { decodeEncryptionKey, emailHmac, encryptField } from './crypto';
import './load-env';

const TENANTS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'northstar-demo',
    name: 'Northstar Demo',
    timezone: 'America/New_York',
    locale: 'en-US',
    currency: 'USD',
    ownerEmail: 'owner@northstar.example',
    ownerName: 'Northstar Owner',
    userId: '33333333-3333-4333-8333-333333333333',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'sample-agency',
    name: 'Sample Agency',
    timezone: 'Europe/Berlin',
    locale: 'de-DE',
    currency: 'EUR',
    ownerEmail: 'owner@sample-agency.example',
    ownerName: 'Agency Owner',
    userId: '44444444-4444-4444-8444-444444444444',
  },
] as const;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const keyMaterial = process.env.DATA_ENCRYPTION_KEY;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for seed');
  if (!keyMaterial) throw new Error('DATA_ENCRYPTION_KEY is required for seed');
  const key = decodeEncryptionKey(keyMaterial);
  const prisma = createPrismaClient(databaseUrl);
  try {
    for (const tenant of TENANTS) {
      await prisma.tenant.upsert({
        where: { slug: tenant.slug },
        update: {
          name: tenant.name,
          timezone: tenant.timezone,
          locale: tenant.locale,
          currency: tenant.currency,
          status: 'ACTIVE',
        },
        create: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          timezone: tenant.timezone,
          locale: tenant.locale,
          currency: tenant.currency,
          status: 'ACTIVE',
          settings: { permittedChannels: ['EMAIL'] },
        },
      });
      await prisma.user.upsert({
        where: { emailHmac: emailHmac(tenant.ownerEmail, key) },
        update: { displayName: tenant.ownerName, status: 'ACTIVE' },
        create: {
          id: tenant.userId,
          emailHmac: emailHmac(tenant.ownerEmail, key),
          emailCiphertext: new Uint8Array(encryptField(tenant.ownerEmail, key)),
          displayName: tenant.ownerName,
          status: 'ACTIVE',
        },
      });
      await prisma.membership.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: tenant.userId } },
        update: { status: 'ACTIVE' },
        create: { tenantId: tenant.id, userId: tenant.userId, status: 'ACTIVE' },
      });
      for (const roleName of SYSTEM_ROLES) {
        const role = await prisma.role.upsert({
          where: { tenantId_name: { tenantId: tenant.id, name: roleName } },
          update: { isSystem: true },
          create: { tenantId: tenant.id, name: roleName, isSystem: true },
        });
        await prisma.rolePermission.deleteMany({
          where: { tenantId: tenant.id, roleId: role.id },
        });
        await prisma.rolePermission.createMany({
          data: SYSTEM_ROLE_PERMISSIONS[roleName].map((permission) => ({
            tenantId: tenant.id,
            roleId: role.id,
            permission,
          })),
        });
        if (roleName === 'Owner') {
          await prisma.membershipRole.upsert({
            where: {
              tenantId_userId_roleId: {
                tenantId: tenant.id,
                userId: tenant.userId,
                roleId: role.id,
              },
            },
            update: {},
            create: { tenantId: tenant.id, userId: tenant.userId, roleId: role.id },
          });
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  process.stdout.write('seed complete\n');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'seed failed';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
