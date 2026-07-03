import { getCapabilityCatalog, syncBuiltinCapabilities } from '../capabilities/capabilities.service';
import { prisma } from '../../infrastructure/prisma/prisma.service';
import type { CapabilityPayload } from './settings.types';

export async function listCapabilities() {
  const catalog = await getCapabilityCatalog();
  return {
    tools: catalog.tools.map((item) => ({
      id: item.id,
      key: item.key,
      name: item.name,
      description: item.description,
      category: item.category,
      defaultEnabled: item.defaultEnabled,
      builtin: item.builtin,
      isActive: item.isActive,
    })),
    skills: catalog.skills.map((item) => ({
      id: item.id,
      key: item.key,
      name: item.name,
      description: item.description,
      mode: item.mode,
      defaultEnabled: item.defaultEnabled,
      builtin: item.builtin,
      isActive: item.isActive,
    })),
  };
}

export async function updateCapabilities(body: CapabilityPayload) {
  await syncBuiltinCapabilities();
  await prisma.$transaction(async (tx) => {
    for (const item of Array.isArray(body.tools) ? body.tools : []) {
      if (!item.key) continue;
      await tx.agentTool.update({
        where: { key: item.key },
        data: {
          ...(item.defaultEnabled !== undefined ? { defaultEnabled: item.defaultEnabled } : {}),
          ...(item.isActive !== undefined ? { isActive: item.isActive } : {}),
        },
      });
    }
    for (const item of Array.isArray(body.skills) ? body.skills : []) {
      if (!item.key) continue;
      await tx.agentSkill.update({
        where: { key: item.key },
        data: {
          ...(item.defaultEnabled !== undefined ? { defaultEnabled: item.defaultEnabled } : {}),
          ...(item.isActive !== undefined ? { isActive: item.isActive } : {}),
        },
      });
    }
  });
  return getCapabilityCatalog();
}
