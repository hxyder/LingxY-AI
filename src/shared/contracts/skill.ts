export interface SkillDescriptor {
  id: string;
  displayName: string;
  description: string;
  entryPath: string;
  tags: string[];
}

export interface SkillRegistryAdapter {
  id: string;
  displayName?: string;
  rootPath: string;
  listSkills(): Promise<SkillDescriptor[]>;
}

export interface SkillRegistryConfig {
  id: string;
  displayName?: string;
  rootPath: string;
  enabled?: boolean;
}

export interface SkillRegistryStatus extends SkillRegistryConfig {
  available: boolean;
  skillCount: number;
  source?: string;
}
