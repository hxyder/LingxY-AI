export interface SkillDescriptor {
  id: string;
  displayName: string;
  description: string;
  entryPath: string;
  tags: string[];
}

export interface SkillRegistryAdapter {
  id: string;
  rootPath: string;
  listSkills(): Promise<SkillDescriptor[]>;
}
