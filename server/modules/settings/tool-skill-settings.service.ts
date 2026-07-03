import { listSkillSettings, updateSkillSettings } from '../skills/skills.service';
import { listToolSettings, updateToolSettings } from '../tools/tools.service';
import type { ToolSkillSettingsPayload } from './settings.types';

export async function listToolSkillSettings() {
  const [tools, skills] = await Promise.all([listToolSettings(), listSkillSettings()]);
  return { tools, skills };
}

export async function updateToolSkillSettings(body: ToolSkillSettingsPayload) {
  await Promise.all([updateToolSettings(body.tools ?? []), updateSkillSettings(body.skills ?? [])]);
  return listToolSkillSettings();
}
